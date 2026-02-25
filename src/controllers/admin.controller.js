// controllers/admin.controller.js - SOLO DATOS LOCALES
import ActividadesSchema from "../models/actividades.model.js";

/**
 * Controlador para obtener todas las explicaciones de voz
 * @route GET /api/admin/explicaciones
 * @access Admin
 */

export async function obtenerTodasExplicacionesAdmin(req, res) {
  try {
    // Obtener todos los documentos
    const todosLosDocumentos = await ActividadesSchema.find({}).lean();

    const reportes = [];
    let totalExplicaciones = 0;

    // Procesar cada documento
    todosLosDocumentos.forEach((documento) => {
      const usuarioData = {
        id: documento._id.toString(),
        odooUserId: documento.odooUserId,
        email: documento.emailUsuario || 'No registrado',
        nombre: documento.nombreUsuario || `Usuario ${documento.odooUserId.substring(0, 6)}`,
        fechaRegistro: documento.createdAt,
        ultimaActualizacion: documento.updatedAt,
        preferencias: documento.preferencias || {},
        sesionesVoz: (documento.sesionesVoz || []).length,
        explicaciones: []
      };

      // Extraer explicaciones de actividades y pendientes
      if (documento.actividades && Array.isArray(documento.actividades)) {
        documento.actividades.forEach((actividad) => {
          // Obtener colaboradores de la actividad
          const colaboradoresActividad = actividad.colaboradoresEmails || [];
          const idsColaboradores = actividad.IdColaboradoresEmails || [];

          if (actividad.pendientes && Array.isArray(actividad.pendientes)) {
            actividad.pendientes.forEach((pendiente) => {
              
              // Explicacion actual
              if (pendiente.explicacionVoz && pendiente.explicacionVoz.texto) {
                usuarioData.explicaciones.push({
                  id: pendiente.pendienteId,
                  pendiente: pendiente.nombre,
                  actividad: actividad.titulo,
                  proyecto: actividad.tituloProyecto || 'Sin proyecto',
                  fechaActividad: actividad.fecha || 'Sin fecha',
                  horaInicio: actividad.horaInicio || '',
                  horaFin: actividad.horaFin || '',
                  status: actividad.status || '',
                  texto: pendiente.explicacionVoz.texto,
                  fecha: pendiente.explicacionVoz.fechaRegistro,
                  email: pendiente.explicacionVoz.emailUsuario,
                  validada: pendiente.explicacionVoz.validadaPorIA || false,
                  razon: pendiente.explicacionVoz.razonIA || '',
                  duracion: pendiente.duracionMin || 0,
                  prioridad: pendiente.prioridad || 'MEDIA',
                  terminada: pendiente.terminada || false,
                  confirmada: pendiente.confirmada || false,
                  colaboradores: colaboradoresActividad,
                  idsColaboradores: idsColaboradores,
                  tieneColaboradores: colaboradoresActividad.length > 0
                });
                totalExplicaciones++;
              }

              // Historial de explicaciones
              if (pendiente.historialExplicaciones && pendiente.historialExplicaciones.length > 0) {
                pendiente.historialExplicaciones.forEach((historial) => {
                  if (historial.texto) {
                    usuarioData.explicaciones.push({
                      id: `${pendiente.pendienteId}-historial`,
                      pendiente: pendiente.nombre,
                      actividad: actividad.titulo,
                      proyecto: actividad.tituloProyecto || 'Sin proyecto',
                      fechaActividad: actividad.fecha || 'Sin fecha',
                      horaInicio: actividad.horaInicio || '',
                      horaFin: actividad.horaFin || '',
                      status: actividad.status || '',
                      texto: historial.texto,
                      fecha: historial.fecha,
                      email: historial.emailUsuario,
                      validada: historial.validadaPorIA || false,
                      razon: historial.razonIA || '',
                      duracion: pendiente.duracionMin || 0,
                      prioridad: pendiente.prioridad || 'MEDIA',
                      esHistorial: true,
                      colaboradores: colaboradoresActividad,
                      idsColaboradores: idsColaboradores,
                      tieneColaboradores: colaboradoresActividad.length > 0
                    });
                    totalExplicaciones++;
                  }
                });
              }
            });
          }
        });
      }

      // Si tiene explicaciones, agregar estadisticas basicas
      if (usuarioData.explicaciones.length > 0) {
        usuarioData.totalExplicaciones = usuarioData.explicaciones.length;
        usuarioData.validadas = usuarioData.explicaciones.filter(e => e.validada).length;
        usuarioData.rechazadas = usuarioData.explicaciones.filter(e => !e.validada && e.razon).length;
        
        // Ordenar por fecha
        usuarioData.explicaciones.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      }

      reportes.push(usuarioData);
    });

    // Ordenar usuarios por ultima actividad
    reportes.sort((a, b) => {
      const fechaA = a.explicaciones[0]?.fecha || a.ultimaActualizacion;
      const fechaB = b.explicaciones[0]?.fecha || b.ultimaActualizacion;
      return new Date(fechaB) - new Date(fechaA);
    });

    // Respuesta final
    return res.json({
      success: true,
      total: reportes.length,
      totalExplicaciones,
      usuarios: reportes
    });

  } catch (error) {
    console.error('Error en obtenerTodasExplicacionesAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
}
/**
 * Controlador para obtener explicaciones de voz por ID de actividad
 * @route GET /api/admin/explicaciones/actividad/:actividadId
 * @access Admin
 */

export async function obtenerExplicacionesPorActividad(req, res) {
  try {
    const { actividadId } = req.params;

    if (!actividadId) {
      return res.status(400).json({
        success: false,
        message: 'El ID de actividad es requerido'
      });
    }

    // Buscar en todos los documentos que contengan la actividad
    const documentos = await ActividadesSchema.find({
      'actividades.actividadId': actividadId
    }).lean();

    if (!documentos || documentos.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró la actividad especificada'
      });
    }

    const resultados = [];

    // Procesar cada documento donde aparece la actividad
    documentos.forEach((documento) => {
      // Buscar la actividad específica
      const actividadEncontrada = documento.actividades.find(
        act => act.actividadId === actividadId
      );

      if (actividadEncontrada) {
        const actividadData = {
          actividadId: actividadEncontrada.actividadId,
          titulo: actividadEncontrada.titulo || 'Sin título',
          proyecto: actividadEncontrada.tituloProyecto || 'Sin proyecto',
          fecha: actividadEncontrada.fecha || 'Sin fecha',
          horaInicio: actividadEncontrada.horaInicio || '',
          horaFin: actividadEncontrada.horaFin || '',
          status: actividadEncontrada.status || 'Sin estado',
          colaboradores: actividadEncontrada.colaboradoresEmails || [],
          idsColaboradores: actividadEncontrada.IdColaboradoresEmails || [],
          totalColaboradores: (actividadEncontrada.colaboradoresEmails || []).length,
          usuario: {
            id: documento._id.toString(),
            odooUserId: documento.odooUserId,
            email: documento.emailUsuario || 'No registrado',
            nombre: documento.nombreUsuario || `Usuario ${documento.odooUserId.substring(0, 6)}`
          },
          tareas: [],
          totalTareas: 0,
          tareasConExplicacion: 0,
          tareasSinExplicacion: 0
        };

        // Procesar las tareas (pendientes)
        if (actividadEncontrada.pendientes && Array.isArray(actividadEncontrada.pendientes)) {
          actividadData.totalTareas = actividadEncontrada.pendientes.length;

          actividadEncontrada.pendientes.forEach((pendiente) => {
            const tareaData = {
              pendienteId: pendiente.pendienteId,
              nombre: pendiente.nombre || 'Sin nombre',
              descripcion: pendiente.descripcion || '',
              duracionMin: pendiente.duracionMin || 0,
              prioridad: pendiente.prioridad || 'MEDIA',
              complejidad: pendiente.complejidad || 'MEDIA',
              terminada: pendiente.terminada || false,
              confirmada: pendiente.confirmada || false,
              fechaCreacion: pendiente.fechaCreacion,
              fechaFinTerminada: pendiente.fechaFinTerminada,
              tags: pendiente.tags || [],
              requiereAtencion: pendiente.requiereAtencion || false,
              tieneExplicacion: false,
              explicacion: null,
              historialExplicaciones: []
            };

            // Verificar si tiene explicacion actual
            if (pendiente.explicacionVoz && pendiente.explicacionVoz.texto) {
              tareaData.tieneExplicacion = true;
              tareaData.explicacion = {
                texto: pendiente.explicacionVoz.texto,
                fecha: pendiente.explicacionVoz.fechaRegistro,
                email: pendiente.explicacionVoz.emailUsuario,
                validada: pendiente.explicacionVoz.validadaPorIA || false,
                razon: pendiente.explicacionVoz.razonIA || '',
                metadata: pendiente.explicacionVoz.metadata || {}
              };
              actividadData.tareasConExplicacion++;
            }

            // Agregar historial si existe
            if (pendiente.historialExplicaciones && pendiente.historialExplicaciones.length > 0) {
              tareaData.historialExplicaciones = pendiente.historialExplicaciones.map(hist => ({
                texto: hist.texto,
                fecha: hist.fecha,
                email: hist.emailUsuario,
                validada: hist.validadaPorIA || false,
                razon: hist.razonIA || '',
                sessionId: hist.sessionId,
                resultado: hist.resultado || {}
              }));
              
              // Si no tiene explicacion actual pero tiene historial, contar como tarea con explicacion
              if (!tareaData.tieneExplicacion && tareaData.historialExplicaciones.length > 0) {
                actividadData.tareasConExplicacion++;
              }
            }

            actividadData.tareas.push(tareaData);
          });

          actividadData.tareasSinExplicacion = actividadData.totalTareas - actividadData.tareasConExplicacion;
        }

        // Ordenar tareas: primero las que tienen explicacion, luego por prioridad
        actividadData.tareas.sort((a, b) => {
          if (a.tieneExplicacion && !b.tieneExplicacion) return -1;
          if (!a.tieneExplicacion && b.tieneExplicacion) return 1;
          
          const prioridadOrden = { 'URGENTE': 1, 'ALTA': 2, 'MEDIA': 3, 'BAJA': 4 };
          return (prioridadOrden[a.prioridad] || 5) - (prioridadOrden[b.prioridad] || 5);
        });

        resultados.push(actividadData);
      }
    });

    // Si hay multiples usuarios con la misma actividad, devolver todos
    return res.json({
      success: true,
      actividadId,
      totalResultados: resultados.length,
      resultados
    });

  } catch (error) {
    console.error('Error en obtenerExplicacionesPorActividad:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
}

/**
 * Controlador para obtener explicaciones por ID de pendiente/tarea
 * @route GET /api/admin/explicaciones/pendiente/:pendienteId
 * @access Admin
 */

export async function obtenerExplicacionesPorPendiente(req, res) {
  try {
    const { pendienteId } = req.params;

    if (!pendienteId) {
      return res.status(400).json({
        success: false,
        message: 'El ID de pendiente es requerido'
      });
    }

    // Buscar en todos los documentos que contengan el pendiente
    const documentos = await ActividadesSchema.find({
      'actividades.pendientes.pendienteId': pendienteId
    }).lean();

    if (!documentos || documentos.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se encontró el pendiente especificado'
      });
    }

    const resultados = [];

    documentos.forEach((documento) => {
      // Buscar la actividad y pendiente específicos
      documento.actividades.forEach((actividad) => {
        const pendienteEncontrado = actividad.pendientes?.find(
          p => p.pendienteId === pendienteId
        );

        if (pendienteEncontrado) {
          const pendienteData = {
            pendienteId: pendienteEncontrado.pendienteId,
            nombre: pendienteEncontrado.nombre || 'Sin nombre',
            descripcion: pendienteEncontrado.descripcion || '',
            queHizo: pendienteEncontrado.queHizo || '',
            duracionMin: pendienteEncontrado.duracionMin || 0,
            prioridad: pendienteEncontrado.prioridad || 'MEDIA',
            complejidad: pendienteEncontrado.complejidad || 'MEDIA',
            terminada: pendienteEncontrado.terminada || false,
            confirmada: pendienteEncontrado.confirmada || false,
            fechaCreacion: pendienteEncontrado.fechaCreacion,
            fechaFinTerminada: pendienteEncontrado.fechaFinTerminada,
            tags: pendienteEncontrado.tags || [],
            requiereAtencion: pendienteEncontrado.requiereAtencion || false,
            
            actividad: {
              actividadId: actividad.actividadId,
              titulo: actividad.titulo || 'Sin título',
              proyecto: actividad.tituloProyecto || 'Sin proyecto',
              fecha: actividad.fecha || 'Sin fecha',
              colaboradores: actividad.colaboradoresEmails || []
            },
            
            usuario: {
              id: documento._id.toString(),
              odooUserId: documento.odooUserId,
              email: documento.emailUsuario || 'No registrado',
              nombre: documento.nombreUsuario || `Usuario ${documento.odooUserId.substring(0, 6)}`
            },
            
            explicacionActual: null,
            historialExplicaciones: [],
            totalExplicaciones: 0
          };

          // Explicacion actual
          if (pendienteEncontrado.explicacionVoz && pendienteEncontrado.explicacionVoz.texto) {
            pendienteData.explicacionActual = {
              texto: pendienteEncontrado.explicacionVoz.texto,
              fecha: pendienteEncontrado.explicacionVoz.fechaRegistro,
              email: pendienteEncontrado.explicacionVoz.emailUsuario,
              validada: pendienteEncontrado.explicacionVoz.validadaPorIA || false,
              razon: pendienteEncontrado.explicacionVoz.razonIA || '',
              metadata: pendienteEncontrado.explicacionVoz.metadata || {}
            };
            pendienteData.totalExplicaciones++;
          }

          // Historial
          if (pendienteEncontrado.historialExplicaciones && pendienteEncontrado.historialExplicaciones.length > 0) {
            pendienteData.historialExplicaciones = pendienteEncontrado.historialExplicaciones.map(hist => ({
              texto: hist.texto,
              fecha: hist.fecha,
              email: hist.emailUsuario,
              validada: hist.validadaPorIA || false,
              razon: hist.razonIA || '',
              sessionId: hist.sessionId,
              resultado: hist.resultado || {}
            }));
            pendienteData.totalExplicaciones += pendienteData.historialExplicaciones.length;
          }

          resultados.push(pendienteData);
        }
      });
    });

    return res.json({
      success: true,
      pendienteId,
      totalResultados: resultados.length,
      resultados
    });

  } catch (error) {
    console.error('Error en obtenerExplicacionesPorPendiente:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
}
// Versión alternativa: solo datos básicos
export async function obtenerExplicacionesBasicas(req, res) {
  try {
    console.log("📊 Obteniendo datos básicos...");
    
    const conteo = await ActividadesSchema.countDocuments();
    const usuarios = await ActividadesSchema.find({}, 'odooUserId actividades')
      .limit(50)
      .lean();
    
    const datosBasicos = usuarios.map(doc => ({
      odooUserId: doc.odooUserId,
      totalActividades: doc.actividades?.length || 0,
      totalTareas: doc.actividades?.reduce((sum, act) => sum + (act.pendientes?.length || 0), 0) || 0
    }));
    
    return res.json({
      success: true,
      totalUsuarios: conteo,
      datos: datosBasicos,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Error en obtenerExplicacionesBasicas:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Controlador para obtener todas las actividades con sus explicaciones
 * @route GET /api/admin/todas-actividades
 * @access Admin
 */

export async function obtenerTodasActividadesConExplicaciones(req, res) {
  try {
    // Obtener todos los documentos
    const todosLosDocumentos = await ActividadesSchema.find({}).lean();

    // Usar un Map para evitar duplicados por actividadId
    const actividadesMap = new Map();
    let totalTareas = 0;

    // Procesar cada documento
    todosLosDocumentos.forEach((documento) => {
      if (documento.actividades && Array.isArray(documento.actividades)) {
        documento.actividades.forEach((actividad) => {
          const actividadId = actividad.actividadId;

          // Si la actividad ya existe, solo actualizar si es necesario
          if (actividadesMap.has(actividadId)) {
            const existente = actividadesMap.get(actividadId);
            
            // Agregar usuario adicional si no existe
            if (!existente.usuarios.some(u => u.id === documento._id.toString())) {
              existente.usuarios.push({
                id: documento._id.toString(),
                odooUserId: documento.odooUserId,
                email: documento.emailUsuario || 'No registrado',
                nombre: documento.nombreUsuario || `Usuario ${documento.odooUserId.substring(0, 6)}`
              });
              existente.totalUsuarios = existente.usuarios.length;
            }

            // Actualizar colaboradores si hay nuevos
            if (actividad.colaboradoresEmails && actividad.colaboradoresEmails.length > 0) {
              actividad.colaboradoresEmails.forEach(email => {
                if (!existente.colaboradores.includes(email)) {
                  existente.colaboradores.push(email);
                }
              });
            }
            
            actividadesMap.set(actividadId, existente);
          } else {
            // Nueva actividad
            const nuevaActividad = {
              actividadId: actividad.actividadId,
              titulo: actividad.titulo || 'Sin título',
              proyecto: actividad.tituloProyecto || 'Sin proyecto',
              fecha: actividad.fecha || 'Sin fecha',
              horaInicio: actividad.horaInicio || '',
              horaFin: actividad.horaFin || '',
              status: actividad.status || 'Sin estado',
              colaboradores: actividad.colaboradoresEmails || [],
              idsColaboradores: actividad.IdColaboradoresEmails || [],
              totalColaboradores: (actividad.colaboradoresEmails || []).length,
              
              usuarios: [{
                id: documento._id.toString(),
                odooUserId: documento.odooUserId,
                email: documento.emailUsuario || 'No registrado',
                nombre: documento.nombreUsuario || `Usuario ${documento.odooUserId.substring(0, 6)}`
              }],
              totalUsuarios: 1,
              
              tareas: [],
              totalTareas: 0,
              tareasConExplicacion: 0,
              tareasSinExplicacion: 0
            };

            // Procesar las tareas (pendientes)
            if (actividad.pendientes && Array.isArray(actividad.pendientes)) {
              nuevaActividad.totalTareas = actividad.pendientes.length;
              totalTareas += actividad.pendientes.length;

              actividad.pendientes.forEach((pendiente) => {
                const tareaData = {
                  pendienteId: pendiente.pendienteId,
                  nombre: pendiente.nombre || 'Sin nombre',
                  descripcion: pendiente.descripcion || '',
                  duracionMin: pendiente.duracionMin || 0,
                  prioridad: pendiente.prioridad || 'MEDIA',
                  complejidad: pendiente.complejidad || 'MEDIA',
                  terminada: pendiente.terminada || false,
                  confirmada: pendiente.confirmada || false,
                  fechaCreacion: pendiente.fechaCreacion,
                  fechaFinTerminada: pendiente.fechaFinTerminada,
                  tags: pendiente.tags || [],
                  requiereAtencion: pendiente.requiereAtencion || false,
                  
                  tieneExplicacion: false,
                  explicacionActual: null,
                  historialExplicaciones: []
                };

                // Verificar si tiene explicacion actual
                if (pendiente.explicacionVoz && pendiente.explicacionVoz.texto) {
                  tareaData.tieneExplicacion = true;
                  tareaData.explicacionActual = {
                    texto: pendiente.explicacionVoz.texto,
                    fecha: pendiente.explicacionVoz.fechaRegistro,
                    email: pendiente.explicacionVoz.emailUsuario,
                    validada: pendiente.explicacionVoz.validadaPorIA || false,
                    razon: pendiente.explicacionVoz.razonIA || '',
                    metadata: pendiente.explicacionVoz.metadata || {}
                  };
                  nuevaActividad.tareasConExplicacion++;
                }

                // Verificar historial
                if (pendiente.historialExplicaciones && pendiente.historialExplicaciones.length > 0) {
                  tareaData.historialExplicaciones = pendiente.historialExplicaciones.map(hist => ({
                    texto: hist.texto,
                    fecha: hist.fecha,
                    email: hist.emailUsuario,
                    validada: hist.validadaPorIA || false,
                    razon: hist.razonIA || '',
                    sessionId: hist.sessionId
                  }));
                  
                  if (!tareaData.tieneExplicacion && tareaData.historialExplicaciones.length > 0) {
                    nuevaActividad.tareasConExplicacion++;
                  }
                }

                nuevaActividad.tareas.push(tareaData);
              });

              nuevaActividad.tareasSinExplicacion = nuevaActividad.totalTareas - nuevaActividad.tareasConExplicacion;
              
              // Ordenar tareas: primero las que tienen explicacion
              nuevaActividad.tareas.sort((a, b) => {
                if (a.tieneExplicacion && !b.tieneExplicacion) return -1;
                if (!a.tieneExplicacion && b.tieneExplicacion) return 1;
                return 0;
              });
            }

            actividadesMap.set(actividadId, nuevaActividad);
          }
        });
      }
    });

    // Convertir Map a array
    const todasLasActividades = Array.from(actividadesMap.values());

    // Ordenar actividades por fecha (mas reciente primero)
    todasLasActividades.sort((a, b) => {
      if (a.fecha === 'Sin fecha') return 1;
      if (b.fecha === 'Sin fecha') return -1;
      return b.fecha.localeCompare(a.fecha);
    });

    // Respuesta final
    return res.json({
      success: true,
      totalActividades: todasLasActividades.length,
      totalTareas,
      actividades: todasLasActividades
    });

  } catch (error) {
    console.error('Error en obtenerTodasActividadesConExplicaciones:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
}