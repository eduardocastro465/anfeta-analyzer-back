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
import { detectarCambiosEnRevisiones } from "../Helpers/actividades.helpers.js";
import { generarHashActividades } from "../Helpers/generarHashActividades.helper.js";
import { detectarYSincronizarCambios, detectarCambiosSinSincronizar } from "../Helpers/detectarCambiosActividades.helper.js";
import crypto from 'crypto';

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
          ultimaModificacion: new Date().toISOString(),
          ultimaActualizacion: new Date().toISOString(),
          checksum: "" // ✅ NUEVO
        },
        timestamp: new Date().toISOString(),
        email: email
      });
    }

    let totalTareasSinDescripcion = 0;
    let totalTareasConDescripcion = 0;
    let totalTareas = 0;
    let totalActividadesConTareas = 0;
    let ultimaModificacion = new Date(0);
    let ultimaActualizacion = new Date(0);

    // ✅ NUEVO: Array para generar checksum
    const tareasParaHash = [];

    documento.actividades.forEach(actividad => {
      if (!actividad.pendientes || actividad.pendientes.length === 0) {
        return;
      }

      let actividadTieneTareasPendientes = false;

      actividad.pendientes.forEach(pendiente => {
        if (pendiente.terminada === true || pendiente.confirmada === true) {
          return;
        }

        if (!pendiente.duracionMin || pendiente.duracionMin <= 0) {
          return;
        }

        actividadTieneTareasPendientes = true;
        totalTareas++;

        const tieneDescripcion = pendiente.descripcion &&
          pendiente.descripcion.trim().length > 0;

        if (tieneDescripcion) {
          totalTareasConDescripcion++;
        } else {
          totalTareasSinDescripcion++;
        }

        // ✅ NUEVO: Agregar al array para hash
        tareasParaHash.push({
          id: pendiente._id ? pendiente._id.toString() : pendiente.id || String(Math.random()),
          descripcion: pendiente.descripcion || "",
          duracionMin: pendiente.duracionMin,
          ultimaActualizacion: pendiente.ultimaActualizacion
        });

        if (pendiente.ultimaActualizacion) {
          const fechaPendiente = new Date(pendiente.ultimaActualizacion);
          if (fechaPendiente > ultimaModificacion) {
            ultimaModificacion = fechaPendiente;
          }
        }
      });

      if (actividadTieneTareasPendientes) {
        totalActividadesConTareas++;

        if (actividad.ultimaActualizacion) {
          const fechaActividad = new Date(actividad.ultimaActualizacion);
          if (fechaActividad > ultimaActualizacion) {
            ultimaActualizacion = fechaActividad;
          }
        }
      }
    });

    // ✅ NUEVO: Generar checksum simple
    const checksumString = JSON.stringify(tareasParaHash);
    const checksum = crypto
      .createHash('md5')
      .update(checksumString)
      .digest('hex');

    const resultado = {
      totalTareasSinDescripcion,
      totalTareasConDescripcion,
      totalTareas,
      totalActividadesConTareas,
      ultimaModificacion: ultimaModificacion.toISOString(),
      ultimaActualizacion: ultimaActualizacion.toISOString(),
      checksum // ✅ NUEVO
    };

    return res.json({
      success: true,
      cambios: resultado,
      timestamp: new Date().toISOString(),
      email: email,
      userId: userId
    });

  } catch (error) {
    console.error("Error en verificarCambiosTareas:", error);

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

// export async function getActividadesConRevisiones(req, res) {
//   try {
//     const {
//       email,
//       question = "¿Qué actividades y revisiones tengo hoy? ¿Qué me recomiendas priorizar?",
//       showAll = false
//     } = sanitizeObject(req.body);

//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         message: "El email es requerido"
//       });
//     }

//     const usersData = await getAllUsers();
//     const user = usersData.items.find(
//       (u) => u.email.toLowerCase() === email.toLowerCase()
//     );

//     if (!user) {
//       return res.status(404).json({ error: 'Usuario no encontrado' });
//     }

//     const { token } = req.cookies;
//     const decoded = jwt.verify(token, TOKEN_SECRET);
//     const odooUserId = decoded.id;
//     const sessionId = await obtenerSesionActivaDelDia(odooUserId);

//     const today = new Date().toISOString().split('T')[0];

//     const actividadesResponse = await axios.get(
//       `${API_URL_ANFETA}/actividades/assignee/${email}/del-dia`
//     );
//     const actividadesRaw = actividadesResponse.data.data;

//     if (!Array.isArray(actividadesRaw) || actividadesRaw.length === 0) {
//       return res.json({
//         success: true,
//         answer: "No tienes actividades registradas para hoy",
//         sessionId: sessionId,
//         actividades: [],
//         revisionesPorActividad: {}
//       });
//     }

//     const esActividadValida = (actividad) => {
//       const titulo = actividad.titulo?.toLowerCase() || "";
//       return !titulo.startsWith("00ftf") && actividad.status !== "00sec";
//     };

//     let actividadesFiltradas = actividadesRaw.filter(esActividadValida);

//     if (actividadesFiltradas.length === 0) {
//       return res.json({
//         success: true,
//         answer: "Todas tus actividades de hoy son de tipo 00ftf o 00sec (filtradas automáticamente)",
//         sessionId: sessionId,
//         actividades: [],
//         revisionesPorActividad: {}
//       });
//     }

//     // 4 Filtrar por horario laboral (9:30 - 17:00)
//     const HORARIO_INICIO = 9.5;  // 9:30 AM
//     const HORARIO_FIN = 17.0;    // 5:00 PM

//     const actividadesEnHorarioLaboral = actividadesFiltradas.filter(actividad => {
//       const horaInicioDecimal = convertirHoraADecimal(actividad.horaInicio);
//       const horaFinDecimal = convertirHoraADecimal(actividad.horaFin);
//       return horaInicioDecimal >= HORARIO_INICIO &&
//         horaInicioDecimal < HORARIO_FIN &&
//         horaFinDecimal <= HORARIO_FIN;
//     });

//     if (actividadesEnHorarioLaboral.length === 0) {
//       return res.json({
//         success: true,
//         answer: "No tienes actividades programadas en horario laboral (09:30-17:00).",
//         sessionId: sessionId,
//         actividades: [],
//         revisionesPorActividad: {}
//       });
//     }

//     // 5 IDs de actividades en horario laboral
//     const actividadIdsHorarioLaboral = new Set(
//       actividadesEnHorarioLaboral.map(a => a.id)
//     );

//     // 6 Obtener revisiones (2da llamada HTTP)
//     let todasRevisiones = { colaboradores: [] };
//     try {
//       const revisionesResponse = await axios.get(
//         `${API_URL_ANFETA}/reportes/revisiones-por-fecha`,
//         {
//           params: {
//             date: today,
//             colaborador: email
//           }
//         }
//       );
//       if (revisionesResponse.data?.success) {
//         todasRevisiones = revisionesResponse.data.data || { colaboradores: [] };
//       }
//     } catch (e) {
//       console.warn("Error obteniendo revisiones:", e.message);
//     }

//     // 7 Procesar revisiones y extraer colaboradores
//     const revisionesPorActividad = {};
//     const actividadesConRevisionesConTiempoIds = new Set();
//     const todosColaboradoresSet = new Set();

//     if (todasRevisiones.colaboradores && Array.isArray(todasRevisiones.colaboradores)) {
//       todasRevisiones.colaboradores.forEach(colaborador => {
//         (colaborador.items?.actividades ?? []).forEach(actividadRev => {
//           // Filtro 1: Solo actividades en horario laboral
//           if (!actividadIdsHorarioLaboral.has(actividadRev.id)) return;

//           // Filtro 2: Excluir 00ftf
//           if (actividadRev.titulo.toLowerCase().includes('00ftf')) return;

//           // Filtro 3: Verificar pendientes
//           if (!actividadRev.pendientes || actividadRev.pendientes.length === 0) return;

//           const actividadOriginal = actividadesEnHorarioLaboral.find(a => a.id === actividadRev.id);
//           if (!actividadOriginal) return;

//           // ✅ MOVER: Inicializar Set ANTES del loop
//           const colaboradoresActividad = new Set();

//           // Inicializar estructura
//           revisionesPorActividad[actividadRev.id] = {
//             actividad: {
//               id: actividadRev.id,
//               titulo: actividadOriginal?.titulo || actividadRev.titulo,
//               horaInicio: actividadOriginal.horaInicio || "00:00",
//               horaFin: actividadOriginal.horaFin || "00:00",
//               status: actividadOriginal.status || "Sin status",
//               proyecto: actividadOriginal.tituloProyecto || "Sin proyecto",
//               colaboradores: [], // ✅ Se llenará después
//               assigneesDirectos: [] // ✅ Se llenará después
//             },
//             pendientesConTiempo: [],
//             pendientesSinTiempo: []
//           };

//           // Procesar pendientes
//           (actividadRev.pendientes ?? []).forEach(p => {
//             // Filtro 4: Verificar asignación al usuario
//             const estaAsignado = p.assignees?.some(a => a.name === email);
//             if (!estaAsignado) return;

//             // ✅ NUEVO: Extraer colaboradores SOLO de tareas asignadas a ti
//             (p.assignees ?? []).forEach(assignee => {
//               if (!assignee.name) return;

//               // Excluir al usuario actual
//               if (assignee.name.toLowerCase() === email.toLowerCase()) return;

//               const nombreLimpio = limpiarNombreColaborador(assignee.name);
//               colaboradoresActividad.add(nombreLimpio);
//               todosColaboradoresSet.add(nombreLimpio);
//             });

//             const pendienteInfo = {
//               id: p.id,
//               nombre: p.nombre,
//               terminada: p.terminada,
//               confirmada: p.confirmada,
//               duracionMin: p.duracionMin || 0,
//               fechaCreacion: p.fechaCreacion,
//               fechaFinTerminada: p.fechaFinTerminada,
//               diasPendiente: p.fechaCreacion ?
//                 Math.floor((new Date() - new Date(p.fechaCreacion)) / (1000 * 60 * 60 * 24)) : 0,
//               colaboradores: p.assignees ?
//                 p.assignees
//                   .map(a => limpiarNombreColaborador(a.name))
//                   .filter(nombre => nombre && nombre.toLowerCase() !== email.toLowerCase()) // ✅ Excluir usuario actual
//                 : []
//             };

//             // Clasificar: Con tiempo vs Sin tiempo
//             if (p.duracionMin && p.duracionMin > 0) {
//               pendienteInfo.prioridad = p.duracionMin > 60 ? "ALTA" :
//                 p.duracionMin > 30 ? "MEDIA" : "BAJA";
//               revisionesPorActividad[actividadRev.id].pendientesConTiempo.push(pendienteInfo);
//               actividadesConRevisionesConTiempoIds.add(actividadRev.id);
//             } else {
//               pendienteInfo.prioridad = "SIN TIEMPO";
//               revisionesPorActividad[actividadRev.id].pendientesSinTiempo.push(pendienteInfo);
//             }
//           });

//           // ✅ NUEVO: Asignar colaboradores DESPUÉS del loop
//           revisionesPorActividad[actividadRev.id].actividad.colaboradores = Array.from(colaboradoresActividad);
//           revisionesPorActividad[actividadRev.id].actividad.assigneesDirectos = Array.from(colaboradoresActividad);

//           // Eliminar si no tiene tareas con tiempo
//           if (revisionesPorActividad[actividadRev.id].pendientesConTiempo.length === 0) {
//             delete revisionesPorActividad[actividadRev.id];
//           }
//         });
//       });
//     }

//     // 8 Actividades finales
//     const actividadesFinales = actividadesEnHorarioLaboral.filter(actividad =>
//       actividadesConRevisionesConTiempoIds.has(actividad.id)
//     );

//     if (actividadesFinales.length === 0) {
//       return res.json({
//         success: true,
//         answer: "No tienes actividades con tareas que tengan tiempo estimado en horario laboral (09:30-17:00).",
//         sessionId: sessionId,
//         actividades: [],
//         revisionesPorActividad: {}
//       });
//     }

//     // 9 Calcular métricas
//     let totalTareasConTiempo = 0;
//     let totalTareasSinTiempo = 0;
//     let tareasAltaPrioridad = 0;
//     let tiempoTotalEstimado = 0;

//     actividadesFinales.forEach(actividad => {
//       const revisiones = revisionesPorActividad[actividad.id] || {
//         pendientesConTiempo: [],
//         pendientesSinTiempo: []
//       };
//       totalTareasConTiempo += revisiones.pendientesConTiempo.length;
//       totalTareasSinTiempo += revisiones.pendientesSinTiempo.length;
//       tareasAltaPrioridad += revisiones.pendientesConTiempo.filter(t => t.prioridad === "ALTA").length;
//       tiempoTotalEstimado += revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0);
//     });

//     const horasTotales = Math.floor(tiempoTotalEstimado / 60);
//     const minutosTotales = tiempoTotalEstimado % 60;
//     const colaboradoresTotales = Array.from(todosColaboradoresSet);

//     // 10 Determinar proyecto principal
//     let proyectoPrincipal = "Sin proyecto específico";
//     if (actividadesFinales.length > 0) {
//       const actividadPrincipal = actividadesFinales[0];
//       if (actividadPrincipal.tituloProyecto && actividadPrincipal.tituloProyecto !== "Sin proyecto") {
//         proyectoPrincipal = actividadPrincipal.tituloProyecto;
//       } else if (actividadPrincipal.titulo) {
//         const tituloLimpio = actividadPrincipal.titulo
//           .replace('analizador de pendientes 00act', '')
//           .replace('anfeta', '')
//           .replace(/00\w+/g, '')
//           .trim();
//         proyectoPrincipal = tituloLimpio || actividadPrincipal.titulo.substring(0, 50) + "...";
//       }
//     }

//     // 11 Construir prompt para IA
//     const prompt = `
// Eres un asistente que analiza ÚNICAMENTE actividades que:
// 1. Tienen revisiones CON TIEMPO estimado
// 2. Están en horario laboral (09:30-17:00)
// 3. Se han filtrado actividades 00ftf y status 00sec

// Usuario: ${user.firstName} (${email})

// RESUMEN DE ACTIVIDADES CON REVISIONES CON TIEMPO (09:30-17:00):
// - Total actividades: ${actividadesFinales.length}
// - Total tareas con tiempo: ${totalTareasConTiempo}
// - Tareas de alta prioridad: ${tareasAltaPrioridad}
// - Tiempo estimado total: ${horasTotales}h ${minutosTotales}m
// - Colaboradores involucrados: ${colaboradoresTotales.length > 0 ? colaboradoresTotales.join(', ') : 'Ninguno'}

// DETALLE DE ACTIVIDADES (SOLO TAREAS CON TIEMPO):
// ${actividadesFinales.map((actividad, index) => {
//       const revisiones = revisionesPorActividad[actividad.id] || { pendientesConTiempo: [], pendientesSinTiempo: [] };
//       const conTiempo = revisiones.pendientesConTiempo;

//       let actividadTexto = `
// ${index + 1}. ${actividad.horaInicio} - ${actividad.horaFin} - ${actividad.titulo}
//    • Proyecto: ${revisiones.actividad?.proyecto || "Sin proyecto"}
//    • Estado: ${actividad.status}
//    • Equipo: ${revisiones.actividad?.colaboradores?.join(', ') || 'Solo tú'}
//    • Tareas con tiempo: ${conTiempo.length}`;

//       if (conTiempo.length > 0) {
//         actividadTexto += `
//    • TIEMPO TOTAL: ${revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0)}min`;
//         conTiempo.forEach((tarea, i) => {
//           actividadTexto += `
//      ${i + 1}. ${tarea.nombre}
//         - ${tarea.duracionMin} min | Prioridad: ${tarea.prioridad} | Dias pendiente: ${tarea.diasPendiente}d
//         - Asignado a: ${tarea.colaboradores?.join(', ') || 'Solo tú'}`;
//         });
//       }

//       return actividadTexto;
//     }).join('\n')}

// PREGUNTA DEL USUARIO: "${question}"

// INSTRUCCIONES ESTRICTAS DE RESPUESTA:
// 1. COMIENZA específicamente: "En tu horario laboral (09:30-17:00), tienes ${actividadesFinales.length} actividades con tareas que tienen tiempo estimado"
// 2. MENCIONA a los colaboradores de cada actividad: "En 'X actividad' trabajas con [nombres]"
// 3. ENFÓCATE EXCLUSIVAMENTE en las tareas CON TIEMPO (${totalTareasConTiempo} tareas)
// 4. Da RECOMENDACIONES ESPECÍFICAS considerando:
//    - Tareas de ALTA prioridad primero
//    - Colaboración con el equipo
//    - Tiempo disponible en el horario
// 5. Sugiere un ORDEN DE EJECUCIÓN claro
// 6. MÁXIMO 6-8 renglones
// 7. SIN emojis
// 8. EVITA mencionar "tareas sin tiempo", "sin estimación", etc.
// `.trim();

//     // 12 Llamar a IA
//     const aiResult = await smartAICall(prompt);

//     // 13 Obtener actividades guardadas (para descripciones)
//     const actividadesGuardadas = await ActividadesSchema.findOne({
//       odooUserId: odooUserId
//     });

//     // 14 Preparar respuesta estructurada
//     const respuestaData = {
//       actividades: actividadesFinales.map(a => {
//         const revisiones = revisionesPorActividad[a.id];
//         return {
//           id: a.id,
//           titulo: a.titulo,
//           horario: `${a.horaInicio} - ${a.horaFin}`,
//           status: a.status,
//           proyecto: revisiones?.actividad?.proyecto || "Sin proyecto",
//           colaboradores: revisiones?.actividad?.colaboradores || [],
//           assigneesOriginales: revisiones?.actividad?.assigneesDirectos || [],
//           esHorarioLaboral: true,
//           tieneRevisionesConTiempo: true
//         };
//       }),
//       revisionesPorActividad: actividadesFinales
//         .map(actividad => {
//           const revisiones = revisionesPorActividad[actividad.id];
//           if (!revisiones || revisiones.pendientesConTiempo.length === 0) return null;

//           const actividadGuardada = actividadesGuardadas?.actividades?.find(
//             a => a.actividadId === actividad.id
//           );

//           return {
//             actividadId: actividad.id,
//             actividadTitulo: actividad.titulo,
//             actividadHorario: `${actividad.horaInicio} - ${actividad.horaFin}`,
//             colaboradores: revisiones.actividad?.colaboradores || [],
//             assigneesOriginales: revisiones.actividad?.assigneesDirectos || [],
//             tareasConTiempo: revisiones.pendientesConTiempo.map(tarea => {
//               // Buscar descripción en la actividad guardada
//               const pendienteGuardado = actividadGuardada?.pendientes?.find(
//                 p => p.pendienteId === tarea.id
//               );

//               return {
//                 ...tarea,
//                 descripcion: pendienteGuardado?.descripcion || ""
//               };
//             }),
//             totalTareasConTiempo: revisiones.pendientesConTiempo.length,
//             tareasAltaPrioridad: revisiones.pendientesConTiempo.filter(t => t.prioridad === "ALTA").length,
//             tiempoTotal: revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0),
//             tiempoFormateado: `${Math.floor(revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0) / 60)}h ${revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0) % 60}m`
//           };
//         })
//         .filter(item => item !== null)
//     };

//     // 15 Preparar análisis completo
//     const analisisCompleto = {
//       success: true,
//       answer: aiResult.text,
//       provider: aiResult.provider,
//       sessionId: sessionId,
//       proyectoPrincipal: proyectoPrincipal,
//       metrics: {
//         totalActividades: actividadesFiltradas.length,
//         totalPendientes: totalTareasConTiempo,
//         pendientesAltaPrioridad: tareasAltaPrioridad,
//         tiempoEstimadoTotal: `${horasTotales}h ${minutosTotales}m`,
//         actividadesConPendientes: actividadesFinales.length,
//         tareasConTiempo: totalTareasConTiempo,
//         tareasSinTiempo: totalTareasSinTiempo,
//         tareasAltaPrioridad: tareasAltaPrioridad,
//         totalColaboradores: colaboradoresTotales.length
//       },
//       data: respuestaData,
//       colaboradoresTotales: colaboradoresTotales,
//       separadasPorTiempo: true,
//       sugerencias: []
//     };

//     // 16 Preparar estado de tareas
//     const tareasEstadoArray = respuestaData.revisionesPorActividad.flatMap(r =>
//       (r.tareasConTiempo || []).map(t => ({
//         taskId: t.id,
//         taskName: t.nombre,
//         actividadTitulo: r.actividadTitulo,
//         explicada: false,
//         validada: false,
//         explicacion: "",
//         ultimoIntento: null
//       }))
//     );

//     // 17 Generar nombre de conversación con IA
//     const promptNombreConversacion = `
// Genera un TÍTULO MUY CORTO para una conversación.

// ACTIVIDADES:
// ${actividadesFinales.map(a => `- ${a.titulo}`).join('\n')}

// CONTEXTO:
// - Proyecto principal: "${proyectoPrincipal}"
// - Tareas con tiempo: ${totalTareasConTiempo}
// - Tareas alta prioridad: ${tareasAltaPrioridad}
// - Colaboradores: ${colaboradoresTotales.length > 0 ? colaboradoresTotales.join(', ') : 'Solo tú'}

// REGLAS OBLIGATORIAS:
// - MÁXIMO 2 PALABRAS
// - Solo letras y espacios
// - Sin emojis
// - Sin signos de puntuación
// - No frases completas
// - Idioma español

// RESPONDE SOLO EL TÍTULO
// `.trim();

//     let nombreConversacionIA = "Nueva conversación";
//     try {
//       const aiNombre = await smartAICall(promptNombreConversacion);
//       if (aiNombre?.text) {
//         nombreConversacionIA = aiNombre.text.trim().slice(0, 60);
//       }
//     } catch (e) {
//       console.warn("No se pudo generar nombre de conversación con IA");
//     }

//     // 18 Guardar en base de datos (Actividades)
//     const actividadesExistentes = await ActividadesSchema.findOne({
//       odooUserId: odooUserId
//     });

//     const actividadesParaGuardar = actividadesFinales.map(actividad => {
//       const revisiones = revisionesPorActividad[actividad.id];

//       const todasLasTareas = [
//         ...(revisiones.pendientesConTiempo || []),
//         ...(revisiones.pendientesSinTiempo || [])
//       ];

//       // Buscar la actividad existente para preservar descripciones
//       const actividadExistente = actividadesExistentes?.actividades?.find(
//         a => a.actividadId === actividad.id
//       );

//       return {
//         actividadId: actividad.id,
//         titulo: actividad.titulo,
//         horaInicio: actividad.horaInicio,
//         horaFin: actividad.horaFin,
//         status: actividad.status,
//         fecha: today,
//         colaboradores: revisiones.actividad?.colaboradores || [],
//         assigneesOriginales: revisiones.actividad?.assigneesDirectos || [],
//         pendientes: todasLasTareas.map(t => {
//           const pendienteExistente = actividadExistente?.pendientes?.find(
//             p => p.pendienteId === t.id
//           );

//           return {
//             pendienteId: t.id,
//             nombre: t.nombre,
//             descripcion: t.descripcion && t.descripcion.trim() !== ""
//               ? t.descripcion
//               : (pendienteExistente?.descripcion || ""),
//             queHizo: t.queHizo && t.queHizo.trim() !== ""
//               ? t.queHizo
//               : (pendienteExistente?.queHizo || ""),
//             terminada: t.terminada,
//             confirmada: t.confirmada,
//             duracionMin: t.duracionMin,
//             fechaCreacion: t.fechaCreacion,
//             fechaFinTerminada: t.fechaFinTerminada,
//             colaboradores: t.colaboradores || []
//           };
//         }),
//         ultimaActualizacion: new Date()
//       };
//     });

//     await ActividadesSchema.findOneAndUpdate(
//       { odooUserId: odooUserId },
//       {
//         $set: {
//           odooUserId: odooUserId,
//           actividades: actividadesParaGuardar,
//           ultimaSincronizacion: new Date()
//         }
//       },
//       { upsert: true, new: true }
//     );

//     // 19 Guardar en historial (solo si no existe análisis inicial)
//     const sesionExistente = await HistorialBot.findOne({
//       userId: odooUserId,
//       sessionId: sessionId
//     });

//     const yaExisteAnalisisInicial = sesionExistente?.mensajes?.some(
//       msg => msg.tipoMensaje === "analisis_inicial"
//     );

//     if (!yaExisteAnalisisInicial) {
//       await HistorialBot.findOneAndUpdate(
//         {
//           userId: odooUserId,
//           sessionId: sessionId
//         },
//         {
//           $set: {
//             nombreConversacion: nombreConversacionIA,
//             tareasEstado: tareasEstadoArray,
//             ultimoAnalisis: analisisCompleto,
//             estadoConversacion: "mostrando_actividades"
//           },
//           $push: {
//             mensajes: {
//               role: "bot",
//               contenido: aiResult.text,
//               timestamp: new Date(),
//               tipoMensaje: "analisis_inicial",
//               analisis: analisisCompleto
//             }
//           }
//         },
//         {
//           upsert: true,
//           new: true
//         }
//       );
//     }

//     // 20 Respuesta final
//     return res.json({
//       success: true,
//       answer: aiResult.text,
//       provider: aiResult.provider,
//       sessionId: sessionId,
//       proyectoPrincipal: proyectoPrincipal,
//       colaboradoresInvolucrados: colaboradoresTotales,
//       metrics: {
//         totalActividadesProgramadas: actividadesFiltradas.length,
//         actividadesConTiempoTotal: Array.from(actividadesConRevisionesConTiempoIds).length,
//         actividadesFinales: actividadesFinales.length,
//         tareasConTiempo: totalTareasConTiempo,
//         tareasAltaPrioridad: tareasAltaPrioridad,
//         tiempoEstimadoTotal: `${horasTotales}h ${minutosTotales}m`,
//         totalColaboradores: colaboradoresTotales.length
//       },
//       data: respuestaData,
//       multiActividad: true,
//       filtrosAplicados: {
//         excluir00ftf: true,
//         excluir00sec: true,
//         soloHorarioLaboral: "09:30-17:00",
//         soloTareasConTiempo: true,
//         excluirTareasSinTiempo: true
//       }
//     });

//   } catch (error) {

//     console.error("Error en getActividadesConRevisiones:", error);
//     if (error.message === "AI_PROVIDER_FAILED") {
//       console.error(error.cause);
//       return res.status(503).json({
//         success: false,
//         message: "El asistente está muy ocupado. Intenta de nuevo en un minuto."
//       });
//     }

//     if (isGeminiQuotaError(error)) {
//       return res.status(429).json({
//         success: false,
//         reason: "QUOTA_EXCEEDED",
//         message: "El asistente está temporalmente saturado."
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Error interno",
//       error: error.message
//     });
//   }
// }

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

    // 4 Filtrar por horario laboral (9:30 - 17:00)
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

    // 5 IDs de actividades en horario laboral
    const actividadIdsHorarioLaboral = new Set(
      actividadesEnHorarioLaboral.map(a => a.id)
    );

    // 6 Obtener revisiones (2da llamada HTTP)
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

    // 7 Procesar revisiones y extraer colaboradores
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

          // ✅ MOVER: Inicializar Set ANTES del loop
          const colaboradoresActividad = new Set();

          // Inicializar estructura
          revisionesPorActividad[actividadRev.id] = {
            actividad: {
              id: actividadRev.id,
              titulo: actividadOriginal?.titulo || actividadRev.titulo,
              horaInicio: actividadOriginal.horaInicio || "00:00",
              horaFin: actividadOriginal.horaFin || "00:00",
              status: actividadOriginal.status || "Sin status",
              proyecto: actividadOriginal.tituloProyecto || "Sin proyecto",
              colaboradores: [], // ✅ Se llenará después
              assigneesDirectos: [] // ✅ Se llenará después
            },
            pendientesConTiempo: [],
            pendientesSinTiempo: []
          };

          // Procesar pendientes
          (actividadRev.pendientes ?? []).forEach(p => {
            // Filtro 4: Verificar asignación al usuario
            const estaAsignado = p.assignees?.some(a => a.name === email);
            if (!estaAsignado) return;

            // ✅ NUEVO: Extraer colaboradores SOLO de tareas asignadas a ti
            (p.assignees ?? []).forEach(assignee => {
              if (!assignee.name) return;

              // Excluir al usuario actual
              if (assignee.name.toLowerCase() === email.toLowerCase()) return;

              const nombreLimpio = limpiarNombreColaborador(assignee.name);
              colaboradoresActividad.add(nombreLimpio);
              todosColaboradoresSet.add(nombreLimpio);
            });

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
                p.assignees
                  .map(a => limpiarNombreColaborador(a.name))
                  .filter(nombre => nombre && nombre.toLowerCase() !== email.toLowerCase()) // ✅ Excluir usuario actual
                : []
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

          // ✅ NUEVO: Asignar colaboradores DESPUÉS del loop
          revisionesPorActividad[actividadRev.id].actividad.colaboradores = Array.from(colaboradoresActividad);
          revisionesPorActividad[actividadRev.id].actividad.assigneesDirectos = Array.from(colaboradoresActividad);

          // Eliminar si no tiene tareas con tiempo
          if (revisionesPorActividad[actividadRev.id].pendientesConTiempo.length === 0) {
            delete revisionesPorActividad[actividadRev.id];
          }
        });
      });
    }

    // 8 Actividades finales
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

    // 🟢 GENERAR HASH
    const hashActual = await generarHashActividades(actividadesFinales, revisionesPorActividad);

    const documentoUsuario = await ActividadesSchema.findOne({
      odooUserId: odooUserId
    });

    let aiResult;
    let promptGenerado = "";
    let analisisReutilizado = false;

    // 🟢 VERIFICAR SI EXISTE ANÁLISIS GUARDADO Y ES VÁLIDO
    if (
      documentoUsuario?.analisisGuardado?.vigente &&
      documentoUsuario.analisisGuardado.hashActividades === hashActual
    ) {
      console.log("✅ Reutilizando análisis guardado (sin cambios)");
      console.log("📊 Hash actual:", hashActual);
      console.log("📊 Hash guardado:", documentoUsuario.analisisGuardado.hashActividades);

      analisisReutilizado = true;

      aiResult = {
        text: documentoUsuario.analisisGuardado.respuesta,
        provider: documentoUsuario.analisisGuardado.provider
      };

      promptGenerado = documentoUsuario.analisisGuardado.prompt;

    } else {
      // 🟢 SI NO EXISTE, GENERAR NUEVO ANÁLISIS
      console.log("🆕 Generando nuevo análisis con IA...");

      // 🔍 LOGS DE DEBUG
      if (!documentoUsuario) {
        console.log("❌ No existe documento del usuario");
      } else if (!documentoUsuario.analisisGuardado) {
        console.log("❌ No existe analisisGuardado en el documento");
      } else if (!documentoUsuario.analisisGuardado.vigente) {
        console.log("❌ El análisis guardado no está vigente");
      } else {
        console.log("📊 Hash diferente:");
        console.log("   - Hash actual:", hashActual);
        console.log("   - Hash guardado:", documentoUsuario.analisisGuardado.hashActividades);
      }

      // Detectar cambios
      const cambiosDetectados = await detectarCambiosEnRevisiones(
        odooUserId,
        actividadesFinales,
        sessionId
      );


      // Construir mensaje de cambios
      let mensajeAdicionalCambios = "";
      if (cambiosDetectados.cambiosDetectados && !cambiosDetectados.esPrimeraVez) {
        mensajeAdicionalCambios = `
📊 CAMBIOS DETECTADOS EN TUS REVISIONES:
`;

        if (cambiosDetectados.revisionesNuevas.length > 0) {
          mensajeAdicionalCambios += `
✅ NUEVAS REVISIONES AGREGADAS (${cambiosDetectados.revisionesNuevas.length}):
${cambiosDetectados.revisionesNuevas.map(r => {
            const revisiones = revisionesPorActividad[r.id];
            const totalTareas = revisiones?.pendientesConTiempo?.length || 0;
            const tiempoTotal = revisiones?.pendientesConTiempo?.reduce((sum, t) => sum + (t.duracionMin || 0), 0) || 0;
            return `   - ${r.titulo} (${r.horaInicio}-${r.horaFin}) - ${totalTareas} tareas, ${tiempoTotal}min`;
          }).join('\n')}
`;
        }

        if (cambiosDetectados.revisionesEliminadas.length > 0) {
          mensajeAdicionalCambios += `
❌ REVISIONES MOVIDAS O ELIMINADAS (${cambiosDetectados.revisionesEliminadas.length}):
${cambiosDetectados.revisionesEliminadas.map(r =>
            `   - ${r.titulo} (${r.horaInicio}-${r.horaFin}) - Ya no está en tu agenda de hoy`
          ).join('\n')}
`;
        }

        if (cambiosDetectados.cambiosEnTareas.length > 0) {
          mensajeAdicionalCambios += `
🔄 CAMBIOS EN TAREAS DENTRO DE REVISIONES EXISTENTES:
${cambiosDetectados.cambiosEnTareas.map(c => {
            let mensaje = `   ${c.titulo} (${c.horario}):`;
            if (c.tareasNuevas.length > 0) {
              mensaje += `\n      + ${c.tareasNuevas.length} tarea(s) nueva(s): ${c.tareasNuevas.map(t => `${t.nombre} (${t.duracionMin}min)`).join(', ')}`;
            }
            if (c.tareasEliminadas.length > 0) {
              mensaje += `\n      - ${c.tareasEliminadas.length} tarea(s) eliminada(s): ${c.tareasEliminadas.map(t => t.nombre).join(', ')}`;
            }
            return mensaje;
          }).join('\n')}
`;
        }

        mensajeAdicionalCambios += `
⚠️ IMPORTANTE: Solo necesitas reportar las NUEVAS tareas. Las eliminadas ya fueron limpiadas.
`;
      }

      // Calcular métricas
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

      // Determinar proyecto principal
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

      // Construir prompt para IA
      promptGenerado = `
Eres un asistente que analiza ÚNICAMENTE actividades que:
1. Tienen revisiones CON TIEMPO estimado
2. Están en horario laboral (09:30-17:00)
3. Se han filtrado actividades 00ftf y status 00sec

Usuario: ${user.firstName} (${email})

${mensajeAdicionalCambios}

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

      // Llamar a IA
      aiResult = await smartAICall(promptGenerado);

    }

    // 🟢 CALCULAR MÉTRICAS (siempre se ejecuta, con o sin cambios)
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

    // Determinar proyecto principal
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

    // 🟢 DETECTAR CAMBIOS (siempre se ejecuta)
    const cambiosDetectados = await detectarCambiosEnRevisiones(
      odooUserId,
      actividadesFinales,
      revisionesPorActividad
    );

    // 13 Obtener actividades guardadas (para descripciones)
    const actividadesGuardadas = await ActividadesSchema.findOne({
      odooUserId: odooUserId
    });

    // 14 Preparar respuesta estructurada
    const respuestaData = {
      actividades: actividadesFinales.map(a => {
        const revisiones = revisionesPorActividad[a.id];
        const esNueva = cambiosDetectados.revisionesNuevas.some(r => r.id === a.id);
        return {
          id: a.id,
          titulo: a.titulo,
          horario: `${a.horaInicio} - ${a.horaFin}`,
          status: a.status,
          proyecto: revisiones?.actividad?.proyecto || "Sin proyecto",
          colaboradores: revisiones?.actividad?.colaboradores || [],
          assigneesOriginales: revisiones?.actividad?.assigneesDirectos || [],
          esHorarioLaboral: true,
          tieneRevisionesConTiempo: true,
          esNueva: esNueva
        };
      }),
      revisionesPorActividad: actividadesFinales
        .map(actividad => {
          const revisiones = revisionesPorActividad[actividad.id];
          if (!revisiones || revisiones.pendientesConTiempo.length === 0) return null;

          const actividadGuardada = actividadesGuardadas?.actividades?.find(
            a => a.actividadId === actividad.id
          );
          const esNueva = cambiosDetectados.revisionesNuevas.some(r => r.id === actividad.id);
          const cambioEnTareas = cambiosDetectados.cambiosEnTareas.find(c => c.actividadId === actividad.id);

          return {
            actividadId: actividad.id,
            actividadTitulo: actividad.titulo,
            actividadHorario: `${actividad.horaInicio} - ${actividad.horaFin}`,
            colaboradores: revisiones.actividad?.colaboradores || [],
            assigneesOriginales: revisiones.actividad?.assigneesDirectos || [],
            esNueva: esNueva,
            tareasConTiempo: revisiones.pendientesConTiempo.map(tarea => {
              const pendienteGuardado = actividadGuardada?.pendientes?.find(
                p => p.pendienteId === tarea.id
              );
              const esTareaNueva = cambioEnTareas?.tareasNuevas?.some(t => t.id === tarea.id) || false;

              return {
                ...tarea,
                descripcion: pendienteGuardado?.descripcion || "",
                esNueva: esTareaNueva
              };
            }),
            totalTareasConTiempo: revisiones.pendientesConTiempo.length,
            tareasAltaPrioridad: revisiones.pendientesConTiempo.filter(t => t.prioridad === "ALTA").length,
            tiempoTotal: revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0),
            tiempoFormateado: `${Math.floor(revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0) / 60)}h ${revisiones.pendientesConTiempo.reduce((sum, t) => sum + (t.duracionMin || 0), 0) % 60}m`,
            cambiosDetectados: cambioEnTareas ? {
              tareasNuevas: cambioEnTareas.tareasNuevas.length,
              tareasEliminadas: cambioEnTareas.tareasEliminadas.length
            } : null
          };
        })
        .filter(item => item !== null)
    };

    // 15 Preparar análisis completo
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
      sugerencias: [],
      cambios: {
        detectados: cambiosDetectados.cambiosDetectados,
        esPrimeraVez: cambiosDetectados.esPrimeraVez,
        revisionesNuevas: cambiosDetectados.revisionesNuevas.length,
        revisionesEliminadas: cambiosDetectados.revisionesEliminadas.length,
        cambiosEnTareas: cambiosDetectados.cambiosEnTareas.length
      }
    };

    // 16 Preparar estado de tareas
    const tareasEstadoArray = respuestaData.revisionesPorActividad.flatMap(r =>
      (r.tareasConTiempo || []).map(t => ({
        taskId: t.id,
        taskName: t.nombre,
        actividadTitulo: r.actividadTitulo,
        explicada: false,
        validada: false,
        explicacion: "",
        ultimoIntento: null,
        esNueva: t.esNueva || false
      }))
    );

    // 17 Generar nombre de conversación con IA
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

    // 18 Guardar en base de datos (Actividades)
    const actividadesExistentes = await ActividadesSchema.findOne({
      odooUserId: odooUserId
    });

    const actividadesParaGuardar = actividadesFinales.map(actividad => {
      const revisiones = revisionesPorActividad[actividad.id];

      const todasLasTareas = [
        ...(revisiones.pendientesConTiempo || []),
        ...(revisiones.pendientesSinTiempo || [])
      ];

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
          ultimaSincronizacion: new Date(),
          // 🟢 AGREGAR analisisGuardado AQUÍ
          analisisGuardado: {
            prompt: promptGenerado,
            respuesta: aiResult.text,
            provider: aiResult.provider,
            hashActividades: hashActual,
            fechaGeneracion: new Date(),
            vigente: true
          }
        }
      },
      { upsert: true, new: true }
    );


    // 19 Guardar en historial (solo si no existe análisis inicial)
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

    // 20 Respuesta final
    return res.json({
      success: true,
      answer: aiResult.text,
      provider: aiResult.provider,
      sessionId: sessionId,
      proyectoPrincipal: proyectoPrincipal,
      colaboradoresInvolucrados: colaboradoresTotales,
      cambios: {
        detectados: cambiosDetectados.cambiosDetectados,
        esPrimeraVez: cambiosDetectados.esPrimeraVez,
        resumen: {
          revisionesNuevas: cambiosDetectados.revisionesNuevas.length,
          revisionesEliminadas: cambiosDetectados.revisionesEliminadas.length,
          cambiosEnTareas: cambiosDetectados.cambiosEnTareas.length
        },
        detalle: {
          revisionesNuevas: cambiosDetectados.revisionesNuevas.map(r => ({
            id: r.id,
            titulo: r.titulo,
            horario: `${r.horaInicio}-${r.horaFin}`,
            tareasConTiempo: revisionesPorActividad[r.id]?.pendientesConTiempo?.length || 0,
            tiempoTotal: revisionesPorActividad[r.id]?.pendientesConTiempo?.reduce((sum, t) => sum + (t.duracionMin || 0), 0) || 0
          })),
          revisionesEliminadas: cambiosDetectados.revisionesEliminadas.map(r => ({
            id: r.actividadId,
            titulo: r.titulo,
            horario: `${r.horaInicio}-${r.horaFin}`,
            razon: "Movida a otro día o eliminada del calendario"
          })),
          cambiosEnTareas: cambiosDetectados.cambiosEnTareas.map(c => ({
            actividadId: c.actividadId,
            actividadTitulo: c.titulo,
            horario: c.horario,
            tareasNuevas: c.tareasNuevas,
            tareasEliminadas: c.tareasEliminadas
          }))
        }
      },
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

    console.error("Error en getActividadesConRevisiones:", error);
    if (error.message === "AI_PROVIDER_FAILED") {
      console.error(error.cause);
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

    // 1 Obtener actividades del día para el usuario
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

    // 2 Obtener fecha actual para las revisiones
    const today = new Date();
    const formattedToday = today.toISOString().split('T')[0];

    // 3 Obtener TODAS las revisiones del día
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

    // 4 Filtrar actividades (igual que antes)
    let actividadesFiltradas = actividadesRaw.filter((actividad) => {
      const tiene00ftf = actividad.titulo.toLowerCase().includes('00ftf');
      const es00sec = actividad.status === "00sec";
      return !tiene00ftf && !es00sec;
    });

    // 5 Extraer IDs de todas las actividades filtradas
    const actividadIds = actividadesFiltradas.map(a => a.id);

    // 6 Procesar revisiones - SOLO TAREAS TERMINADAS
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

    // 7 Filtrar actividades que tienen al menos una tarea terminada
    const actividadesConTerminadas = actividadesFiltradas.filter(actividad =>
      actividadesConTareasTerminadasIds.has(actividad.id)
    );

    // 8 Si no hay tareas terminadas
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

    // 9 Construir prompt para tareas terminadas
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
        - ${tarea.confirmada ? 'CONFIRMADA' : 'POR CONFIRMAR'}
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

    // Estructura de respuesta final (reutilizable para la misma ruta)
    const respuesta = {
      valida: resultadoIA.esDelTema === true,
      categoriaMotivo: resultadoIA.categoriaMotivo || "INSUFICIENTE",
      razon: resultadoIA.razon || "Revisión técnica necesaria.",
      sugerencia: resultadoIA.sugerencia,
    };

    // Log para monitoreo interno
    if (!respuesta.valida) {

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
      userEmail,      // Email del usuario
      userId,         // ID o email alternativo
      sessionId,
      priority,       // Prioridad de la tarea (opcional)
      duration       // Duración (opcional)
    } = req.body;

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


    const aiResult = await smartAICall(prompt);

    if (!aiResult || !aiResult.text) {
      console.error("❌ La IA no respondió correctamente");
      return res.status(503).json({
        esValida: false,
        razon: "La IA no respondió correctamente. Intenta nuevamente."
      });
    }


    const aiEvaluation = parseAIJSONSafe(aiResult.text);

    if (!aiEvaluation.esValida) {

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



    // PREPARAR DATOS PARA GUARDAR
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



    // ACTUALIZACIÓN COMPLETA CON TODOS LOS CAMPOS
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
            sessionId: sessionId,
            resultado: {
              esValida: true,
              puntuacion: null,
              feedback: aiEvaluation.razon
            }
          }
        }
      },
      {
        arrayFilters: [
          { "act.actividadId": actividadId },
          { "pend.pendienteId": idPendiente }
        ],
        new: true,
        runValidators: false
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

    // 🔄 SINCRONIZAR CON OTROS USUARIOS QUE COMPARTEN EL PENDIENTE
    await ActividadesSchema.updateMany(
      {
        odooUserId: { $ne: odooUserId }, // ❌ excluir usuario origen
        "actividades.actividadId": actividadId,
        "actividades.pendientes.pendienteId": idPendiente
      },
      {
        $set: {
          "actividades.$[act].pendientes.$[pend].descripcion": explicacion,
          "actividades.$[act].pendientes.$[pend].explicacionVoz": datosExplicacion,

          "actividades.$[act].ultimaActualizacion": fechaActual,
          "actividades.$[act].actualizadoPor": emailUsuario,
          "actividades.$[act].fechaRevisionVoz": fechaActual,

          "actividades.$[act].pendientes.$[pend].ultimaActualizacion": fechaActual,
          "actividades.$[act].pendientes.$[pend].actualizadoPor": emailUsuario,
          "actividades.$[act].pendientes.$[pend].revisadoPorVoz": true,
          "actividades.$[act].pendientes.$[pend].fechaRevisionVoz": fechaActual,

          ...(priority && {
            "actividades.$[act].pendientes.$[pend].prioridad": priority
          }),
          ...(duracionMin && {
            "actividades.$[act].pendientes.$[pend].duracionMin": duracionMin
          })
        },

        $push: {
          "actividades.$[act].pendientes.$[pend].historialExplicaciones": {
            texto: explicacion,
            emailUsuario: emailUsuario,
            fecha: fechaActual,
            validadaPorIA: true,
            razonIA: aiEvaluation.razon,
            sessionId: sessionId,
            resultado: {
              esValida: true,
              puntuacion: null,
              feedback: aiEvaluation.razon
            }
          }
        }
      },
      {
        arrayFilters: [
          { "act.actividadId": actividadId },
          { "pend.pendienteId": idPendiente }
        ]
      }
    );




    //  PREPARAR RESPUESTA COMPLETA
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



    return res.status(200).json(respuesta);

  } catch (error) {
    console.error("Error en validarYGuardarExplicacion:", error);
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
    console.error("Error al obtener sesión:", error);
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
    console.error("Error al obtener el historial semanal:", error);
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
    console.error("Error en obtenerTodasExplicacionesAdmin:", error);
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



    return res.status(500).json({
      success: false,
      error: "Error interno del servidor"
    });
  }
}

export async function guardarExplicacionesTarde(req, res) {
  try {
    const { queHizo, actividadId, pendienteId, sessionId } = sanitizeObject(req.body);
    console.log('📥 Datos recibidos:', { queHizo, actividadId, pendienteId, sessionId });

    const { token } = req.cookies;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No autenticado"
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const emailUsuario = decoded.email;

    console.log('👤 Usuario autenticado por JWT:', emailUsuario); // ✅ LOG ÚTIL

    // Validaciones
    if (!queHizo || !actividadId || !pendienteId) {
      return res.status(400).json({
        success: false,
        message: "Parámetros inválidos: queHizo, actividadId y pendienteId son requeridos",
      });
    }

    if (queHizo.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "La explicación es demasiado corta. Por favor proporciona más detalles.",
      });
    }

    // ✅ FIX PRINCIPAL: Filtrar por emailUsuario del JWT para evitar docs con emailUsuario undefined
    const actividadDocs = await ActividadesSchema.find({
      emailUsuario: emailUsuario,                          // ✅ SIEMPRE filtrar por usuario autenticado
      "actividades.actividadId": actividadId,
      "actividades.pendientes.pendienteId": pendienteId,
    });

    // ✅ Fallback: si no encontró con email (docs legacy sin emailUsuario), buscar sin él
    let docsParaActualizar = actividadDocs;
    if (!actividadDocs || actividadDocs.length === 0) {
      console.warn('⚠️ No se encontró doc con emailUsuario, intentando búsqueda sin filtro de email...');
      const docsSinFiltro = await ActividadesSchema.find({
        "actividades.actividadId": actividadId,
        "actividades.pendientes.pendienteId": pendienteId,
      });

      if (!docsSinFiltro || docsSinFiltro.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Actividad no encontrada",
        });
      }

      docsParaActualizar = docsSinFiltro;
      console.warn(`⚠️ Usando ${docsParaActualizar.length} docs SIN filtro email (docs legacy)`);
    }


    // Obtener el primer documento para hacer el análisis de IA (solo una vez)
    const primerDoc = docsParaActualizar[0];
    const primeraActividad = primerDoc.actividades.find(
      (a) => a.actividadId === actividadId
    );
    const primerPendiente = primeraActividad?.pendientes.find(
      (p) => p.pendienteId === pendienteId
    );

    if (!primerPendiente) {
      return res.status(404).json({
        success: false,
        message: "Pendiente no encontrado",
      });
    }

    // ==================== ANÁLISIS CON IA (UNA SOLA VEZ) ====================
    const prompt = `Eres un asistente experto en análisis de reportes laborales. Analiza el siguiente reporte de trabajo y determina si la tarea se completó exitosamente.

