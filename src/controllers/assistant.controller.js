import axios from 'axios';
import { getAllUsers } from './users.controller.js';
import jwt from 'jsonwebtoken';
import { isGeminiQuotaError } from '../libs/geminiRetry.js'
import { sanitizeObject } from '../libs/sanitize.js'
import { parseAIJSONSafe, smartAICall } from '../libs/aiService.js';
import { generarSessionIdDiario } from '../libs/generarSessionIdDiario.js';
import memoriaService from '../Helpers/MemoriaService.helpers.js';
import ActividadesSchema from "../models/actividades.model.js";
import HistorialBot from "../models/historialBot.model.js";
import { TOKEN_SECRET, API_URL_ANFETA } from '../config.js';
import { obtenerSesionActivaDelDia } from '../libs/generarSessionIdDiario.js';
import { guardarMensajeHistorial } from "../Helpers/historial.helper.js";

export async function verificarAnalisisDelDia(req, res) {
  try {
    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const { id: userId } = decoded;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "Usuario no autenticado"
      });
    }

    // Obtener sesión activa del día
    const sessionId = await obtenerSesionActivaDelDia(userId);

    // Buscar si ya existe un análisis para esta sesión
    const historialExistente = await HistorialBot.findOne({
      userId: userId,
      sessionId: sessionId,
      'ultimoAnalisis': { $exists: true }
    }).lean();

    if (historialExistente && historialExistente.ultimoAnalisis) {

      // Ya existe un análisis del día
      return res.json({
        success: true,
        tieneAnalisis: true,
        sessionId: sessionId,
        analisis: historialExistente.ultimoAnalisis,
        mensajes: historialExistente.mensajes || []
      });
    } else {


      // No existe análisis del día
      return res.json({
        success: true,
        tieneAnalisis: false,
        sessionId: sessionId
      });
    }

  } catch (error) {

    return res.status(500).json({
      success: false,
      error: "Error al verificar análisis del día"
    });
  }
}

export async function verificarCambiosTareas(req, res) {
  try {
    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const { id: userId, email } = decoded;

    if (!userId || !email) {
      return res.status(400).json({
        success: false,
        error: "Usuario no autenticado"
      });
    }

    console.log(`🔍 Verificando cambios para usuario: ${email}`);

    // ✅ Buscar documento del usuario en ActividadesSchema
    const documento = await ActividadesSchema.findOne({
      odooUserId: userId
    }).lean();

    if (!documento || !documento.actividades || documento.actividades.length === 0) {
      return res.json({
        success: true,
        cambios: {
          totalTareasSinDescripcion: 0,
          totalTareasConDescripcion: 0,
          totalTareas: 0,
          totalActividadesConTareas: 0,
          ultimaModificacion: new Date(),
          ultimaActualizacion: new Date()
        },
        timestamp: new Date().toISOString(),
        email: email
      });
    }

    // ✅ Procesar actividades y pendientes
    let totalTareasSinDescripcion = 0;
    let totalTareasConDescripcion = 0;
    let totalTareas = 0;
    let totalActividadesConTareas = 0;
    let ultimaModificacion = new Date(0);
    let ultimaActualizacion = new Date(0);

    documento.actividades.forEach(actividad => {
      if (!actividad.pendientes || actividad.pendientes.length === 0) {
        return;
      }

      let actividadTieneTareasPendientes = false;

      actividad.pendientes.forEach(pendiente => {
        // ✅ FILTRO 1: Solo tareas NO terminadas y NO confirmadas
        if (pendiente.terminada === true || pendiente.confirmada === true) {
          return;
        }

        // ✅ FILTRO 2: Solo tareas CON tiempo asignado (duracionMin > 0)
        if (!pendiente.duracionMin || pendiente.duracionMin <= 0) {
          return;
        }

        actividadTieneTareasPendientes = true;
        totalTareas++;

        // ✅ Verificar si tiene descripción
        const tieneDescripcion = pendiente.descripcion &&
          pendiente.descripcion.trim().length > 0;

        if (tieneDescripcion) {
          totalTareasConDescripcion++;
        } else {
          totalTareasSinDescripcion++;
        }

        // ✅ Trackear última modificación del pendiente
        if (pendiente.ultimaActualizacion) {
          const fechaPendiente = new Date(pendiente.ultimaActualizacion);
          if (fechaPendiente > ultimaModificacion) {
            ultimaModificacion = fechaPendiente;
          }
        }
      });

      if (actividadTieneTareasPendientes) {
        totalActividadesConTareas++;

        // ✅ Trackear última actualización de la actividad
        if (actividad.ultimaActualizacion) {
          const fechaActividad = new Date(actividad.ultimaActualizacion);
          if (fechaActividad > ultimaActualizacion) {
            ultimaActualizacion = fechaActividad;
          }
        }
      }
    });

    const resultado = {
      totalTareasSinDescripcion,
      totalTareasConDescripcion,
      totalTareas,
      totalActividadesConTareas,
      ultimaModificacion,
      ultimaActualizacion
    };

    console.log("📊 Estadísticas de cambios (solo tareas con tiempo):", resultado);

    return res.json({
      success: true,
      cambios: resultado,
      timestamp: new Date().toISOString(),
      email: email,
      userId: userId
    });

  } catch (error) {
    console.error("❌ Error en verificarCambiosTareas:", error);

    return res.status(500).json({
      success: false,
      error: "Error al verificar cambios",
      details: error.message
    });
  }
}

function convertirHoraADecimal(hora) {
  if (!hora || typeof hora !== 'string') return 0;

  const [horas, minutos] = hora.split(':').map(Number);

  if (isNaN(horas) || isNaN(minutos)) return 0;

  return horas + (minutos / 60);
}

