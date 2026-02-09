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



/**
 * Extrae y limpia los colaboradores del array 'assignees' (strings de emails)
 * que vienen en el JSON de /api/actividades/
 */
function extraerColaboradoresUnicos(actividadOriginal, tareasPendientes = []) {
    const colaboradoresSet = new Set();
    
    // 1. Tomar de la actividad principal (campo 'assignees' que pasaste en el JSON)
    if (actividadOriginal && actividadOriginal.assignees && Array.isArray(actividadOriginal.assignees)) {
        actividadOriginal.assignees.forEach(correo => {
            if (typeof correo === 'string') {
                // Limpiamos el correo: "kkarl@pprin.com" -> "kkarl"
                const nombreLimpio = correo.split('@')[0].toLowerCase().trim();
                colaboradoresSet.add(nombreLimpio);
            }
        });
    }
    
    // 2. Tomar de las tareas (pendientes) por si hay alguien extra
    if (tareasPendientes && Array.isArray(tareasPendientes)) {
        tareasPendientes.forEach(p => {
            if (p.assignees && Array.isArray(p.assignees)) {
                p.assignees.forEach(a => {
                    const nombre = a.name || (typeof a === 'string' ? a.split('@')[0] : null);
                    if (nombre) colaboradoresSet.add(nombre.toLowerCase().trim());
                });
            }
        });
    }
    
    return Array.from(colaboradoresSet);
}

// --- CONTROLADOR PRINCIPAL ---