═══════════════════════════════════════════════════════════════════════════════
INFORMACIÓN DE LA TAREA
═══════════════════════════════════════════════════════════════════════════════
NOMBRE: "${primerPendiente.nombre}"
DESCRIPCIÓN ORIGINAL: "${primerPendiente.descripcion || 'Sin descripción previa'}"
REPORTE DEL USUARIO: "${queHizo}"

═══════════════════════════════════════════════════════════════════════════════
REGLAS DE EVALUACIÓN
═══════════════════════════════════════════════════════════════════════════════

1️⃣ CRITERIOS PARA MARCAR COMO COMPLETADA (true)
   ✅ El usuario describe trabajo CONCRETO y FINALIZADO
   ✅ Menciona resultados verificables o funcionales
   ✅ Usa verbos en PASADO que indican finalización:
      • "Terminé", "Completé", "Finalicé", "Implementé"
      • "Corregí", "Arreglé", "Optimicé", "Creé"
      • "Ya quedó", "Está listo", "Funciona correctamente"
   ✅ Describe pruebas exitosas:
      • "Lo probé y funciona"
      • "Validé que está funcionando"
      • "Ya está en producción"
   ✅ Menciona entregables tangibles:
      • "Subí el código", "Hice el deploy"
      • "Envié el reporte", "Documenté el proceso"