function limpiarNombreColaborador(email) {
  if (!email || typeof email !== 'string') return '';

  if (email.includes('@')) {
    const username = email.split('@')[0];

    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  return email;
}

export async function getActividadesConRevisiones(req, res) {
  try {
    const {
      email,
      question = "¿Qué actividades y revisiones tengo hoy? ¿Qué me recomiendas priorizar?",
      showAll = false
    } = sanitizeObject(req.body);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "El email es requerido"
      });
    }

    const usersData = await getAllUsers();
    const user = usersData.items.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;
    const sessionId = await obtenerSesionActivaDelDia(odooUserId);

    const today = new Date().toISOString().split('T')[0];

    const actividadesResponse = await axios.get(
      `${API_URL_ANFETA}/actividades/assignee/${email}/del-dia`
    );
    const actividadesRaw = actividadesResponse.data.data;

    if (!Array.isArray(actividadesRaw) || actividadesRaw.length === 0) {
      return res.json({
        success: true,
        answer: "No tienes actividades registradas para hoy",
        sessionId: sessionId,
        actividades: [],
        revisionesPorActividad: {}
      });
    }

    const esActividadValida = (actividad) => {
      const titulo = actividad.titulo?.toLowerCase() || "";
      return !titulo.startsWith("00ftf") && actividad.status !== "00sec";
    };

    let actividadesFiltradas = actividadesRaw.filter(esActividadValida);

    if (actividadesFiltradas.length === 0) {
      return res.json({
        success: true,
        answer: "Todas tus actividades de hoy son de tipo 00ftf o 00sec (filtradas automáticamente)",
        sessionId: sessionId,
        actividades: [],
        revisionesPorActividad: {}
      });
    }

    // 4️⃣ Filtrar por horario laboral (9:30 - 17:00)
    const HORARIO_INICIO = 9.5;  // 9:30 AM
    const HORARIO_FIN = 17.0;    // 5:00 PM

    const actividadesEnHorarioLaboral = actividadesFiltradas.filter(actividad => {
      const horaInicioDecimal = convertirHoraADecimal(actividad.horaInicio);
      const horaFinDecimal = convertirHoraADecimal(actividad.horaFin);
      return horaInicioDecimal >= HORARIO_INICIO &&
        horaInicioDecimal < HORARIO_FIN &&
        horaFinDecimal <= HORARIO_FIN;
    });

    if (actividadesEnHorarioLaboral.length === 0) {
      return res.json({
        success: true,
        answer: "No tienes actividades programadas en horario laboral (09:30-17:00).",
        sessionId: sessionId,
        actividades: [],
        revisionesPorActividad: {}
      });
    }

    // 5️⃣ IDs de actividades en horario laboral
    const actividadIdsHorarioLaboral = new Set(
      actividadesEnHorarioLaboral.map(a => a.id)
    );

    // 6️⃣ Obtener revisiones (2da llamada HTTP)
    let todasRevisiones = { colaboradores: [] };
    try {
      const revisionesResponse = await axios.get(
        `${API_URL_ANFETA}/reportes/revisiones-por-fecha`,
        {
          params: {
            date: today,
            colaborador: email
          }
        }
      );
      if (revisionesResponse.data?.success) {
        todasRevisiones = revisionesResponse.data.data || { colaboradores: [] };
      }
    } catch (e) {
      console.warn("Error obteniendo revisiones:", e.message);
    }

    // 7️⃣ Procesar revisiones y extraer colaboradores
    const revisionesPorActividad = {};
    const actividadesConRevisionesConTiempoIds = new Set();
    const todosColaboradoresSet = new Set();

    if (todasRevisiones.colaboradores && Array.isArray(todasRevisiones.colaboradores)) {
      todasRevisiones.colaboradores.forEach(colaborador => {
        (colaborador.items?.actividades ?? []).forEach(actividadRev => {
          // Filtro 1: Solo actividades en horario laboral
          if (!actividadIdsHorarioLaboral.has(actividadRev.id)) return;

          // Filtro 2: Excluir 00ftf
          if (actividadRev.titulo.toLowerCase().includes('00ftf')) return;

          // Filtro 3: Verificar pendientes
          if (!actividadRev.pendientes || actividadRev.pendientes.length === 0) return;

          const actividadOriginal = actividadesEnHorarioLaboral.find(a => a.id === actividadRev.id);
          if (!actividadOriginal) return;

          // ✅ Extraer colaboradores únicos de TODOS los pendientes de esta actividad
          const colaboradoresActividad = new Set();
          (actividadRev.pendientes ?? []).forEach(pendiente => {
            (pendiente.assignees ?? []).forEach(assignee => {
              if (assignee.name) {
                const nombreLimpio = limpiarNombreColaborador(assignee.name);
                colaboradoresActividad.add(nombreLimpio);
                todosColaboradoresSet.add(nombreLimpio);
              }
            });
          });

          // Inicializar estructura
          revisionesPorActividad[actividadRev.id] = {
            actividad: {
              id: actividadRev.id,
              titulo: actividadOriginal?.titulo || actividadRev.titulo,
              horaInicio: actividadOriginal.horaInicio || "00:00",
              horaFin: actividadOriginal.horaFin || "00:00",
              status: actividadOriginal.status || "Sin status",
              proyecto: actividadOriginal.tituloProyecto || "Sin proyecto",
              colaboradores: Array.from(colaboradoresActividad),
              assigneesDirectos: Array.from(colaboradoresActividad)
            },
            pendientesConTiempo: [],
            pendientesSinTiempo: []
          };

          // Procesar pendientes
          (actividadRev.pendientes ?? []).forEach(p => {
            // Filtro 4: Verificar asignación al usuario
            const estaAsignado = p.assignees?.some(a => a.name === email);
            if (!estaAsignado) return;

            const pendienteInfo = {
              id: p.id,
              nombre: p.nombre,
              terminada: p.terminada,
              confirmada: p.confirmada,
              duracionMin: p.duracionMin || 0,
              fechaCreacion: p.fechaCreacion,
              fechaFinTerminada: p.fechaFinTerminada,
              diasPendiente: p.fechaCreacion ?
                Math.floor((new Date() - new Date(p.fechaCreacion)) / (1000 * 60 * 60 * 24)) : 0,
              colaboradores: p.assignees ?
                p.assignees.map(a => limpiarNombreColaborador(a.name)).filter(Boolean) : []
            };

            // Clasificar: Con tiempo vs Sin tiempo
            if (p.duracionMin && p.duracionMin > 0) {
              pendienteInfo.prioridad = p.duracionMin > 60 ? "ALTA" :
                p.duracionMin > 30 ? "MEDIA" : "BAJA";
              revisionesPorActividad[actividadRev.id].pendientesConTiempo.push(pendienteInfo);
              actividadesConRevisionesConTiempoIds.add(actividadRev.id);
            } else {
              pendienteInfo.prioridad = "SIN TIEMPO";
              revisionesPorActividad[actividadRev.id].pendientesSinTiempo.push(pendienteInfo);
            }
          });

          // Eliminar si no tiene tareas con tiempo
          if (revisionesPorActividad[actividadRev.id].pendientesConTiempo.length === 0) {
            delete revisionesPorActividad[actividadRev.id];
          }
        });
      });
    }

    // 8️⃣ Actividades finales
    const actividadesFinales = actividadesEnHorarioLaboral.filter(actividad =>
      actividadesConRevisionesConTiempoIds.has(actividad.id)
    );

    if (actividadesFinales.length === 0) {
      return res.json({
        success: true,
        answer: "No tienes actividades con tareas que tengan tiempo estimado en horario laboral (09:30-17:00).",
        sessionId: sessionId,
        actividades: [],
        revisionesPorActividad: {}
      });
    }

    // 9️⃣ Calcular métricas
    let totalTareasConTiempo = 0;
    let totalTareasSinTiempo = 0;
    let tareasAltaPrioridad = 0;
    let tiempoTotalEstimado = 0;

    actividadesFinales.forEach(actividad => {
      const revisiones = revisionesPorActividad[actividad.id] || {
        pendientesConTiempo: [],
        pendientesSinTiempo: []
      };
      totalTareasConTiempo += revisiones.pendientesConTiempo.length;
      totalTareasSinTiempo += revisiones.pendientesSinTiempo.length;
      tareasAltaPrioridad += revisiones.pendientesConTiempo.filter(t => t.prioridad === "ALTA").length;
      tiempoTotalEstimado += revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0);
    });

    const horasTotales = Math.floor(tiempoTotalEstimado / 60);
    const minutosTotales = tiempoTotalEstimado % 60;
    const colaboradoresTotales = Array.from(todosColaboradoresSet);

    // 🔟 Determinar proyecto principal
    let proyectoPrincipal = "Sin proyecto específico";
    if (actividadesFinales.length > 0) {
      const actividadPrincipal = actividadesFinales[0];
      if (actividadPrincipal.tituloProyecto && actividadPrincipal.tituloProyecto !== "Sin proyecto") {
        proyectoPrincipal = actividadPrincipal.tituloProyecto;
      } else if (actividadPrincipal.titulo) {
        const tituloLimpio = actividadPrincipal.titulo
          .replace('analizador de pendientes 00act', '')
          .replace('anfeta', '')
          .replace(/00\w+/g, '')
          .trim();
        proyectoPrincipal = tituloLimpio || actividadPrincipal.titulo.substring(0, 50) + "...";
      }
    }

    // 1️⃣1️⃣ Construir prompt para IA
    const prompt = `
Eres un asistente que analiza ÚNICAMENTE actividades que:
1. Tienen revisiones CON TIEMPO estimado
2. Están en horario laboral (09:30-17:00)
3. Se han filtrado actividades 00ftf y status 00sec

Usuario: ${user.firstName} (${email})

RESUMEN DE ACTIVIDADES CON REVISIONES CON TIEMPO (09:30-17:00):
- Total actividades: ${actividadesFinales.length}
- Total tareas con tiempo: ${totalTareasConTiempo}
- Tareas de alta prioridad: ${tareasAltaPrioridad}
- Tiempo estimado total: ${horasTotales}h ${minutosTotales}m
- Colaboradores involucrados: ${colaboradoresTotales.length > 0 ? colaboradoresTotales.join(', ') : 'Ninguno'}

DETALLE DE ACTIVIDADES (SOLO TAREAS CON TIEMPO):
${actividadesFinales.map((actividad, index) => {
      const revisiones = revisionesPorActividad[actividad.id] || { pendientesConTiempo: [], pendientesSinTiempo: [] };
      const conTiempo = revisiones.pendientesConTiempo;

      let actividadTexto = `