export async function getActividadesConRevisiones(req, res) {
  try {
    const { email, question = "¿Qué actividades y revisiones tengo hoy? ¿Qué me recomiendas priorizar?", showAll = false } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "El email es requerido" });
    }

    const usersData = await getAllUsers();
    const user = usersData.items.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { token } = req.cookies;
    const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
    const odooUserId = decoded.id;
    const sessionId = generarSessionIdDiario(odooUserId);

    // 1️⃣ Obtener actividades del día (EL JSON QUE PROPORCIONASTE)
    const actividadesResponse = await axios.get(`${process.env.API_URL_ANFETA}/actividades/assignee/${email}/del-dia`);
    const actividadesRaw = actividadesResponse.data.data;

    if (!Array.isArray(actividadesRaw) || actividadesRaw.length === 0) {
      return res.json({ success: true, answer: "No tienes actividades hoy", sessionId, actividades: [] });
    }

    // 2️⃣ Obtener revisiones del día
    const today = new Date();
    const formattedToday = today.toISOString().split('T')[0];
    let todasRevisiones = { colaboradores: [] };
    
    try {
      const revisionesResponse = await axios.get(`${process.env.API_URL_ANFETA}/reportes/revisiones-por-fecha`, {
        params: { date: formattedToday, colaborador: email }
      });
      if (revisionesResponse.data?.success) {
        todasRevisiones = revisionesResponse.data.data;
      }
    } catch (error) {
      console.warn("Error obteniendo revisiones:", error.message);
    }

    // 3️⃣ Filtrar actividades originales (Excluir 00ftf y 00sec)
    let actividadesFiltradas = actividadesRaw.filter((act) => {
      const tiene00ftf = act.titulo.toLowerCase().includes('00ftf');
      const es00sec = act.status === "00sec" || act.titulo.toLowerCase().includes('00sec');
      return !tiene00ftf && !es00sec;
    });

    const actividadIds = actividadesFiltradas.map(a => a.id);

    // 4️⃣ Procesar Revisiones y extraer COLABORADORES de la data original
    const revisionesPorActividad = {};
    const actividadesConRevisionesConTiempoIds = new Set();

    if (todasRevisiones.colaboradores && Array.isArray(todasRevisiones.colaboradores)) {
      todasRevisiones.colaboradores.forEach(colaborador => {
        (colaborador.items?.actividades ?? []).forEach(actRev => {
          
          if (actividadIds.includes(actRev.id)) {
            // Buscamos la actividad en la data que me pasaste (actividadesFiltradas)
            const actOriginal = actividadesFiltradas.find(a => a.id === actRev.id);
            
            // Extraer colaboradores usando la nueva función que mira el array 'assignees'
            const colaboradoresActividad = extraerColaboradoresUnicos(actOriginal, actRev.pendientes);

            revisionesPorActividad[actRev.id] = {
              actividad: {
                id: actRev.id,
                titulo: actOriginal?.titulo || actRev.titulo,
                horaInicio: actOriginal?.dueStart ? new Date(actOriginal.dueStart).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "00:00",
                horaFin: actOriginal?.dueEnd ? new Date(actOriginal.dueEnd).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "00:00",
                status: actOriginal?.status || "Sin status",
                proyecto: actOriginal?.project?.name || "Sin proyecto",
                colaboradores: colaboradoresActividad // <--- AQUÍ ESTÁN LOS ASSIGNEES LIMPIOS
              },
              pendientesConTiempo: [],
              pendientesSinTiempo: []
            };

            (actRev.pendientes ?? []).forEach(p => {
              const estaAsignado = p.assignees?.some(a => a.name?.toLowerCase() === email.toLowerCase());
              if (!estaAsignado) return;

              const pendienteInfo = {
                id: p.id,
                nombre: p.nombre,
                duracionMin: p.duracionMin || 0,
                prioridad: p.duracionMin > 60 ? "ALTA" : p.duracionMin > 30 ? "MEDIA" : "BAJA",
                colaboradores: p.assignees ? p.assignees.map(a => a.name) : []
              };

              if (p.duracionMin > 0) {
                revisionesPorActividad[actRev.id].pendientesConTiempo.push(pendienteInfo);
                actividadesConRevisionesConTiempoIds.add(actRev.id);
              } else {
                revisionesPorActividad[actRev.id].pendientesSinTiempo.push(pendienteInfo);
              }
            });
          }
        });
      });
    }

    // 5️⃣ Filtrar actividades finales (con tiempo y horario laboral estimado)
    const actividadesFinales = actividadesFiltradas.filter(act => {
      const tieneRevisionesConTiempo = actividadesConRevisionesConTiempoIds.has(act.id);
      // Extraer hora de inicio de la data original (dueStart)
      const horaInicio = act.dueStart ? new Date(act.dueStart).getUTCHours() : 0;
      const estaEnHorarioLaboral = horaInicio >= 9 && horaInicio <= 18; 
      return tieneRevisionesConTiempo && estaEnHorarioLaboral;
    });

    // 6️⃣ Métricas y Prompt para IA
    let tiempoTotalEstimado = 0;
    const todosColaboradoresSet = new Set();

    actividadesFinales.forEach(act => {
      const rev = revisionesPorActividad[act.id];
      tiempoTotalEstimado += rev.pendientesConTiempo.reduce((sum, t) => sum + t.duracionMin, 0);
      rev.actividad.colaboradores.forEach(c => todosColaboradoresSet.add(c));
    });

    const prompt = `
Eres un asistente que analiza actividades laborales.
Usuario: ${user.firstName}

RESUMEN DE HOY:
• Actividades: ${actividadesFinales.length}
• Tiempo estimado: ${Math.floor(tiempoTotalEstimado / 60)}h ${tiempoTotalEstimado % 60}m
• Equipo involucrado: ${Array.from(todosColaboradoresSet).join(', ') || 'Solo tú'}

DETALLE:
${actividadesFinales.map((act, i) => {
  const rev = revisionesPorActividad[act.id];
  return `${i+1}. ${act.titulo} (${rev.actividad.horaInicio})
   - Proyecto: ${rev.actividad.proyecto}
   - Colaboradores: ${rev.actividad.colaboradores.join(', ')}
   - Tareas: ${rev.pendientesConTiempo.map(t => `${t.nombre} (${t.duracionMin}min)`).join(', ')}`;
}).join('\n')}

Instrucciones: Responde en máximo 6 renglones, sin emojis. Comienza diciendo cuántas actividades con tiempo hay. Sugiere prioridad basada en el equipo y tiempo.
`;

    const aiResult = await smartAICall(prompt);

    // 7️⃣ Guardar y responder
    return res.json({
      success: true,
      answer: aiResult.text,
      sessionId: sessionId,
      colaboradoresInvolucrados: Array.from(todosColaboradoresSet),
      metrics: {
        totalActividades: actividadesFinales.length,
        tiempoTotal: `${Math.floor(tiempoTotalEstimado / 60)}h ${tiempoTotalEstimado % 60}m`,
        totalEquipo: todosColaboradoresSet.size
      },
      data: {
          actividades: actividadesFinales.map(act => ({
              id: act.id,
              titulo: act.titulo,
              colaboradores: revisionesPorActividad[act.id]?.actividad.colaboradores || []
          }))
      }
    });

  } catch (error) {
    console.error("Error en getActividadesConRevisiones:", error);
    return res.status(500).json({ success: false, message: "Error interno" });
  }
}

// NUEVA FUNCIÓN PARA TAREAS TERMINADAS
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

    const sessionId = generarSessionIdDiario(odooUserId);

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