2️⃣ CRITERIOS PARA MARCAR COMO NO COMPLETADA (false)
   ❌ El usuario indica explícitamente que NO terminó
   ❌ Menciona BLOQUEOS o PROBLEMAS sin resolver
   ❌ Usa verbos que indican intento sin éxito:
      • "Intenté pero...", "Traté de..."
      • "Empecé pero...", "Iba a hacer pero..."
   ❌ Menciona PENDIENTES explícitos:
      • "Falta", "Aún no", "Todavía no"
      • "Quedó pendiente", "No lo logré"
   ❌ Describe bloqueos o dependencias:
      • "Esperando aprobación/información/acceso"
      • "No tengo permisos/credenciales"
      • "Bloqueado por otra tarea/persona"
   ❌ Avance parcial SIN entregable funcional:
      • "Hice la mitad", "Avancé un 50%"
      • "Solo preparé el ambiente"

3️⃣ CASOS ESPECIALES Y GRISES
   🔸 Investigación/Análisis SIN código:
      • Si describe hallazgos concretos → COMPLETADA
      • Si solo dice "investigué un poco" → NO COMPLETADA

   🔸 Trabajo técnico detallado:
      • Si menciona cambios específicos en archivos/código → COMPLETADA
      • Si describe arquitectura/diseño implementado → COMPLETADA
      • Si solo menciona "trabajé en..." sin detalles → NO COMPLETADA

   🔸 Correcciones/Bugfixes:
      • Si confirma que el bug está resuelto → COMPLETADA
      • Si solo identificó el problema → NO COMPLETADA

   🔸 Meetings/Reuniones:
      • Si tomó decisiones/acuerdos concretos → COMPLETADA
      • Si solo asistió sin conclusiones → NO COMPLETADA

   🔸 ⚠️ IMPORTANTE - Lenguaje coloquial/informal (voz a texto):
      • "lo que hicimos fue verificar X y documentar Y" → EVALÚA EL CONTENIDO, no el estilo
      • Si el resultado final fue logrado (aunque lo digan informalmente) → COMPLETADA
      • Muletillas como "básicamente", "o sea", "este" NO penalizan si el contenido es claro
      • "empezamos a documentar en Word" con resultado guardado → COMPLETADA