${index + 1}. ${actividad.horaInicio} - ${actividad.horaFin} - ${actividad.titulo}
   • Proyecto: ${revisiones.actividad?.proyecto || "Sin proyecto"}
   • Estado: ${actividad.status}
   • Equipo: ${revisiones.actividad?.colaboradores?.join(', ') || 'Solo tú'}
   • Tareas con tiempo: ${conTiempo.length}`;

      if (conTiempo.length > 0) {
        actividadTexto += `
   • TIEMPO TOTAL: ${revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0)}min`;
        conTiempo.forEach((tarea, i) => {
          actividadTexto += `
     ${i + 1}. ${tarea.nombre}
        - ${tarea.duracionMin} min | Prioridad: ${tarea.prioridad} | Dias pendiente: ${tarea.diasPendiente}d
        - Asignado a: ${tarea.colaboradores?.join(', ') || 'Solo tú'}`;
        });
      }

      return actividadTexto;
    }).join('\n')}

PREGUNTA DEL USUARIO: "${question}"

INSTRUCCIONES ESTRICTAS DE RESPUESTA:
1. COMIENZA específicamente: "En tu horario laboral (09:30-17:00), tienes ${actividadesFinales.length} actividades con tareas que tienen tiempo estimado"
2. MENCIONA a los colaboradores de cada actividad: "En 'X actividad' trabajas con [nombres]"
3. ENFÓCATE EXCLUSIVAMENTE en las tareas CON TIEMPO (${totalTareasConTiempo} tareas)
4. Da RECOMENDACIONES ESPECÍFICAS considerando:
   - Tareas de ALTA prioridad primero
   - Colaboración con el equipo
   - Tiempo disponible en el horario
5. Sugiere un ORDEN DE EJECUCIÓN claro
6. MÁXIMO 6-8 renglones
7. SIN emojis
8. EVITA mencionar "tareas sin tiempo", "sin estimación", etc.
`.trim();

    // 1️⃣2️⃣ Llamar a IA
    const aiResult = await smartAICall(prompt);

    // 1️⃣3️⃣ Obtener actividades guardadas (para descripciones)
    const actividadesGuardadas = await ActividadesSchema.findOne({
      odooUserId: odooUserId
    });

    // 1️⃣4️⃣ Preparar respuesta estructurada
    const respuestaData = {
      actividades: actividadesFinales.map(a => {
        const revisiones = revisionesPorActividad[a.id];
        return {
          id: a.id,
          titulo: a.titulo,
          horario: `${a.horaInicio} - ${a.horaFin}`,
          status: a.status,
          proyecto: revisiones?.actividad?.proyecto || "Sin proyecto",
          colaboradores: revisiones?.actividad?.colaboradores || [],
          assigneesOriginales: revisiones?.actividad?.assigneesDirectos || [],
          esHorarioLaboral: true,
          tieneRevisionesConTiempo: true
        };
      }),
      revisionesPorActividad: actividadesFinales
        .map(actividad => {
          const revisiones = revisionesPorActividad[actividad.id];
          if (!revisiones || revisiones.pendientesConTiempo.length === 0) return null;

          const actividadGuardada = actividadesGuardadas?.actividades?.find(
            a => a.actividadId === actividad.id
          );

          return {
            actividadId: actividad.id,
            actividadTitulo: actividad.titulo,
            actividadHorario: `${actividad.horaInicio} - ${actividad.horaFin}`,
            colaboradores: revisiones.actividad?.colaboradores || [],
            assigneesOriginales: revisiones.actividad?.assigneesDirectos || [],
            tareasConTiempo: revisiones.pendientesConTiempo.map(tarea => {
              // Buscar descripción en la actividad guardada
              const pendienteGuardado = actividadGuardada?.pendientes?.find(
                p => p.pendienteId === tarea.id
              );

              return {
                ...tarea,
                descripcion: pendienteGuardado?.descripcion || ""
              };
            }),
            totalTareasConTiempo: revisiones.pendientesConTiempo.length,
            tareasAltaPrioridad: revisiones.pendientesConTiempo.filter(t => t.prioridad === "ALTA").length,
            tiempoTotal: revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0),
            tiempoFormateado: `${Math.floor(revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0) / 60)}h ${revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0) % 60}m`
          };
        })
        .filter(item => item !== null)
    };

    // 1️⃣5️⃣ Preparar análisis completo
    const analisisCompleto = {
      success: true,
      answer: aiResult.text,
      provider: aiResult.provider,
      sessionId: sessionId,
      proyectoPrincipal: proyectoPrincipal,
      metrics: {
        totalActividades: actividadesFiltradas.length,
        totalPendientes: totalTareasConTiempo,
        pendientesAltaPrioridad: tareasAltaPrioridad,
        tiempoEstimadoTotal: `${horasTotales}h ${minutosTotales}m`,
        actividadesConPendientes: actividadesFinales.length,
        tareasConTiempo: totalTareasConTiempo,
        tareasSinTiempo: totalTareasSinTiempo,
        tareasAltaPrioridad: tareasAltaPrioridad,
        totalColaboradores: colaboradoresTotales.length
      },
      data: respuestaData,
      colaboradoresTotales: colaboradoresTotales,
      separadasPorTiempo: true,
      sugerencias: []
    };

    // 1️⃣6️⃣ Preparar estado de tareas
    const tareasEstadoArray = respuestaData.revisionesPorActividad.flatMap(r =>
      (r.tareasConTiempo || []).map(t => ({
        taskId: t.id,
        taskName: t.nombre,
        actividadTitulo: r.actividadTitulo,
        explicada: false,
        validada: false,
        explicacion: "",
        ultimoIntento: null
      }))
    );

    // 1️⃣7️⃣ Generar nombre de conversación con IA
    const promptNombreConversacion = `
Genera un TÍTULO MUY CORTO para una conversación.

ACTIVIDADES:
${actividadesFinales.map(a => `- ${a.titulo}`).join('\n')}

CONTEXTO:
- Proyecto principal: "${proyectoPrincipal}"
- Tareas con tiempo: ${totalTareasConTiempo}
- Tareas alta prioridad: ${tareasAltaPrioridad}
- Colaboradores: ${colaboradoresTotales.length > 0 ? colaboradoresTotales.join(', ') : 'Solo tú'}

REGLAS OBLIGATORIAS:
- MÁXIMO 2 PALABRAS
- Solo letras y espacios
- Sin emojis
- Sin signos de puntuación
- No frases completas
- Idioma español

RESPONDE SOLO EL TÍTULO
`.trim();

    let nombreConversacionIA = "Nueva conversación";
    try {
      const aiNombre = await smartAICall(promptNombreConversacion);
      if (aiNombre?.text) {
        nombreConversacionIA = aiNombre.text.trim().slice(0, 60);
      }
    } catch (e) {
      console.warn("No se pudo generar nombre de conversación con IA");
    }

    // 1️⃣8️⃣ Guardar en base de datos (Actividades)
    const actividadesExistentes = await ActividadesSchema.findOne({
      odooUserId: odooUserId
    });

    const actividadesParaGuardar = actividadesFinales.map(actividad => {
      const revisiones = revisionesPorActividad[actividad.id];

      const todasLasTareas = [
        ...(revisiones.pendientesConTiempo || []),
        ...(revisiones.pendientesSinTiempo || [])
      ];

      // Buscar la actividad existente para preservar descripciones
      const actividadExistente = actividadesExistentes?.actividades?.find(
        a => a.actividadId === actividad.id
      );

      return {
        actividadId: actividad.id,
        titulo: actividad.titulo,
        horaInicio: actividad.horaInicio,
        horaFin: actividad.horaFin,
        status: actividad.status,
        fecha: today,
        colaboradores: revisiones.actividad?.colaboradores || [],
        assigneesOriginales: revisiones.actividad?.assigneesDirectos || [],
        pendientes: todasLasTareas.map(t => {
          const pendienteExistente = actividadExistente?.pendientes?.find(
            p => p.pendienteId === t.id
          );

          return {
            pendienteId: t.id,
            nombre: t.nombre,
            descripcion: t.descripcion && t.descripcion.trim() !== ""
              ? t.descripcion
              : (pendienteExistente?.descripcion || ""),
            queHizo: t.queHizo && t.queHizo.trim() !== ""
              ? t.queHizo
              : (pendienteExistente?.queHizo || ""),
            terminada: t.terminada,
            confirmada: t.confirmada,
            duracionMin: t.duracionMin,
            fechaCreacion: t.fechaCreacion,
            fechaFinTerminada: t.fechaFinTerminada,
            colaboradores: t.colaboradores || []
          };
        }),
        ultimaActualizacion: new Date()
      };
    });

    await ActividadesSchema.findOneAndUpdate(
      { odooUserId: odooUserId },
      {
        $set: {
          odooUserId: odooUserId,
          actividades: actividadesParaGuardar,
          ultimaSincronizacion: new Date()
        }
      },
      { upsert: true, new: true }
    );

    // 1️⃣9️⃣ Guardar en historial (solo si no existe análisis inicial)
    const sesionExistente = await HistorialBot.findOne({
      userId: odooUserId,
      sessionId: sessionId
    });

    const yaExisteAnalisisInicial = sesionExistente?.mensajes?.some(
      msg => msg.tipoMensaje === "analisis_inicial"
    );

    if (!yaExisteAnalisisInicial) {
      await HistorialBot.findOneAndUpdate(
        {
          userId: odooUserId,
          sessionId: sessionId
        },
        {
          $set: {
            nombreConversacion: nombreConversacionIA,
            tareasEstado: tareasEstadoArray,
            ultimoAnalisis: analisisCompleto,
            estadoConversacion: "mostrando_actividades"
          },
          $push: {
            mensajes: {
              role: "bot",
              contenido: aiResult.text,
              timestamp: new Date(),
              tipoMensaje: "analisis_inicial",
              analisis: analisisCompleto
            }
          }
        },
        {
          upsert: true,
          new: true
        }
      );
    }

    // 2️⃣0️⃣ Respuesta final
    return res.json({
      success: true,
      answer: aiResult.text,
      provider: aiResult.provider,
      sessionId: sessionId,
      proyectoPrincipal: proyectoPrincipal,
      colaboradoresInvolucrados: colaboradoresTotales,
      metrics: {
        totalActividadesProgramadas: actividadesFiltradas.length,
        actividadesConTiempoTotal: Array.from(actividadesConRevisionesConTiempoIds).length,
        actividadesFinales: actividadesFinales.length,
        tareasConTiempo: totalTareasConTiempo,
        tareasAltaPrioridad: tareasAltaPrioridad,
        tiempoEstimadoTotal: `${horasTotales}h ${minutosTotales}m`,
        totalColaboradores: colaboradoresTotales.length
      },
      data: respuestaData,
      multiActividad: true,
      filtrosAplicados: {
        excluir00ftf: true,
        excluir00sec: true,
        soloHorarioLaboral: "09:30-17:00",
        soloTareasConTiempo: true,
        excluirTareasSinTiempo: true
      }
    });

  } catch (error) {
    if (error.message === "AI_PROVIDER_FAILED") {
      return res.status(503).json({
        success: false,
        message: "El asistente está muy ocupado. Intenta de nuevo en un minuto."
      });
    }

    if (isGeminiQuotaError(error)) {
      return res.status(429).json({
        success: false,
        reason: "QUOTA_EXCEEDED",
        message: "El asistente está temporalmente saturado."
      });
    }

    console.error("Error en getActividadesConRevisiones:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno",
      error: error.message
    });
  }
}

export async function getTareasTerminadasConRevisiones(req, res) {
  try {
    const { email, question = "¿Qué tareas ya terminé hoy? ¿Cuáles están confirmadas?", showAll = false } = sanitizeObject(req.body);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "El email es requerido"
      });
    }

    const usersData = await getAllUsers();
    const user = usersData.items.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;

    const sessionId = await generarSessionIdDiario(odooUserId);

    // 1️ Obtener actividades del día para el usuario
    const actividadesResponse = await axios.get(
      `${API_URL_ANFETA}/actividades/assignee/${email}/del-dia`
    );

    const actividadesRaw = actividadesResponse.data.data;

    if (!Array.isArray(actividadesRaw) || actividadesRaw.length === 0) {
      const respuestaSinActividades = "No tienes actividades registradas para hoy";

      return res.json({
        success: true,
        answer: respuestaSinActividades,
        sessionId: sessionId,
        actividades: [],
        revisionesPorActividad: {}
      });
    }

    // 2️ Obtener fecha actual para las revisiones
    const today = new Date();
    const formattedToday = today.toISOString().split('T')[0];

    // 3️ Obtener TODAS las revisiones del día
    let todasRevisiones = { colaboradores: [] };
    try {
      const revisionesResponse = await axios.get(
        `${API_URL_ANFETA}/reportes/revisiones-por-fecha`,
        {
          params: {
            date: formattedToday,
            colaborador: email
          }
        }
      );

      if (revisionesResponse.data?.success) {
        todasRevisiones = revisionesResponse.data.data || { colaboradores: [] };
      }
    } catch (error) {
      console.warn("Error obteniendo revisiones:", error.message);
    }

    // 4️ Filtrar actividades (igual que antes)
    let actividadesFiltradas = actividadesRaw.filter((actividad) => {
      const tiene00ftf = actividad.titulo.toLowerCase().includes('00ftf');
      const es00sec = actividad.status === "00sec";
      return !tiene00ftf && !es00sec;
    });

    // 5️ Extraer IDs de todas las actividades filtradas
    const actividadIds = actividadesFiltradas.map(a => a.id);

    // 6️ Procesar revisiones - SOLO TAREAS TERMINADAS
    const revisionesPorActividad = {};
    const actividadesConTareasTerminadasIds = new Set();
    let totalTareasTerminadas = 0;
    let totalTareasConfirmadas = 0;
    let tiempoTotalTerminado = 0;
    const todosColaboradoresSet = new Set();

    if (todasRevisiones.colaboradores && Array.isArray(todasRevisiones.colaboradores)) {
      todasRevisiones.colaboradores.forEach(colaborador => {
        (colaborador.items?.actividades ?? []).forEach(actividad => {
          if (actividadIds.includes(actividad.id) && actividad.pendientes) {
            // Extraer colaboradores de todas las tareas
            const colaboradoresEnTareas = extraerColaboradoresDeTareas(actividad.pendientes);

            revisionesPorActividad[actividad.id] = {
              actividad: {
                id: actividad.id,
                titulo: actividad.titulo,
                horaInicio: actividadesRaw.find(a => a.id === actividad.id)?.horaInicio || "00:00",
                horaFin: actividadesRaw.find(a => a.id === actividad.id)?.horaFin || "00:00",
                status: actividadesRaw.find(a => a.id === actividad.id)?.status || "Sin status",
                proyecto: actividadesRaw.find(a => a.id === actividad.id)?.tituloProyecto || "Sin proyecto",
                colaboradoresEnTareas: colaboradoresEnTareas
              },
              tareasTerminadas: [],
              tareasPendientes: []
            };

            (actividad.pendientes ?? []).forEach(p => {
              const estaAsignado = p.assignees?.some(a => a.name === email);
              if (!estaAsignado) return;

              const pendienteInfo = {
                id: p.id,
                nombre: p.nombre,
                terminada: p.terminada,
                confirmada: p.confirmada,
                duracionMin: p.duracionMin || 0,
                fechaCreacion: p.fechaCreacion,
                fechaFinTerminada: p.fechaFinTerminada,
                diasPendiente: p.fechaCreacion ?
                  Math.floor((new Date() - new Date(p.fechaCreacion)) / (1000 * 60 * 60 * 24)) : 0,
                colaboradores: p.assignees ? p.assignees.map(a => a.name) : []
              };

              // FILTRAR SOLO TAREAS TERMINADAS
              if (p.terminada === true) {
                if (p.duracionMin && p.duracionMin > 0) {
                  pendienteInfo.prioridad = p.duracionMin > 60 ? "ALTA" :
                    p.duracionMin > 30 ? "MEDIA" : "BAJA";
                } else {
                  pendienteInfo.prioridad = "SIN TIEMPO";
                }

                revisionesPorActividad[actividad.id].tareasTerminadas.push(pendienteInfo);
                actividadesConTareasTerminadasIds.add(actividad.id);
                totalTareasTerminadas++;

                if (p.confirmada === true) {
                  totalTareasConfirmadas++;
                }

                if (p.duracionMin) {
                  tiempoTotalTerminado += p.duracionMin;
                }
              } else {
                // Tareas no terminadas van a pendientes
                revisionesPorActividad[actividad.id].tareasPendientes.push(pendienteInfo);
              }
            });

            // Agregar colaboradores al set global
            if (colaboradoresEnTareas.length > 0) {
              colaboradoresEnTareas.forEach(colaborador => {
                todosColaboradoresSet.add(colaborador);
              });
            }
          }
        });
      });
    }

    // 7️ Filtrar actividades que tienen al menos una tarea terminada
    const actividadesConTerminadas = actividadesFiltradas.filter(actividad =>
      actividadesConTareasTerminadasIds.has(actividad.id)
    );

    // 8️ Si no hay tareas terminadas
    if (actividadesConTerminadas.length === 0 || totalTareasTerminadas === 0) {
      return res.json({
        success: true,
        answer: "No tienes tareas terminadas registradas para hoy.",
        sessionId: sessionId,
        tareasTerminadas: 0,
        tareasConfirmadas: 0,
        actividadesConTerminadas: 0
      });
    }

    const horasTotales = Math.floor(tiempoTotalTerminado / 60);
    const minutosTotales = tiempoTotalTerminado % 60;
    const colaboradoresTotales = Array.from(todosColaboradoresSet);

    // 9️ Construir prompt para tareas terminadas
    const prompt = `
Eres un asistente que analiza las tareas TERMINADAS de hoy.

Usuario: ${user.firstName} (${email})

RESUMEN DE TAREAS TERMINADAS HOY:
• Total tareas terminadas: ${totalTareasTerminadas}
• Tareas confirmadas: ${totalTareasConfirmadas}
• Tiempo total trabajado: ${horasTotales}h ${minutosTotales}m
• Colaboradores involucrados: ${colaboradoresTotales.length > 0 ? colaboradoresTotales.join(', ') : 'Ninguno'}

DETALLE DE TAREAS TERMINADAS:
${actividadesConTerminadas.map((actividad, index) => {
      const revisiones = revisionesPorActividad[actividad.id] || { tareasTerminadas: [] };
      const terminadas = revisiones.tareasTerminadas;

      if (terminadas.length === 0) return '';

      let actividadTexto = `