// 
// nueva funcio
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
    const { mensaje } = sanitizeObject(req.body);
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

    const contextoMemoria = await memoriaService.generarContextoIA(userId, mensaje);

    const { historial } = await memoriaService.obtenerHistorial(userId, 5);
    const contextoHistorial = historial && historial.length > 0
      ? historial.map(h => `${h.ia === 'usuario' ? 'Usuario' : 'Asistente'}: ${h.resumenConversacion}`).join('\n')
      : '';

    const prompt = `Eres un asistente personal inteligente y versátil. Puedes hablar de cualquier tema de forma natural.

CONTEXTO DEL USUARIO:
${contextoMemoria || 'Esta es la primera vez que hablas con este usuario.'}

${contextoHistorial ? `CONVERSACIÓN RECIENTE:\n${contextoHistorial}\n` : ''}

MENSAJE ACTUAL DEL USUARIO:
"${mensaje}"

INSTRUCCIONES:
1. Responde de forma natural y amigable
2. Puedes hablar de cualquier tema: tecnología, vida cotidiana, consejos, preguntas generales, etc.
3. No te limites a un solo tema, sé flexible
4. Si el usuario solo dice "hola", responde con un saludo simple y natural, no asumas que necesita ayuda con algo específico
5. Si el usuario te dice gracias, responde con un "No te preocupes" o "De nada" lo importante es que no malgastes recursos allí
6. Si menciona información nueva sobre él, tómalo en cuenta
7. No inventes información que no tienes
8. Sé directo y conciso
9. No digas que eres un modelo de lenguaje

FORMATO DE RESPUESTA (JSON sin markdown):
{
  "deteccion": "general" | "conversacional" | "técnico",
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
      console.error('❌ Respuesta de IA inválida:', aiResult.text);

      // Fallback: intentar extraer al menos el texto
      return res.status(200).json({
        success: true,
        respuesta: "Disculpa, tuve un problema al procesar tu mensaje. ¿Podrías ser más específico?"
      });
    }

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
      deteccion: respuestaIA.deteccion
    });

  } catch (error) {
    console.error("❌ Error en consultarIA:", error);

    // Log más detallado
    if (error.response) {
      console.error('Error de API:', error.response.data);
    } else if (error.request) {
      console.error('Error de red:', error.message);
    } else {
      console.error('Error:', error.message);
    }

    return res.status(500).json({
      success: false,
      error: "Error al conectar con el servicio de IA. Por favor, intenta nuevamente."
    });
  }
}
export async function consultarIAProyecto(req, res) {
  try {
    const { mensaje } = sanitizeObject(req.body);
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

    const { historial } = await memoriaService.obtenerHistorial(userId, 5);
    const contextoHistorial = historial && historial.length > 0
      ? historial.map(h => `${h.ia === 'usuario' ? 'Usuario' : 'Asistente'}: ${h.resumenConversacion}`).join('\n')
      : '';

    const prompt = `Eres un asistente personal inteligente. Tu trabajo es responder de forma natural, útil y relevante.

CONTEXTO DEL USUARIO:
${contextoMemoria || 'Primera interacción con este usuario.'}

${contextoHistorial ? `CONVERSACIÓN RECIENTE:\n${contextoHistorial}\n` : ''}

${tieneActividades ? `ACTIVIDADES Y PENDIENTES DEL USUARIO:\n${JSON.stringify(actividadesResumidas, null, 2)}\n` : 'El usuario no tiene actividades registradas.\n'}

MENSAJE ACTUAL DEL USUARIO:
"${mensaje}"

INSTRUCCIONES:
1. Lee cuidadosamente el mensaje del usuario
2. Si pregunta sobre sus actividades/proyectos/pendientes, usa la información de ACTIVIDADES
3. Si pregunta algo general, responde con conocimiento general
4. Si menciona información nueva sobre él (nombre, gustos, trabajo), tómalo en cuenta
5. NO inventes información que no tienes
6. NO asumas cosas del usuario que no están en el contexto
7. Sé directo y natural en tu respuesta

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
      console.error('❌ Respuesta de IA inválida:', aiResult.text);

      // Fallback: intentar extraer al menos el texto
      return res.status(200).json({
        success: true,
        respuesta: "Disculpa, tuve un problema al procesar tu mensaje. ¿Podrías ser más específico?"
      });
    }

    const extraccion = await memoriaService.extraerConIA(
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

    return res.status(200).json({
      success: true,
      respuesta: respuestaIA.respuesta.trim(),
      deteccion: respuestaIA.deteccion
    });

  } catch (error) {
    console.error("❌ Error en consultarIA:", error);

    // Log más detallado
    if (error.response) {
      console.error('Error de API:', error.response.data);
    } else if (error.request) {
      console.error('Error de red:', error.message);
    } else {
      console.error('Error:', error.message);
    }

    return res.status(500).json({
      success: false,
      error: "Error al conectar con el servicio de IA. Por favor, intenta nuevamente."
    });
  }
}