4️⃣ EXTRACCIÓN DEL MOTIVO (si NO está completada)
   📌 IMPORTANTE: Identifica la razón ESPECÍFICA del no-completado

   Categorías de motivos:
   • Bloqueo técnico: "No tenía acceso al servidor X"
   • Bloqueo externo: "Esperando aprobación de cliente/gerencia"
   • Falta información: "Falta especificación del diseño"
   • Dependencia: "Bloqueado por tarea Y pendiente"
   • Problema técnico: "Error en API externa sin resolver"
   • Falta recursos: "No tengo permisos/credenciales necesarios"
   • Priorización: "Se priorizó otra tarea más urgente"
   • Default: "No especificó el motivo" (solo si no hay ninguna pista)

   FORMATO: Máximo 100 caracteres, frase clara y específica

5️⃣ EVALUACIÓN DE CALIDAD (0-100)
   90-100 pts: Explicación detallada con:
      • Verbos de acción específicos
      • Resultados medibles/verificables
      • Menciona archivos/componentes/funcionalidades concretas
      • Describe el impacto o beneficio logrado

   70-89 pts: Explicación clara con:
      • Describe qué se hizo
      • Menciona algunos detalles técnicos
      • Falta profundidad o contexto completo

   50-69 pts: Explicación vaga con:
      • Descripción general sin detalles
      • Usa muletillas ("este", "pues", "entonces")
      • No menciona resultados concretos

   0-49 pts: Explicación muy pobre:
      • Solo dice "lo hice" sin explicar
      • Texto muy corto (<20 caracteres)
      • No aporta información útil