${index + 1}. ${actividad.titulo}
   • Horario: ${actividad.horaInicio} - ${actividad.horaFin}
   • Proyecto: ${actividad.tituloProyecto || "Sin proyecto"}
   • Estado: ${actividad.status}
   • Tareas terminadas: ${terminadas.length}`;

      terminadas.forEach((tarea, i) => {
        actividadTexto += `
     ${i + 1}. ${tarea.nombre}
        - ${tarea.confirmada ? '✅ CONFIRMADA' : '⚠️ POR CONFIRMAR'}
        - ${tarea.duracionMin || 0} min ${tarea.prioridad ? `| Prioridad original: ${tarea.prioridad}` : ''}
        - Días en pendiente: ${tarea.diasPendiente}d
        - Colaboradores: ${tarea.colaboradores?.join(', ') || 'Ninguno'}`;
      });

      return actividadTexto;
    }).join('\n')}

PREGUNTA DEL USUARIO: "${question}"

INSTRUCCIONES DE RESPUESTA:
1. COMIENZA con: "Hoy has terminado ${totalTareasTerminadas} tareas, de las cuales ${totalTareasConfirmadas} están confirmadas."
2. MENCIONA el tiempo total trabajado: ${horasTotales}h ${minutosTotales}m
3. DESTACA las tareas CONFIRMADAS vs POR CONFIRMAR
4. Si hay muchas tareas por confirmar, sugiere revisarlas
5. RECONOCE el progreso del usuario
6. MENCIONA la colaboración con otros si aplica
7. MÁXIMO 6-8 renglones
8. TONO positivo y motivacional
`.trim();

    const aiResult = await smartAICall(prompt);

    // Preparar respuesta estructurada para tareas terminadas
    const respuestaData = {
      actividades: actividadesConTerminadas.map(a => {
        const revisiones = revisionesPorActividad[a.id];
        return {
          id: a.id,
          titulo: a.titulo,
          horario: `${a.horaInicio} - ${a.horaFin}`,
          status: a.status,
          proyecto: a.tituloProyecto || "Sin proyecto",
          colaboradores: revisiones?.actividad?.colaboradoresEnTareas || [],
          totalTareasTerminadas: revisiones?.tareasTerminadas?.length || 0
        };
      }),
      tareasTerminadas: actividadesConTerminadas
        .map(actividad => {
          const revisiones = revisionesPorActividad[actividad.id];
          if (!revisiones || revisiones.tareasTerminadas.length === 0) return null;

          return {
            actividadId: actividad.id,
            actividadTitulo: actividad.titulo,
            actividadHorario: `${actividad.horaInicio} - ${actividad.horaFin}`,
            colaboradores: revisiones.actividad?.colaboradoresEnTareas || [],
            tareasTerminadas: revisiones.tareasTerminadas.map(t => ({
              ...t,
              estado: t.confirmada ? 'CONFIRMADA' : 'POR CONFIRMAR'
            })),
            totalTerminadas: revisiones.tareasTerminadas.length,
            totalConfirmadas: revisiones.tareasTerminadas.filter(t => t.confirmada).length,
            tiempoTotal: revisiones.tareasTerminadas.reduce((sum, t) => sum + (t.duracionMin || 0), 0)
          };
        })
        .filter(item => item !== null)
    };

    // Respuesta final
    return res.json({
      success: true,
      answer: aiResult.text,
      provider: aiResult.provider,
      sessionId: sessionId,
      metrics: {
        totalTareasTerminadas: totalTareasTerminadas,
        totalTareasConfirmadas: totalTareasConfirmadas,
        tiempoTotalTerminado: `${horasTotales}h ${minutosTotales}m`,
        actividadesConTerminadas: actividadesConTerminadas.length,
        totalColaboradores: colaboradoresTotales.length
      },
      data: respuestaData,
      colaboradoresInvolucrados: colaboradoresTotales,
      tipoReporte: "tareas_terminadas"
    });

  } catch (error) {
    if (error.message === "AI_PROVIDER_FAILED") {
      return res.status(503).json({
        success: false,
        message: "El asistente está muy ocupado. Intenta de nuevo en un minuto."
      });
    }

    if (isGeminiQuotaError(error)) {
      return res.status(429).json({
        success: false,
        reason: "QUOTA_EXCEEDED",
        message: "El asistente está temporalmente saturado."
      });
    }

    console.error("Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno"
    });
  }
}