6️⃣ DETECCIÓN DE RESPUESTAS INVÁLIDAS
   ⚠️ Si el reporte contiene SOLO estas frases, márcalo como NO COMPLETADA con baja calidad:
   • "ok", "sí", "no", "bien", "gracias"
   • "listo", "perfecto", "entendido"
   • Menos de 3 palabras
   • Solo muletillas sin contenido

═══════════════════════════════════════════════════════════════════════════════
INSTRUCCIONES DE RESPUESTA
═══════════════════════════════════════════════════════════════════════════════

Analiza el reporte cuidadosamente y responde ÚNICAMENTE en formato JSON:

{
  "completada": boolean,
  "confianza": number (0.0 a 1.0),
  "razon": "Explicación breve de tu evaluación (máx 200 caracteres)",
  "evidencias": ["frase clave 1", "frase clave 2", "frase clave 3"],
  "calidadExplicacion": number (0 a 100),
  "feedbackMejora": "Sugerencia constructiva para mejorar el reporte (o vacío si está excelente)",
  "motivoNoCompletado": "Motivo específico si false, o null si true"
}

═══════════════════════════════════════════════════════════════════════════════
EJEMPLOS DE ANÁLISIS
═══════════════════════════════════════════════════════════════════════════════

EJEMPLO 1 - COMPLETADA:
Reporte: "Implementé la validación de formularios en el componente LoginForm.tsx. Agregué Zod para el schema y ahora valida email, contraseña (mínimo 8 caracteres) y muestra errores en tiempo real. Lo probé y funciona correctamente."

Respuesta:
{
  "completada": true,
  "confianza": 0.95,
  "razon": "Describe implementación completa con detalles técnicos específicos y validación exitosa",
  "evidencias": ["Implementé la validación", "Agregué Zod", "Lo probé y funciona correctamente"],
  "calidadExplicacion": 92,
  "feedbackMejora": "",
  "motivoNoCompletado": null
}

EJEMPLO 2 - NO COMPLETADA:
Reporte: "Intenté conectar con la API de pagos pero no tengo las credenciales de producción. Quedó pendiente hasta que el cliente las proporcione."

Respuesta:
{
  "completada": false,
  "confianza": 0.9,
  "razon": "Bloqueado por falta de credenciales externas",
  "evidencias": ["no tengo las credenciales", "Quedó pendiente"],
  "calidadExplicacion": 75,
  "feedbackMejora": "Menciona qué pasos alternativos tomaste mientras esperas las credenciales",
  "motivoNoCompletado": "Falta credenciales de producción del cliente"
}

EJEMPLO 3 - REPORTE INFORMAL/VOZ (COMPLETADA):
Reporte: "Bueno, lo que hicimos básicamente fue, pues, ya sabes, verificamos la información disponible, igual documentamos lo que viene siendo la parte del proyecto y eso, empezamos a documentar en un archivo en Word."