export async function obtenerActividadesConTiempoHoy(req, res) {
  try {
    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;

    const hoy = new Date().toISOString().split('T')[0];

    // Buscar actividades del usuario
    const registroUsuario = await ActividadesSchema.findOne({ odooUserId }).lean();

    if (!registroUsuario || !registroUsuario.actividades) {
      return res.json({
        success: true,
        data: [],
        message: "No se encontraron actividades para hoy"
      });
    }

    const revisiones = response.data.data;
    const actividadesRevi = new Map();

    revisiones.colaboradores.forEach(colaborador => {
      (colaborador.items?.actividades ?? []).forEach(actividad => {
        if (idsAct.length && !idsAct.includes(actividad.id)) return;

        const pendientesFiltrados = (actividad.pendientes ?? [])
          .filter(p => p.assignees?.some(a => a.name === email))
          .map(p => ({
            id: p.id,
            nombre: p.nombre,
            terminada: p.terminada,
            confirmada: p.confirmada,
            duracionMin: p.duracionMin,
            fechaCreacion: p.fechaCreacion,
            fechaFinTerminada: p.fechaFinTerminada,
            prioridad: p.duracionMin > 60 ? "ALTA" :
              p.duracionMin > 30 ? "MEDIA" :
                p.duracionMin > 0 ? "BAJA" : "SIN TIEMPO"
          }));

        if (!pendientesFiltrados.length) return;

        if (!actividadesRevi.has(actividad.id)) {
          actividadesRevi.set(actividad.id, {
            actividades: {
              id: actividad.id,
              titulo: actividad.titulo
            },
            pendientes: pendientesFiltrados,
            assignees: pendientesFiltrados[0]?.assignees ?? [
              { name: email }
            ]
          });
        }
      });
    });

    const resultado = Array.from(actividadesRevi.values());
    const totalPendientes = resultado.reduce((sum, act) => sum + act.pendientes.length, 0);

    return res.status(200).json({
      success: true,
      sessionId: sessionId,
      data: resultado
    });

  } catch (error) {
    if (isGeminiQuotaError(error)) {
      return res.status(429).json({
        success: false,
        reason: "QUOTA_EXCEEDED",
        message: "Intenta nuevamente en unos minutos."
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error interno"
    });
  }
}

export const obtenerExplicacionesUsuario = async (req, res) => {
  try {
    const { odooUserId } = req.params; // O desde el token

    const registroUsuario = await ActividadesSchema.findOne({ odooUserId });

    if (!registroUsuario) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
        data: []
      });
    }

    // Extraer todas las explicaciones en formato plano
    const todasExplicaciones = registroUsuario.actividades.reduce((acc, actividad) => {
      actividad.pendientes.forEach(pendiente => {
        if (pendiente.descripcion) { // Solo si tiene explicación
          acc.push({
            actividadId: actividad.actividadId,
            actividadTitulo: actividad.titulo,
            actividadFecha: actividad.fecha,
            pendienteId: pendiente.pendienteId,
            nombreTarea: pendiente.nombre,
            explicacion: pendiente.descripcion,
            terminada: pendiente.terminada,
            confirmada: pendiente.confirmada,
            duracionMin: pendiente.duracionMin,
            createdAt: pendiente.createdAt,
            updatedAt: pendiente.updatedAt,
            ultimaSincronizacion: registroUsuario.ultimaSincronizacion
          });
        }
      });
      return acc;
    }, []);

    return res.status(200).json({
      success: true,
      total: todasExplicaciones.length,
      data: todasExplicaciones,
      ultimaSincronizacion: registroUsuario.ultimaSincronizacion
    });

  } catch (error) {
    console.error("Error al obtener explicaciones:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

export async function actualizarEstadoPendientes(req, res) {
  try {
    const { actividadesId, IdPendientes, estado, motivoNoCompletado } = sanitizeObject(req.body);

    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const userId = decoded.id;

    if (!actividadesId || !IdPendientes || !estado) {
      return res.status(400).json({
        success: false,
        message: "actividadesId, IdPendientes y estado son requeridos"
      });
    }

    // Actualizamos el estado del pendiente dentro de la actividad del proyecto
    const resultado = await ProyectosSchema.updateOne(
      {
        userId,
        'actividades.ActividadId': actividadesId,
        'actividades.pendientes.pendienteId': IdPendientes
      },
      {
        $set: {
          'actividades.$[act].pendientes.$[pen].estado': estado,
          'actividades.$[act].pendientes.$[pen].motivoNoCompletado': motivoNoCompletado
        }
      },
      {
        arrayFilters: [
          { 'act.ActividadId': actividadesId },
          { 'pen.pendienteId': IdPendientes }
        ]
      }
    );

    return res.json({
      success: true,
      message: "Estado actualizado correctamente",
      data: resultado
    });
  } catch (error) {
    console.error("Error actualizando estado:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno"
    });
  }
}

export async function validarExplicacion(req, res) {
  try {
    const { taskName, explanation, activityTitle } = sanitizeObject(req.body);

    const { token } = req.cookies;



    console.log(explanation)

    const prompt = `
Eres un asistente que valida si un comentario del usuario
está realmente relacionado con una tarea específica
o con algo necesario para poder avanzar en ella HOY.

CONTEXTO:
- Actividad: "${activityTitle}"
- Tarea: "${taskName}"
- Comentario del usuario: "${explanation}"

CRITERIOS PARA CONSIDERARLO RELACIONADO:
Marca como relacionado SOLO si el comentario:
- Describe una acción que hará, hizo o intentó sobre la tarea, o
- Explica algo necesario para poder avanzar hoy
  (bloqueos reales, herramientas, accesos, información faltante).

CRITERIOS PARA NO RELACIONADO:
Marca como NO relacionado si:
- El usuario dice explícitamente que no hará nada,
- Habla de un tema distinto (personal, general, sin relación),
- Es una respuesta evasiva o sin intención clara de trabajar la tarea.

REGLAS IMPORTANTES:
- NO evalúes calidad, ortografía ni nivel de detalle.
- Comentarios breves o informales son válidos.
- Sé estricto pero justo: duda razonable = relacionado.
- Si NO es relacionado, explica claramente qué faltó.

RESPONDE ÚNICAMENTE EN JSON CON ESTE FORMATO EXACTO:
{
  "esDelTema": true | false,
  "razon": "Explicación breve y concreta del motivo",
  "sugerencia": "Pregunta clara para que el usuario corrija o explique mejor (vacía si esDelTema es true)",
}
`;

    const aiResult = await smartAICall(prompt);
    const resultadoIA = aiResult?.text;

    if (!resultadoIA) {
      return res.status(500).json({ valida: false, razon: "La IA no respondió." });
    }


    console.log(resultadoIA);


    // Estructura de respuesta final (reutilizable para la misma ruta)
    const respuesta = {
      valida: resultadoIA.esDelTema === true,
      categoriaMotivo: resultadoIA.categoriaMotivo || "INSUFICIENTE",
      razon: resultadoIA.razon || "Revisión técnica necesaria.",
      sugerencia: resultadoIA.sugerencia,
    };

    // Log para monitoreo interno
    if (!respuesta.valida) {
      console.log(`[Validación Fallida] Tarea: ${taskName} | Motivo: ${respuesta.categoriaMotivo}`);
    }


    return res.json(respuesta);

  } catch (error) {
    console.error("Error en validarExplicacion:", error);
    return res.status(500).json({
      valida: false,
      razon: "Error interno al procesar la validación."
    });
  }
}

export async function validarYGuardarExplicacion(req, res) {
  try {
    const {
      actividadId,
      actividadTitulo,
      idPendiente,
      nombrePendiente,
      explicacion,
      duracionMin,
      userEmail,      // 🔥 Email del usuario
      userId,         // 🔥 ID o email alternativo
      sessionId,
      priority,       // 🔥 Prioridad de la tarea (opcional)
      duration       // 🔥 Duración (opcional)
    } = req.body;

    console.log("📧 ========== DATOS RECIBIDOS ==========");
    console.log("📧 Email del usuario:", userEmail || userId);
    console.log("📋 Actividad:", actividadTitulo);
    console.log("✅ Pendiente:", nombrePendiente);
    console.log("📝 Explicación:", explicacion);
    console.log("⏱️  Duración:", duracionMin || duration);
    console.log("🎯 Prioridad:", priority);
    console.log("🆔 Session ID:", sessionId);

    // Validar datos esenciales
    if (!actividadId || !idPendiente || !explicacion) {
      console.error("❌ Datos incompletos - Faltan campos obligatorios");
      return res.status(400).json({
        esValida: false,
        razon: "Datos incompletos. Se requieren actividadId, idPendiente y explicacion."
      });
    }

    // Obtener usuario del token
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({
        esValida: false,
        razon: "No autorizado. Token no encontrado."
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;
    console.log("👤 Odoo User ID:", odooUserId);

    // Validar con IA
    const prompt = `
Tu tarea es evaluar si la explicación del usuario corresponde, por INTENCIÓN GENERAL, al pendiente asignado.

CONTEXTO:
El usuario está explicando qué hará durante el pendiente.
ACTIVIDAD:
"${actividadTitulo}"

PENDIENTE:
"${nombrePendiente}"

EXPLICACIÓN:
"${explicacion}"

TIEMPO:
${duracionMin || duration || "No especificado"}

Reglas:
- La explicación proviene de VOZ A TEXTO y puede contener errores graves de pronunciación, palabras incorrectas o frases sin sentido literal.
- Debes evaluar la INTENCIÓN, no la redacción exacta.
- Acepta sinónimos, palabras mal reconocidas y referencias indirectas.
- esValida = true SOLO si la explicación está relacionada con el pendiente.
- No inventes información.

Responde ÚNICAMENTE en JSON:
{
  "esValida": boolean,
  "razon": string
}
`;

    console.log("🤖 Enviando a IA para validación...");
    const aiResult = await smartAICall(prompt);

    if (!aiResult || !aiResult.text) {
      console.error("❌ La IA no respondió correctamente");
      return res.status(503).json({
        esValida: false,
        razon: "La IA no respondió correctamente. Intenta nuevamente."
      });
    }

    console.log("🤖 RESPUESTA DE IA:", aiResult.text);
    const aiEvaluation = parseAIJSONSafe(aiResult.text);

    if (!aiEvaluation.esValida) {
      console.log("❌ Explicación rechazada por IA:", aiEvaluation.razon);
      return res.status(200).json({
        esValida: false,
        razon: aiEvaluation.razon,
        datos: {
          actividad: actividadTitulo,
          pendiente: nombrePendiente,
          emailUsuario: userEmail || userId
        }
      });
    }

    console.log("✅ Explicación validada por IA:", aiEvaluation.razon);

    // 🔥 PREPARAR DATOS PARA GUARDAR
    const emailUsuario = userEmail || userId || "email-no-proporcionado";
    const fechaActual = new Date();

    // Datos completos para guardar
    const datosExplicacion = {
      texto: explicacion,
      emailUsuario: emailUsuario,
      fechaRegistro: fechaActual,
      validadaPorIA: true,
      razonIA: aiEvaluation.razon,
      metadata: {
        sessionId: sessionId,
        duracionMin: duracionMin || duration,
        prioridad: priority,
        fuente: "voz-a-texto",
        version: "1.0"
      }
    };

    console.log("💾 Guardando en base de datos...");

    // 🔥 ACTUALIZACIÓN COMPLETA CON TODOS LOS CAMPOS
    const resultado = await ActividadesSchema.findOneAndUpdate(
      {
        odooUserId: odooUserId,
        "actividades.actividadId": actividadId,
        "actividades.pendientes.pendienteId": idPendiente
      },
      {
        $set: {
          // 1. Descripción básica
          "actividades.$[act].pendientes.$[pend].descripcion": explicacion,

          // 2. Objeto completo de explicación de voz
          "actividades.$[act].pendientes.$[pend].explicacionVoz": datosExplicacion,

          // 3. Metadatos de actividad
          "actividades.$[act].ultimaActualizacion": fechaActual,
          "actividades.$[act].actualizadoPor": emailUsuario,
          "actividades.$[act].fechaRevisionVoz": fechaActual,

          // 4. Metadatos de pendiente
          "actividades.$[act].pendientes.$[pend].ultimaActualizacion": fechaActual,
          "actividades.$[act].pendientes.$[pend].actualizadoPor": emailUsuario,
          "actividades.$[act].pendientes.$[pend].revisadoPorVoz": true,
          "actividades.$[act].pendientes.$[pend].fechaRevisionVoz": fechaActual,

          // 5. Si hay prioridad y duración, actualizarlas
          ...(priority && {
            "actividades.$[act].pendientes.$[pend].prioridad": priority
          }),
          ...(duracionMin && {
            "actividades.$[act].pendientes.$[pend].duracionMin": duracionMin
          })
        },

        // 6. Añadir al historial de explicaciones
        $push: {
          "actividades.$[act].pendientes.$[pend].historialExplicaciones": {
            texto: explicacion,
            emailUsuario: emailUsuario,
            fecha: fechaActual,
            validadaPorIA: true,
            razonIA: aiEvaluation.razon,
            sessionId: sessionId
          }
        }
      },
      {
        arrayFilters: [
          { "act.actividadId": actividadId },
          { "pend.pendienteId": idPendiente }
        ],
        new: true,
        runValidators: true
      }
    );

    if (!resultado) {
      console.error("❌ No se pudo encontrar el documento para actualizar");
      return res.status(404).json({
        esValida: false,
        razon: "No se encontró la actividad o pendiente especificado"
      });
    }

    // 🔍 VERIFICAR LO GUARDADO
    const actividadActualizada = resultado.actividades.find(
      a => a.actividadId === actividadId
    );

    const pendienteGuardado = actividadActualizada?.pendientes.find(
      p => p.pendienteId === idPendiente
    );

    console.log("✅ GUARDADO EXITOSO:");
    console.log("📝 Explicación guardada:", pendienteGuardado?.descripcion);
    console.log("📧 Email del usuario:", pendienteGuardado?.explicacionVoz?.emailUsuario);
    console.log("📅 Fecha de registro:", pendienteGuardado?.explicacionVoz?.fechaRegistro);
    console.log("🤖 Validada por IA:", pendienteGuardado?.explicacionVoz?.validadaPorIA);
    console.log("💾 En historial:", pendienteGuardado?.historialExplicaciones?.length || 0, "registros");

    // 🔍 VERIFICACIÓN EN DB (para debug)
    const verificacionDB = await ActividadesSchema.findOne({
      odooUserId: odooUserId,
      "actividades.actividadId": actividadId,
    }).lean();

    const actividadDB = verificacionDB?.actividades.find(
      a => a.actividadId === actividadId
    );

    const pendienteDB = actividadDB?.pendientes.find(
      p => p.pendienteId === idPendiente
    );

    console.log("🔍 VERIFICACIÓN EN BASE DE DATOS:");
    console.log("📧 Email guardado:", pendienteDB?.explicacionVoz?.emailUsuario);
    console.log("📝 Explicación en DB:", pendienteDB?.descripcion);
    console.log("🔄 Revisado por voz:", pendienteDB?.revisadoPorVoz);

    // 📊 PREPARAR RESPUESTA COMPLETA
    const respuesta = {
      esValida: true,
      mensaje: "Explicación validada y guardada exitosamente",
      datosGuardados: {
        emailUsuario: emailUsuario,
        actividad: {
          id: actividadId,
          titulo: actividadTitulo
        },
        pendiente: {
          id: idPendiente,
          nombre: nombrePendiente
        },
        explicacion: {
          texto: explicacion,
          duracion: duracionMin || duration,
          prioridad: priority
        },
        timestamp: fechaActual.toISOString(),
        validacionIA: {
          esValida: true,
          razon: aiEvaluation.razon
        }
      },
      metadata: {
        sessionId: sessionId,
        totalExplicacionesGuardadas: pendienteGuardado?.historialExplicaciones?.length || 1,
        fechaProcesamiento: new Date().toISOString()
      }
    };

    console.log("📤 Enviando respuesta al cliente...");
    console.log("✅ Estado: EXITOSO");

    return res.status(200).json(respuesta);

  } catch (error) {
    console.error("❌ ERROR EN validarYGuardarExplicacion:");
    console.error("📌 Mensaje:", error.message);
    console.error("📌 Stack:", error.stack);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        esValida: false,
        razon: "Token inválido o expirado"
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        esValida: false,
        razon: "Error de validación de datos",
        detalles: error.message
      });
    }

    return res.status(500).json({
      esValida: false,
      razon: "Error interno del servidor",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

export async function guardarExplicaciones(req, res) {
  try {
    const { explanations, sessionId } = sanitizeObject(req.body);
    const { token } = req.cookies;

    if (!Array.isArray(explanations)) {
      return res.status(400).json({ error: "No se recibieron explicaciones válidas" });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;

    console.log(explanations);

    // 1. Documento raíz del usuario
    let registroUsuario = await ActividadesSchema.findOne({ odooUserId });

    if (!registroUsuario) {
      registroUsuario = await ActividadesSchema.create({
        odooUserId,
        actividades: []
      });
    }

    // 2. Procesar explicaciones
    for (const exp of explanations) {

      // Buscar / crear actividad
      let actividad = registroUsuario.actividades.find(
        a => a.titulo === exp.activityTitle
      );

      if (!actividad) {
        registroUsuario.actividades.push({
          actividadId: `ACT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          titulo: exp.activityTitle,
          fecha: new Date().toISOString().split("T")[0],
          pendientes: []
        });

        actividad = registroUsuario.actividades.at(-1);
      }

      // 3. Buscar pendiente (USANDO id)
      const pendienteIndex = actividad.pendientes.findIndex(
        (p) => p.pendienteId === exp.taskId
      );

      const datosPendiente = {
        pendienteId: exp.taskId,
        nombre: exp.taskName,
        descripcion: exp.explanation,
        terminada: !!exp.confirmed,
        confirmada: !!exp.confirmed,
        duracionMin: exp.duration || 0,
        updatedAt: new Date()
      };


      if (pendienteIndex !== -1) {
        actividad.pendientes[pendienteIndex].descripcion = exp.explanation;
        actividad.pendientes[pendienteIndex].terminada = !!exp.confirmed;
        actividad.pendientes[pendienteIndex].confirmada = !!exp.confirmed;
        actividad.pendientes[pendienteIndex].duracionMin = exp.duration || 0;
        actividad.pendientes[pendienteIndex].updatedAt = new Date();
      } else {
        actividad.pendientes.push({
          ...datosPendiente,
          createdAt: new Date()
        });
      }

    }

    registroUsuario.ultimaSincronizacion = new Date();
    await registroUsuario.save();

    // 4. Historial del bot
    const historial = await HistorialBot.findOne({ sessionId });

    if (historial) {
      explanations.forEach(exp => {
        const estadoIndex = historial.tareasEstado.findIndex(
          t => t.taskId === exp.taskId
        );

        const nuevoEstado = {
          taskId: exp.taskId,
          taskName: exp.taskName,
          actividadTitulo: exp.activityTitle,
          explicada: true,
          validada: exp.confirmed || false,
          explicacion: exp.explanation,
          ultimoIntento: new Date()
        };

        if (estadoIndex !== -1) {
          historial.tareasEstado.set(estadoIndex, nuevoEstado);
        } else {
          historial.tareasEstado.push(nuevoEstado);
        }
      });

      historial.mensajes.push({
        role: "bot",
        contenido: `He guardado las descripciones de ${explanations.length} tareas correctamente.`,
        tipoMensaje: "sistema",
        timestamp: new Date()
      });

      historial.estadoConversacion = "finalizado";
      await historial.save();
    }

    return res.status(200).json({
      success: true,
      message: "Explicaciones guardadas con éxito",
      total: explanations.length,
      sessionId
    });

  } catch (error) {
    console.error("Error en guardarExplicaciones:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

export async function confirmarEstadoPendientes(req, res) {
  try {
    const { pendienteId, actividadId, transcript } = sanitizeObject(req.body);

    if (!actividadId || !pendienteId || !transcript) {
      return res.status(400).json({
        success: false,
        message: "actividadId, pendienteId y transcript son requeridos",
        recibido: { actividadId, pendienteId, transcript }
      });
    }

    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;

    // 3. Buscar el contexto para la IA (Plan de la mañana)
    const registro = await ActividadesSchema.findOne(
      { odooUserId, "actividades.actividadId": actividadId },
      { "actividades.$": 1 }
    );

    if (!registro) {
      return res.status(404).json({ success: false, message: "Actividad no encontrada" });
    }

    const pendienteOriginal = registro.actividades[0].pendientes.find(p => p.pendienteId === pendienteId);

    // 4. Llamada Inteligente a la IA
    const prompt = `
      Analiza si el reporte de voz confirma la realización de la tarea.
      TAREA: "${pendienteOriginal.nombre}"
      REPORTE: "${transcript}"
      Responde SOLO JSON: {"esValido": boolean, "razon": "por qué no", "mensaje": "feedback"}
    `;

    const aiResponse = await smartAICall(prompt);
    const validacion = JSON.parse(aiResponse.text.match(/\{.*\}/s)[0]);

    // 5. Actualizar MongoDB (Usando el esquema Actividades que mostraste al inicio)
    const resultado = await ActividadesSchema.updateOne(
      { odooUserId, "actividades.actividadId": actividadId },
      {
        $set: {
          // 'terminada' y 'confirmada' según tu esquema
          "actividades.$.pendientes.$[pen].terminada": validacion.esValido,
          "actividades.$.pendientes.$[pen].confirmada": true,
          "actividades.$.pendientes.$[pen].motivoNoCompletado": validacion.esValido ? "" : validacion.razon,
          "actividades.$.pendientes.$[pen].fechaFinTerminada": validacion.esValido ? new Date() : null
        }
      },
      {
        arrayFilters: [{ "pen.pendienteId": pendienteId }]
      }
    );

    return res.json({
      success: true,
      terminada: validacion.esValido,
      mensaje: validacion.mensaje,
      provider: aiResponse.provider
    });

  } catch (error) {
    console.error("Error en confirmarEstadoPendientes:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno al validar con IA",
      error: error.message
    });
  }
}

export async function obtenerHistorialSesion(req, res) {
  try {
    const { token } = req.cookies;
    let { sessionId } = req.params;

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const userId = decoded.id;

    if (!sessionId) {
      sessionId = generarSessionIdDiario(userId);
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "No autenticado" });
    }

    const historial = await HistorialBot.findOne({ userId, sessionId }).lean();

    const actividadesCache = await ActividadesSchema.findOne({
      odooUserId: userId
    }).lean();

    const actividadesProcesadas = actividadesCache ? {
      odooUserId: actividadesCache.odooUserId,
      ultimaSincronizacion: actividadesCache.ultimaSincronizacion,
      actividades: (actividadesCache.actividades || []).map(act => ({
        actividadId: act.actividadId,
        titulo: act.titulo,
        tituloProyecto: act.tituloProyecto,
        status: act.status,
        fecha: act.fecha,
        pendientes: (act.pendientes || []).map(p => ({
          pendienteId: p.pendienteId,
          nombre: p.nombre,
          descripcion: p.descripcion || "",
          terminada: p.terminada,
          confirmada: p.confirmada,
          duracionMin: p.duracionMin,
          fechaCreacion: p.fechaCreacion,
          fechaFinTerminada: p.fechaFinTerminada
        }))
      }))
    } : null;

    if (!historial) {
      return res.json({
        success: true,
        data: null,
        actividades: actividadesProcesadas,
        cache: {
          disponible: !!actividadesCache,
          ultimaSincronizacion: actividadesCache?.ultimaSincronizacion || null
        }
      });
    }

    return res.json({
      success: true,
      data: {
        ...historial,
        ultimoAnalisis: historial.ultimoAnalisis
      },
      actividades: actividadesProcesadas,
      cache: {
        disponible: !!actividadesCache,
        ultimaSincronizacion: actividadesCache?.ultimaSincronizacion || null,
        totalActividades: actividadesCache?.actividades?.length || 0
      },
      meta: {
        userId,
        sessionId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("❌ Error al obtener sesión:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message
    });
  }
}

export async function obtenerTodoHistorialSesion(req, res) {
  try {
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({ success: false, message: "No autenticado" });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const userId = decoded.id;

    const hoy = new Date();
    const unaSemanaAtras = new Date(hoy.setDate(hoy.getDate() - 7));
    unaSemanaAtras.setHours(0, 0, 0, 0);
    const historialesSemana = await HistorialBot.find({
      userId,
      createdAt: { $gte: unaSemanaAtras }
    })
      .sort({ createdAt: -1 })
      .lean();

    const actividadesCache = await ActividadesSchema.findOne({
      odooUserId: userId
    }).lean();

    const todasLasTareasValidadas = historialesSemana.reduce((acc, historial) => {
      if (historial.tareasEstado && Array.isArray(historial.tareasEstado)) {
        return [...acc, ...historial.tareasEstado];
      }
      return acc;
    }, []);

    return res.json({
      success: true,
      data: historialesSemana[0] || {},
      historialSemanal: historialesSemana,
      actividades: actividadesCache?.actividades || [],
      tareasEstado: todasLasTareasValidadas,
      cache: {
        disponible: !!actividadesCache,
        ultimaSincronizacion: actividadesCache?.ultimaSincronizacion || null
      },
      meta: {
        rango: "7 días",
        totalSesiones: historialesSemana.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error("❌ Error al obtener el historial semanal:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message
    });
  }
}

export async function obtenerHistorialSidebar(req, res) {
  try {
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({ success: false, message: "Token requerido" });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const userId = decoded.id;

    const historial = await HistorialBot.find({ userId })
      .select("sessionId nombreConversacion userId estadoConversacion createdAt updatedAt")
      .sort({
        estadoConversacion: 1,
        updatedAt: -1
      })
      .lean();

    const data = historial.map((conv) => ({
      sessionId: conv.sessionId,
      nombreConversacion: conv.nombreConversacion?.trim() || `Chat ${new Date(conv.createdAt).toLocaleDateString()}`,
      userId: conv.userId,
      estadoConversacion: conv.estadoConversacion,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt?.toISOString() || conv.createdAt.toISOString(),
    }));

    res.json({ success: true, data });

  } catch (error) {
    console.error("Error al obtener historial sidebar:", error);
    res.status(500).json({
      success: false,
      message: "Error interno del servidor"
    });
  }
}

export async function obtenerTodasExplicacionesAdmin(req, res) {
  try {
    // const { token } = req.cookies;
    // if (!token) {
    //   return res.status(401).json({ success: false, message: "No autenticado" });
    // }

    // const decoded = jwt.verify(token, TOKEN_SECRET);
    // const userId = decoded.id;

    // Verificar si es admin (podrías tener un campo 'rol' en el token)
    // Por ahora, asumimos que todos pueden ver TODO

    // 1. Obtener TODOS los usuarios de ActividadesSchema
    const todosUsuarios = await ActividadesSchema.find({})
      .sort({ updatedAt: -1 })
      .lean();

    // 2. Enriquecer con info de usuario si tienes Users collection
    const usuariosEnriquecidos = await Promise.all(
      todosUsuarios.map(async (usuarioDoc) => {
        try {
          // Si tienes una colección de usuarios, busca info adicional
          const userInfo = await UserModel.findOne({ _id: usuarioDoc.odooUserId }).lean();

          return {
            ...usuarioDoc,
            userInfo: userInfo || null,
            email: userInfo?.email || "No disponible",
            nombre: userInfo?.nombre || userInfo?.username || "Usuario",
            avatar: userInfo?.avatar,
            rol: userInfo?.rol || "user"
          };
        } catch (err) {
          console.warn(`Error enriqueciendo usuario ${usuarioDoc.odooUserId}:`, err);
          return {
            ...usuarioDoc,
            userInfo: null,
            email: "Error al cargar",
            nombre: `Usuario ${usuarioDoc.odooUserId.substring(0, 8)}`,
            rol: "user"
          };
        }
      })
    );

    // 3. Calcular estadísticas generales
    const estadisticas = {
      totalUsuarios: todosUsuarios.length,
      totalActividades: todosUsuarios.reduce((sum, u) => sum + (u.actividades?.length || 0), 0),
      totalTareas: todosUsuarios.reduce((sum, u) =>
        sum + (u.actividades?.reduce((sumAct, act) => sumAct + (act.pendientes?.length || 0), 0) || 0), 0),
      totalTareasTerminadas: todosUsuarios.reduce((sum, u) =>
        sum + (u.actividades?.reduce((sumAct, act) =>
          sumAct + (act.pendientes?.filter(p => p.terminada)?.length || 0), 0) || 0), 0),
      tiempoTotalMinutos: todosUsuarios.reduce((sum, u) =>
        sum + (u.actividades?.reduce((sumAct, act) =>
          sumAct + (act.pendientes?.reduce((sumP, p) => sumP + (p.duracionMin || 0), 0) || 0), 0) || 0), 0),
    };

    // 4. Devolver respuesta estructurada
    return res.json({
      success: true,
      data: {
        usuarios: usuariosEnriquecidos,
        estadisticas,
        metadata: {
          fecha: new Date().toISOString(),
          totalRegistros: todosUsuarios.length,
          usuarioSolicitante: userId
        }
      }
    });

  } catch (error) {
    console.error("❌ Error en obtenerTodasExplicacionesAdmin:", error);
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message
    });
  }
}

export async function consultarIA(req, res) {
  try {
    const { mensaje, sessionId } = sanitizeObject(req.body);
    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const { id: userId } = decoded;

    if (!mensaje || mensaje.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El mensaje es obligatorio"
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "Usuario no autenticado"
      });
    }

    let finalSessionId;

    if (sessionId) {
      // Si viene sessionId desde el frontend, úsalo
      finalSessionId = sessionId;
    } else {
      // Si no viene sessionId, obtener o crear la sesión activa del día
      finalSessionId = await obtenerSesionActivaDelDia(userId);
    }


    await guardarMensajeHistorial({
      userId,
      sessionId: finalSessionId,
      role: "usuario",
      contenido: mensaje,
      tipoMensaje: "texto",
      estadoConversacion: "esperando_bot"
    });



    const contextoMemoria = await memoriaService.generarContextoIA(userId, mensaje);

    const historial = await HistorialBot.findOne(
      { userId, sessionId: finalSessionId },
      { mensajes: { $slice: -10 } }
    ).lean();

    const contextoConversacion = historial?.mensajes
      ?.filter(m => ["usuario", "bot"].includes(m.role))
      .map(m =>
        `${m.role === "usuario" ? "Usuario" : "Asistente"}: ${m.contenido}`
      )
      .join("\n") || "";


    const prompt = `Eres un asistente personal inteligente y versátil. Puedes hablar de cualquier tema de forma natural.

  CONTEXTO DEL USUARIO:
  ${contextoMemoria || 'Esta es la primera vez que hablas con este usuario.'}

  ${contextoConversacion ? `CONVERSACIÓN RECIENTE:\n${contextoConversacion}\n` : ''}

  MENSAJE ACTUAL DEL USUARIO:
  "${mensaje}"

  INSTRUCCIONES:
1. Si dice solo "hola" → responde con saludo simple: "¡Hola! ¿En qué puedo ayudarte?"
2. Si dice "gracias" → responde: "De nada, ¿necesitas algo más?"
3. Si pregunta por actividades/tareas → usa la información disponible
4. NO inventes información que no tienes
5. NO hagas suposiciones sobre el usuario
6. Responde de forma directa y natural
7. Si no entiendes, pide aclaración

  FORMATO DE RESPUESTA (JSON sin markdown):
  {
    "deteccion": "general" | "conversacional" | "técnico",
    "razon": "Breve razón de tu clasificación",
    "respuesta": "Tu respuesta natural, clara, concisa y útil"
  }`;
    const aiResult = await smartAICall(prompt);

    // Limpiar respuesta
    let textoLimpio = aiResult.text.trim();

    // Remover markdown si existe
    if (textoLimpio.includes('```')) {
      textoLimpio = textoLimpio.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    const respuestaIA = parseAIJSONSafe(textoLimpio);

    // Validar respuesta
    if (!respuestaIA || !respuestaIA.respuesta) {


      // Fallback: intentar extraer al menos el texto
      return res.status(200).json({
        success: true,
        respuesta: "Disculpa, tuve un problema al procesar tu mensaje. ¿Podrías ser más específico?"
        , sessionId: finalSessionId
      });
    }

    await guardarMensajeHistorial({
      userId,
      sessionId: finalSessionId,
      role: "bot",
      contenido: respuestaIA.respuesta, // ← Respuesta completa
      tipoMensaje: "respuesta_ia",
      estadoConversacion: "esperando_usuario"
    });


    const mensajeCorto = mensaje.length > 150
      ? mensaje.substring(0, 150) + '...'
      : mensaje;

    const respuestaCorta = respuestaIA.respuesta.length > 150
      ? respuestaIA.respuesta.substring(0, 150) + '...'
      : respuestaIA.respuesta;

    await memoriaService.agregarHistorial(userId, 'usuario', mensajeCorto);
    await memoriaService.agregarHistorial(userId, 'ia', respuestaCorta);


    return res.status(200).json({
      success: true,
      respuesta: respuestaIA.respuesta.trim(),
      deteccion: respuestaIA.deteccion,
      sessionId: finalSessionId
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "Error al conectar con el servicio de IA. Por favor, intenta nuevamente."
    });
  }
}
export async function consultarIAProyecto(req, res) {
  try {
    const { mensaje, sessionId } = sanitizeObject(req.body);
    const { token } = req.cookies;
    const decoded = jwt.verify(token, TOKEN_SECRET);
    const { id: userId, email } = decoded;

    if (!mensaje || mensaje.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El mensaje es obligatorio"
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "Usuario no autenticado"
      });
    }

    let finalSessionId;

    if (sessionId) {
      // Si viene sessionId desde el frontend, úsalo
      finalSessionId = sessionId;
    } else {
      // Si no viene sessionId, obtener o crear la sesión activa del día
      finalSessionId = await obtenerSesionActivaDelDia(userId);
    }

    await guardarMensajeHistorial({
      userId,
      sessionId: finalSessionId,
      role: "usuario",
      contenido: mensaje,
      tipoMensaje: "texto",
      estadoConversacion: "esperando_bot"
    });

    const contextoMemoria = await memoriaService.generarContextoIA(userId, mensaje);

    const registros = await ActividadesSchema.find({ odooUserId: userId }).lean();
    const actividadesResumidas = registros.flatMap(reg =>
      reg.actividades.map(act => {
        const nombresPendientes = act.pendientes
          ?.filter(p => p.nombre)
          .map(p => p.nombre) || [];

        return {
          actividad: act.titulo || "Sin título",
          pendientes: nombresPendientes,
          estado: act.estado || "sin estado"
        };
      })
    );

    const tieneActividades = actividadesResumidas.length > 0;

    const historial = await HistorialBot.findOne(
      { userId, sessionId: finalSessionId },
      { mensajes: { $slice: -10 } }
    ).lean();

    const contextoConversacion = historial?.mensajes
      ?.filter(m => ["usuario", "bot"].includes(m.role))
      .map(m =>
        `${m.role === "usuario" ? "Usuario" : "Asistente"}: ${m.contenido}`
      )
      .join("\n") || "";

    const prompt = `Eres un asistente personal inteligente. Tu trabajo es responder de forma natural, útil y relevante.

  CONTEXTO DEL USUARIO:
  ${contextoMemoria || 'Primera interacción con este usuario.'}

  ${contextoConversacion ? `CONVERSACIÓN RECIENTE:\n${contextoConversacion}\n` : ''}

  ${tieneActividades ? `ACTIVIDADES Y PENDIENTES DEL USUARIO:\n${JSON.stringify(actividadesResumidas, null, 2)}\n` : 'El usuario no tiene actividades registradas.\n'}

  MENSAJE ACTUAL DEL USUARIO:
  "${mensaje}"

  INSTRUCCIONES:
  1. Lee cuidadosamente el mensaje del usuario
  2. Si pregunta sobre sus actividades/proyectos/pendientes, usa la información de ACTIVIDADES
  3. Si pregunta algo general, responde con conocimiento general
  4. Si pregunta por actividades y NO hay ninguna → dile que aún no tiene actividades registradas
  5. Si pregunta por actividades y SÍ hay → muéstrale sus actividades
  6. Responde de forma natural y directa
  7. NO inventes actividades que no existen
  8. Si menciona información nueva sobre él (nombre), tómalo en cuenta
  9. NO inventes información que no tienes
  10. NO asumas cosas del usuario que no están en el contexto
  11. Sé directo y natural en tu respuesta

  FORMATO DE RESPUESTA (JSON sin markdown):
  {
    "deteccion": "proyecto" | "general" | "conversacional",
    "razon": "Breve razón de tu clasificación",
    "respuesta": "Tu respuesta natural y útil"
  }`;

    const aiResult = await smartAICall(prompt);

    // Limpiar respuesta
    let textoLimpio = aiResult.text.trim();

    // Remover markdown si existe
    if (textoLimpio.includes('```')) {
      textoLimpio = textoLimpio.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    const respuestaIA = parseAIJSONSafe(textoLimpio);

    // Validar respuesta
    if (!respuestaIA || !respuestaIA.respuesta) {


      // Fallback: intentar extraer al menos el texto
      return res.status(200).json({
        success: true,
        respuesta: "Disculpa, tuve un problema al procesar tu mensaje. ¿Podrías ser más específico?",
        sessionId: finalSessionId

      });
    }

    await memoriaService.extraerConIA(
      userId,
      email,
      mensaje,
      respuestaIA.respuesta
    );

    const mensajeCorto = mensaje.length > 150
      ? mensaje.substring(0, 150) + '...'
      : mensaje;

    const respuestaCorta = respuestaIA.respuesta.length > 150
      ? respuestaIA.respuesta.substring(0, 150) + '...'
      : respuestaIA.respuesta;

    await memoriaService.agregarHistorial(userId, 'usuario', mensajeCorto);
    await memoriaService.agregarHistorial(userId, 'ia', respuestaCorta);

    await guardarMensajeHistorial({
      userId,
      sessionId: finalSessionId,
      role: "bot",
      contenido: respuestaCorta,
      tipoMensaje: "respuesta_ia",
      estadoConversacion: "esperando_usuario"
    });

    return res.status(200).json({
      success: true,
      respuesta: respuestaIA.respuesta.trim(),
      deteccion: respuestaIA.deteccion,
      sessionId: finalSessionId

    });

  } catch (error) {

    console.log(error);

    return res.status(500).json({
      success: false,
      error: "Error al conectar con el servicio de IA. Por favor, intenta nuevamente."
    });
  }
}

export async function obtenerMensajesConversacion(req, res) {
  try {
    const { sessionId } = req.params;
    const { token } = req.cookies;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No autenticado"
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const userId = decoded.id;

    // Buscar el historial específico
    const historial = await HistorialBot.findOne({
      userId,
      sessionId
    }).lean();

    if (!historial) {
      return res.status(404).json({
        success: false,
        message: "Conversación no encontrada"
      });
    }

    // Buscar también las actividades asociadas
    const actividadesCache = await ActividadesSchema.findOne({
      odooUserId: userId
    }).lean();

    // Transformar mensajes al formato del frontend
    const mensajesFormateados = (historial.mensajes || []).map(msg => ({
      id: msg._id?.toString() || `${Date.now()}-${Math.random()}`,
      type: msg.role === 'usuario' ? 'user' :
        msg.role === 'bot' ? 'bot' : 'system',
      content: msg.contenido,
      timestamp: new Date(msg.timestamp),
      tipoMensaje: msg.tipoMensaje,
      analisis: msg.analisis || null
    }));

    return res.json({
      success: true,
      sessionId: historial.sessionId,
      nombreConversacion: historial.nombreConversacion,
      mensajes: mensajesFormateados,
      ultimoAnalisis: historial.ultimoAnalisis || null,
      tareasEstado: historial.tareasEstado || [],
      estadoConversacion: historial.estadoConversacion,
      actividades: actividadesCache?.actividades || [],
      meta: {
        totalMensajes: mensajesFormateados.length,
        createdAt: historial.createdAt,
        updatedAt: historial.updatedAt
      }
    });

  } catch (error) {

    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message
    });
  }
}

export async function obtenerOCrearSessionActual(req, res) {
  try {
    const { token } = req.cookies;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No autenticado"
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const userId = decoded.id;

    // ✅ Obtener o crear sesión del día (ahora crea en DB automáticamente)
    const sessionId = await obtenerSesionActivaDelDia(userId);

    // ✅ Verificar que se creó correctamente
    const historial = await HistorialBot.findOne({
      userId,
      sessionId
    }).lean();

    if (!historial) {

      return res.status(500).json({
        success: false,
        error: "Error al crear sesión"
      });
    }

    return res.json({
      success: true,
      sessionId,
      userId,
      nombreConversacion: historial.nombreConversacion,
      estadoConversacion: historial.estadoConversacion,
      createdAt: historial.createdAt,
      existe: historial.mensajes?.length > 0
    });

  } catch (error) {

    console.log("Error al obtener o crear sesión actual:", error);

    return res.status(500).json({
      success: false,
      error: "Error interno del servidor"
    });
  }
}

export async function guardarExplicacionesTarde(req, res) {
  try {
    const { queHizo, actividadId, pendienteId } = sanitizeObject(req.body);



    if (!queHizo || !actividadId || !pendienteId) {
      return res.status(400).json({
        success: false,
        message: "Parámetros inválidos",
      });
    }

    const actividadDoc = await ActividadesSchema.findOne({
      "actividades.actividadId": actividadId,
      "actividades.pendientes.pendienteId": pendienteId,
    });

    if (!actividadDoc) {
      return res.status(404).json({
        success: false,
        message: "Actividad no encontrada",
      });
    }

    const actividad = actividadDoc.actividades.find(
      (a) => a.actividadId === actividadId
    );

    if (!actividad) {
      return res.status(404).json({
        success: false,
        message: "Actividad no encontrada",
      });
    }

    const pendiente = actividad.pendientes.find(
      (p) => p.pendienteId === pendienteId
    );

    if (!pendiente) {
      return res.status(404).json({
        success: false,
        message: "Pendiente no encontrado",
      });
    }


    const prompt = `Analiza el siguiente reporte de trabajo y determina si la tarea se puede considerar completada.

TAREA: "${pendiente.nombre}"
DESCRIPCIÓN: "${pendiente.descripcion}"
REPORTE DEL USUARIO: "${queHizo}"

REGLAS DE EVALUACIÓN:
1. Sé FLEXIBLE: Si el usuario menciona haber trabajado en la tarea, haber avanzado significativamente o describe detalles técnicos, márcala como COMPLETADA (true).
2. Solo marca como NO COMPLETADA (false) si el usuario dice explícitamente que no hizo nada, que está totalmente pendiente o que tuvo un bloqueo que le impidió empezar.
3. Ignora muletillas o lenguaje coloquial; enfócate en la intención de haber realizado el trabajo.
4. Debes responder OBLIGATORIAMENTE con un objeto JSON NO VACÍO.
5. NO respondas texto.
6. NO respondas explicaciones fuera del JSON.
7. NO respondas {}.

RESPONDE ÚNICAMENTE EN ESTE FORMATO JSON:
{
  "completada": true o false,
  "confianza": 0.0 a 1.0,
  "razon": "Breve explicación",
  "evidencias": ["frase 1", "frase 2"]
}`;

    const aiResult = await smartAICall(prompt);

    // Limpiar respuesta
    let textoLimpio = aiResult.text.trim();

    // Remover markdown si existe
    if (textoLimpio.includes('```')) {
      textoLimpio = textoLimpio.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    const respuestaIA = parseAIJSONSafe(textoLimpio);

    let validacion = {};
    if (respuestaIA) {
      try {
        validacion = JSON.parse(respuestaIA);
      } catch {
        validacion = {};
      }
    }




    const estaTerminada = typeof validacion.completada === 'boolean'
      ? validacion.completada
      : true;

    pendiente.queHizo = queHizo;
    pendiente.terminada = estaTerminada;

    if (estaTerminada) {
      pendiente.fechaFinTerminada = new Date();
    }

    actividad.ultimaActualizacion = new Date();
    await actividadDoc.save();

    const respuestaFinal = {
      success: true,
      completada: estaTerminada,
      confianza: respuestaIA.confianza || 1.0,
      razon: respuestaIA.razon || "",
      evidencias: [],
      message: respuestaIA.message ? "Tarea marcada como completada" : "Tarea marcada como no completada",
    };


    return res.json(respuestaFinal);

  } catch (error) {

    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message,
    });
  }
}

export async function eliminarConversacion(req, res) {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "El ID de la sesión es requerido",
      });
    }

    const resultado = await HistorialBot.deleteOne({ sessionId });

    if (resultado.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Conversación no encontrada",
      });
    }

    return res.json({
      success: true,
      message: "Conversación eliminada exitosamente",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al eliminar la conversación",
      error: error.message,
    });
  }
}