Respuesta:
{
  "completada": true,
  "confianza": 0.78,
  "razon": "Describe verificación de información y documentación en Word completadas, aunque con lenguaje informal",
  "evidencias": ["verificamos la información disponible", "documentamos", "documentar en un archivo en Word"],
  "calidadExplicacion": 55,
  "feedbackMejora": "Especifica qué información verificaste y qué contenido documentaste en Word",
  "motivoNoCompletado": null
}

EJEMPLO 4 - RESPUESTA INVÁLIDA:
Reporte: "Gracias."

Respuesta:
{
  "completada": false,
  "confianza": 0.95,
  "razon": "Respuesta inválida: no describe trabajo realizado",
  "evidencias": [],
  "calidadExplicacion": 5,
  "feedbackMejora": "Por favor describe específicamente qué trabajo realizaste en esta tarea",
  "motivoNoCompletado": "No proporcionó explicación válida"
}

═══════════════════════════════════════════════════════════════════════════════

AHORA ANALIZA EL REPORTE PROPORCIONADO Y RESPONDE EN JSON:`;

    const aiResult = await smartAICall(prompt);

    // Limpiar respuesta
    let textoLimpio = aiResult.text.trim();
    if (textoLimpio.includes('```')) {
      textoLimpio = textoLimpio.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    // Intentar parsear
    let validacion = {
      completada: true,
      confianza: 0.8,
      razon: "Análisis por defecto",
      evidencias: [],
      calidadExplicacion: 70,
      feedbackMejora: "",
      motivoNoCompletado: null
    };

    try {
      const respuestaIA = parseAIJSONSafe(textoLimpio);
      if (respuestaIA) {
        if (typeof respuestaIA === 'object') {
          validacion = { ...validacion, ...respuestaIA };
        } else if (typeof respuestaIA === 'string') {
          validacion = { ...validacion, ...JSON.parse(respuestaIA) };
        }
      }
    } catch (parseError) {
      console.warn('⚠️ Error parseando respuesta IA, usando valores por defecto');
    }

    const estaTerminada = typeof validacion.completada === 'boolean'
      ? validacion.completada
      : true;

    const esValidadaPorIA = validacion.confianza >= 0.7 && validacion.calidadExplicacion >= 60;


    // ==================== GUARDAR EN TODOS LOS DOCUMENTOS ====================
    const fechaActual = new Date();
    const resultadosGuardado = [];

    for (const actividadDoc of docsParaActualizar) {
      // ✅ FIX: Usar emailUsuario del JWT si el doc no tiene el campo
      const emailDocumento = actividadDoc.emailUsuario || emailUsuario;

      try {
        const actividad = actividadDoc.actividades.find(a => a.actividadId === actividadId);
        const pendiente = actividad?.pendientes.find(p => p.pendienteId === pendienteId);

        const historialEntry = (pendiente?.explicacionVoz && pendiente.explicacionVoz.texto) ? {
          texto: pendiente.explicacionVoz.texto,
          emailUsuario: pendiente.explicacionVoz.emailUsuario,
          fecha: pendiente.explicacionVoz.fechaRegistro || new Date(),
          validadaPorIA: pendiente.explicacionVoz.validadaPorIA || false,
          razonIA: pendiente.explicacionVoz.razonIA || "",
          sessionId: pendiente.explicacionVoz.metadata?.sessionId || "",
          resultado: {
            esValida: esValidadaPorIA,
            puntuacion: validacion.calidadExplicacion || 0,
            feedback: validacion.feedbackMejora || ""
          }
        } : null;

        const otrosPendientes = actividad?.pendientes.filter(p => p.pendienteId !== pendienteId) || [];
        const todosCompletados = otrosPendientes.every(p => p.terminada) && estaTerminada;

        const updateOperations = {
          $set: {
            "actividades.$[act].pendientes.$[pend].explicacionVoz": {
              texto: queHizo.trim(),
              emailUsuario: emailUsuario,
              fechaRegistro: fechaActual,
              validadaPorIA: esValidadaPorIA,
              razonIA: validacion.razon || "",
              metadata: {
                sessionId: sessionId || `session-${Date.now()}`,
                duracionMin: pendiente?.duracionMin || 0,
                prioridad: pendiente?.prioridad || "MEDIA",
                fuente: "voz-a-texto",
                version: "2.0",
                dispositivo: req.headers['user-agent'] || "desconocido",
                lenguaje: "es-MX"
              }
            },
            "actividades.$[act].pendientes.$[pend].queHizo": queHizo.trim(),
            "actividades.$[act].pendientes.$[pend].terminada": estaTerminada,
            "actividades.$[act].pendientes.$[pend].revisadoPorVoz": true,
            "actividades.$[act].pendientes.$[pend].fechaRevisionVoz": fechaActual,
            "actividades.$[act].pendientes.$[pend].ultimaActualizacion": fechaActual,
            "actividades.$[act].pendientes.$[pend].actualizadoPor": emailUsuario,
            "actividades.$[act].pendientes.$[pend].ultimaExplicacionFecha": fechaActual,
            "actividades.$[act].pendientes.$[pend].motivoNoCompletado":
              !estaTerminada && validacion.motivoNoCompletado
                ? validacion.motivoNoCompletado.trim()
                : null,
            "actividades.$[act].ultimaActualizacion": fechaActual,
            "actividades.$[act].actualizadoPor": emailUsuario,
            "actividades.$[act].fechaRevisionVoz": fechaActual,
            "ultimaSincronizacion": fechaActual,
            "fechaUltimaExplicacion": fechaActual,
          },
          $inc: {
            "actividades.$[act].pendientes.$[pend].vecesExplicado": 1,
            "actividades.$[act].pendientes.$[pend].intentosValidacion": 1,
            "actividades.$[act].pendientes.$[pend].intentosExitosos": esValidadaPorIA ? 1 : 0,
            "actividades.$[act].totalExplicacionesVoz": 1,
            "totalExplicacionesVoz": 1,
            "totalExplicacionesValidadas": esValidadaPorIA ? 1 : 0,
            "totalExplicacionesRechazadas": esValidadaPorIA ? 0 : 1,
          }
        };

        if (estaTerminada) {
          updateOperations.$set["actividades.$[act].pendientes.$[pend].fechaFinTerminada"] = fechaActual;
          updateOperations.$set["actividades.$[act].pendientes.$[pend].confirmada"] = true;
        }

        if (todosCompletados) {
          updateOperations.$set["actividades.$[act].completadaPorVoz"] = true;
        }

        if (!actividadDoc.fechaPrimeraExplicacion) {
          updateOperations.$set["fechaPrimeraExplicacion"] = fechaActual;
        }

        if (historialEntry) {
          updateOperations.$push = {
            "actividades.$[act].pendientes.$[pend].historialExplicaciones": historialEntry
          };
        }

        const resultado = await ActividadesSchema.findOneAndUpdate(
          {
            // ✅ FIX: Usar _id del documento para garantizar que actualiza el correcto
            _id: actividadDoc._id,
            "actividades.actividadId": actividadId,
            "actividades.pendientes.pendienteId": pendienteId
          },
          updateOperations,
          {
            arrayFilters: [
              { "act.actividadId": actividadId },
              { "pend.pendienteId": pendienteId }
            ],
            new: true,
            runValidators: false
          }
        );

        if (!resultado) {
          console.warn(`⚠️ No se pudo actualizar documento ${actividadDoc._id}`);
          continue;
        }

        const actividadVerificada = resultado.actividades.find(a => a.actividadId === actividadId);
        const pendienteVerificado = actividadVerificada?.pendientes.find(p => p.pendienteId === pendienteId);

        // ✅ FIX LOG: Mostrar datos reales en vez de 'OK'/'MISSING'
        console.log('🔍 Verificación después de guardar:', {
          emailUsuario: resultado.emailUsuario || emailUsuario,
          terminada: pendienteVerificado?.terminada,
          motivoNoCompletado: pendienteVerificado?.motivoNoCompletado,
          queHizoGuardado: pendienteVerificado?.queHizo
            ? `"${pendienteVerificado.queHizo.substring(0, 60)}..."`
            : 'VACÍO ⚠️',
        });

        resultadosGuardado.push({
          emailUsuario: resultado.emailUsuario || emailUsuario,
          nombreUsuario: resultado.nombreUsuario,
          guardadoExitoso: true,
          verificacion: {
            terminadaCorrecta: pendienteVerificado?.terminada === estaTerminada,
            motivoGuardado: !estaTerminada ? !!pendienteVerificado?.motivoNoCompletado : true,
            queHizoGuardado: !!pendienteVerificado?.queHizo,
          }
        });

        console.log(`✅ Guardado exitosamente en documento de: ${resultado.emailUsuario || emailUsuario}`);

      } catch (saveError) {
        console.error(`❌ Error guardando en documento ${actividadDoc._id}:`, saveError);
        resultadosGuardado.push({
          emailUsuario: actividadDoc.emailUsuario || emailUsuario,
          nombreUsuario: actividadDoc.nombreUsuario,
          guardadoExitoso: false,
          error: saveError.message
        });
      }
    }

    // ==================== RESPUESTA ====================
    const respuestaFinal = {
      success: true,
      completada: estaTerminada,
      confianza: validacion.confianza || 0.8,
      razon: validacion.razon || "Tarea analizada",
      evidencias: validacion.evidencias || [],
      calidadExplicacion: validacion.calidadExplicacion || 70,
      feedbackMejora: validacion.feedbackMejora || "",
      validadaPorIA: esValidadaPorIA,
      motivoNoCompletado: !estaTerminada ? (validacion.motivoNoCompletado || null) : null,
      message: estaTerminada
        ? "✅ Tarea marcada como completada"
        : `⏳ Tarea marcada como no completada${validacion.motivoNoCompletado ? ': ' + validacion.motivoNoCompletado : ''}`,
      guardadoEn: resultadosGuardado,
      totalUsuariosActualizados: resultadosGuardado.filter(r => r.guardadoExitoso).length,
      metadata: {
        sessionId: sessionId || `session-${Date.now()}`,
        fechaRegistro: fechaActual,
        emailUsuario: emailUsuario,
        actividadCompletada: resultadosGuardado.length > 0
      }
    };

    return res.json(respuestaFinal);

  } catch (error) {
    console.error('❌ Error en guardarExplicacionesTarde:', error);
    return res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

export async function modificarMotivoNoCompletado(req, res) {
  try {
    const { pendienteId, actividadId, motivo } = sanitizeObject(req.body);


    // Obtener email del usuario autenticado
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No autenticado"
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const emailUsuario = decoded.email;

    // Validaciones
    if (!pendienteId || !actividadId || !motivo) {
      console.log('❌ Parámetros inválidos');
      return res.status(400).json({
        success: false,
        message: "Parámetros inválidos: pendienteId, actividadId y motivo son requeridos",
      });
    }

    if (motivo.trim().length < 3) {
      console.log('❌ Motivo demasiado corto');
      return res.status(400).json({
        success: false,
        message: "El motivo es demasiado corto. Por favor proporciona más detalles.",
      });
    }

    // 🔥 BUSCAR TODOS LOS DOCUMENTOS QUE CONTIENEN ESTA ACTIVIDAD/PENDIENTE
    // Esto encontrará el documento de TODOS los usuarios que tienen esta actividad compartida
    const actividadDocs = await ActividadesSchema.find({
      "actividades.actividadId": actividadId,
      "actividades.pendientes.pendienteId": pendienteId,
    });

    if (!actividadDocs || actividadDocs.length === 0) {
      console.log('❌ Actividad no encontrada');
      return res.status(404).json({
        success: false,
        message: "Actividad o pendiente no encontrado",
      });
    }

    console.log(`📋 Encontrados ${actividadDocs.length} documentos con esta actividad`);

    // ==================== GUARDAR EN TODOS LOS DOCUMENTOS ====================
    const fechaActual = new Date();
    const resultadosGuardado = [];

    // 🔥 ITERAR SOBRE TODOS LOS DOCUMENTOS ENCONTRADOS
    for (const actividadDoc of actividadDocs) {
      console.log(`💾 Guardando motivo en documento de: ${actividadDoc.emailUsuario}`);

      // Encontrar actividad y pendiente en ESTE documento específico
      const actividad = actividadDoc.actividades.find(
        (a) => a.actividadId === actividadId
      );

      if (!actividad) {
        console.warn(`⚠️ Actividad no encontrada en documento de ${actividadDoc.emailUsuario}`);
        continue;
      }

      const pendiente = actividad.pendientes.find(
        (p) => p.pendienteId === pendienteId
      );

      if (!pendiente) {
        console.warn(`⚠️ Pendiente no encontrado en documento de ${actividadDoc.emailUsuario}`);
        continue;
      }

      // ✅ Actualizar el motivo en el pendiente
      pendiente.motivoNoCompletado = motivo.trim();
      pendiente.ultimaActualizacion = fechaActual;
      pendiente.actualizadoPor = emailUsuario; // El que REGISTRÓ el motivo
      pendiente.terminada = false; // Asegurar que esté marcada como NO terminada
      pendiente.confirmada = false;

      // Actualizar campos de la actividad
      actividad.ultimaActualizacion = fechaActual;
      actividad.actualizadoPor = emailUsuario;

      // Actualizar campos globales del documento
      actividadDoc.ultimaSincronizacion = fechaActual;

      // Guardar el documento
      await actividadDoc.save();

      resultadosGuardado.push({
        emailUsuario: actividadDoc.emailUsuario,
        nombreUsuario: actividadDoc.nombreUsuario,
        guardadoExitoso: true
      });

      console.log(`✅ Motivo guardado exitosamente en documento de: ${actividadDoc.emailUsuario}`);
    }

    // 📝 OPCIONAL: Guardar también en colección histórica de motivos
    try {
      await MotivoNoCompletado.create({
        pendienteId,
        actividadId,
        motivo: motivo.trim(),
        email: emailUsuario,
        fecha: fechaActual,
        totalUsuariosAfectados: resultadosGuardado.length,
      });
      console.log('📊 Guardado también en histórico de motivos');
    } catch (historicoError) {
      console.warn('⚠️ Error guardando en histórico de motivos:', historicoError.message);
      // No fallar si esto falla, es solo histórico
    }

    // ==================== RESPUESTA ====================
    const respuestaFinal = {
      success: true,
      message: "Motivo guardado exitosamente",
      motivoGuardado: motivo.trim(),

      // 🔥 INFORMACIÓN DE GUARDADO MÚLTIPLE
      guardadoEn: resultadosGuardado,
      totalUsuariosActualizados: resultadosGuardado.length,

      // Metadata
      metadata: {
        fechaRegistro: fechaActual,
        emailUsuario: emailUsuario,
        pendienteId,
        actividadId,
      }
    };

    return res.json(respuestaFinal);

  } catch (error) {
    console.error('❌ Error en guardarMotivo:', error);
    return res.status(500).json({
      success: false,
      message: "Error al guardar el motivo",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export async function verificarYSincronizarCambios(req, res) {
  try {
    const { email } = sanitizeObject(req.body);

    // Obtener usuario del token
    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No autenticado"
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;
    const emailUsuario = email || decoded.email;

    if (!emailUsuario) {
      return res.status(400).json({
        success: false,
        message: "Email es requerido"
      });
    }

    console.log(`🔍 Verificando cambios para usuario: ${emailUsuario}`);

    // Ejecutar detección y sincronización
    const resultado = await detectarYSincronizarCambios(odooUserId, emailUsuario);

    // Preparar respuesta
    const response = {
      success: resultado.success,
      cambiosDetectados: resultado.cambiosDetectados,
      mensaje: resultado.mensaje,
      estadisticas: resultado.estadisticas,
      timestamp: new Date().toISOString()
    };

    // Agregar detalles si hay cambios
    if (resultado.cambiosDetectados && resultado.detalles) {
      response.detalles = resultado.detalles;
    }

    // Status code según resultado
    const statusCode = resultado.success ? 200 : 500;

    return res.status(statusCode).json(response);

  } catch (error) {
    console.error('❌ Error en verificarYSincronizarCambios:', error);

    return res.status(500).json({
      success: false,
      message: "Error al verificar y sincronizar cambios",
      error: error.message,
      estadisticas: {
        actividadesNuevas: 0,
        pendientesNuevos: 0,
        pendientesEliminados: 0,
        pendientesActualizados: 0,
        pendientesReasignados: 0
      }
    });
  }
}

export async function soloVerificarCambios(req, res) {
  try {
    const { email } = sanitizeObject(req.body);

    const { token } = req.cookies;
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No autenticado"
      });
    }

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;
    const emailUsuario = email || decoded.email;

    if (!emailUsuario) {
      return res.status(400).json({
        success: false,
        message: "Email es requerido"
      });
    }


    const resultado = await detectarCambiosSinSincronizar(odooUserId, emailUsuario);

    return res.json({
      success: true,
      hayCambios: resultado.hayCambios,
      estadisticas: resultado.estadisticas,
      detalles: resultado.detalles,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en soloVerificarCambios:', error);

    return res.status(500).json({
      success: false,
      message: "Error al verificar cambios",
      error: error.message
    });
  }
}
