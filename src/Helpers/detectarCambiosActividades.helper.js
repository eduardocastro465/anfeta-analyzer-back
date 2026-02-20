import axios from 'axios';
import ActividadesSchema from '../models/actividades.model.js';
import { API_URL_ANFETA } from '../config.js';

export async function detectarYSincronizarCambios(odooUserId, email) {
  try {
    console.log(`🔍 Iniciando detección de cambios para usuario: ${email}`);

    const today = new Date().toISOString().split('T')[0];

    // ============================================================================
    // 1. OBTENER DATOS ACTUALES DESDE LA API
    // ============================================================================
    const { actividadesAPI, revisionesAPI } = await obtenerDatosAPI(email, today);

    if (!actividadesAPI.length) {
      console.log('⚠️ No hay actividades en la API para hoy');
      return {
        success: true,
        cambiosDetectados: false,
        mensaje: 'No hay actividades en la API para hoy',
        estadisticas: {
          actividadesNuevas: 0,
          pendientesNuevos: 0,
          pendientesEliminados: 0,
          pendientesActualizados: 0
        }
      };
    }

    // ============================================================================
    // 2. OBTENER DATOS ACTUALES DE LA BD LOCAL
    // ============================================================================
    const registroBD = await ActividadesSchema.findOne({ odooUserId });

    // Si no existe registro en BD, es primera vez - guardar todo
    if (!registroBD) {
      console.log('📦 Primera sincronización - creando registro inicial');
      return await sincronizacionInicial(odooUserId, email, actividadesAPI, revisionesAPI, today);
    }

    // ============================================================================
    // 3. PROCESAR Y FILTRAR ACTIVIDADES DE LA API (SOLO DE HOY)
    // ============================================================================
    const actividadesValidasAPI = procesarActividadesAPI(
      actividadesAPI,
      revisionesAPI,
      email
    );

    console.log(`📊 Actividades válidas de la API: ${actividadesValidasAPI.length}`);

    // ============================================================================
    // 4. DETECTAR CAMBIOS ENTRE API Y BD
    // ============================================================================
    const cambios = detectarCambios(
      registroBD.actividades || [],
      actividadesValidasAPI,
      today
    );

    console.log('🔄 Cambios detectados:', {
      actividadesNuevas: cambios.actividadesNuevas.length,
      pendientesNuevos: cambios.pendientesNuevos.length,
      pendientesEliminados: cambios.pendientesEliminados.length,
      pendientesActualizados: cambios.pendientesActualizados.length,
      pendientesReasignados: cambios.pendientesReasignados.length
    });

    // Si no hay cambios, retornar
    if (!hayCambios(cambios)) {
      return {
        success: true,
        cambiosDetectados: false,
        mensaje: 'No hay cambios desde la última sincronización',
        estadisticas: {
          actividadesNuevas: 0,
          pendientesNuevos: 0,
          pendientesEliminados: 0,
          pendientesActualizados: 0,
          pendientesReasignados: 0
        }
      };
    }

    // ============================================================================
    // 5. APLICAR CAMBIOS A LA BD
    // ============================================================================
    const resultado = await aplicarCambios(
      odooUserId,
      email,
      registroBD,
      cambios,
      actividadesValidasAPI,
      today
    );

    return resultado;

  } catch (error) {
    console.error('❌ Error en detectarYSincronizarCambios:', error);
    return {
      success: false,
      error: error.message,
      estadisticas: {
        actividadesNuevas: 0,
        pendientesNuevos: 0,
        pendientesEliminados: 0,
        pendientesActualizados: 0,
        pendientesReasignados: 0
      }
    };
  }
}

/**
 * ============================================================================
 * FUNCIONES AUXILIARES
 * ============================================================================
 */

/**
 * Obtener datos desde la API
 */
async function obtenerDatosAPI(email, today) {
  try {
    // 1. Obtener actividades del día
    const actividadesResponse = await axios.get(
      `${API_URL_ANFETA}/actividades/assignee/${email}/del-dia`
    );

    const actividadesAPI = actividadesResponse.data?.data || [];

    // 2. Obtener revisiones del día
    let revisionesAPI = { colaboradores: [] };
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
      revisionesAPI = revisionesResponse.data?.data || { colaboradores: [] };
    } catch (e) {
      console.warn('⚠️ Error obteniendo revisiones:', e.message);
    }

    return { actividadesAPI, revisionesAPI };
  } catch (error) {
    console.error('❌ Error obteniendo datos de la API:', error);
    throw error;
  }
}

/**
 * Procesar y filtrar actividades desde la API
 */
function procesarActividadesAPI(actividadesRaw, revisionesAPI, email) {
  const HORARIO_INICIO = 9.5;  // 9:30 AM
  const HORARIO_FIN = 17.0;    // 5:00 PM

  // Filtrar actividades válidas
  const actividadesFiltradas = actividadesRaw.filter(actividad => {
    const titulo = actividad.titulo?.toLowerCase() || "";
    
    // Excluir 00ftf y 00sec
    if (titulo.startsWith("00ftf") || actividad.status === "00sec") {
      return false;
    }

    // Verificar horario laboral
    const horaInicio = convertirHoraADecimal(actividad.horaInicio);
    const horaFin = convertirHoraADecimal(actividad.horaFin);

    return horaInicio >= HORARIO_INICIO && 
           horaInicio < HORARIO_FIN && 
           horaFin <= HORARIO_FIN;
  });

  // Mapear con sus pendientes desde revisiones
  const actividadesConPendientes = actividadesFiltradas.map(actividad => {
    const pendientesConTiempo = [];

    // Buscar pendientes en revisiones
    if (revisionesAPI.colaboradores && Array.isArray(revisionesAPI.colaboradores)) {
      revisionesAPI.colaboradores.forEach(colaborador => {
        (colaborador.items?.actividades || []).forEach(actRev => {
          if (actRev.id !== actividad.id) return;
          if (actRev.titulo.toLowerCase().includes('00ftf')) return;

          (actRev.pendientes || []).forEach(p => {
            // Solo pendientes asignados al usuario
            const estaAsignado = p.assignees?.some(a => a.name === email);
            if (!estaAsignado) return;

            // Solo pendientes con tiempo
            if (!p.duracionMin || p.duracionMin <= 0) return;

            pendientesConTiempo.push({
              id: p.id,
              nombre: p.nombre,
              duracionMin: p.duracionMin,
              terminada: p.terminada || false,
              confirmada: p.confirmada || false,
              fechaCreacion: p.fechaCreacion,
              fechaFinTerminada: p.fechaFinTerminada,
              colaboradores: (p.assignees || [])
                .map(a => a.name)
                .filter(nombre => nombre.toLowerCase() !== email.toLowerCase())
            });
          });
        });
      });
    }

    return {
      actividadId: actividad.id,
      titulo: actividad.titulo,
      tituloProyecto: actividad.tituloProyecto,
      horaInicio: actividad.horaInicio,
      horaFin: actividad.horaFin,
      status: actividad.status,
      pendientes: pendientesConTiempo
    };
  });

  // Solo retornar actividades que tienen pendientes con tiempo
  return actividadesConPendientes.filter(act => act.pendientes.length > 0);
}

/**
 * Detectar cambios entre BD y API
 */
function detectarCambios(actividadesBD, actividadesAPI, today) {
  const cambios = {
    actividadesNuevas: [],
    pendientesNuevos: [],
    pendientesEliminados: [],
    pendientesActualizados: [],
    pendientesReasignados: []
  };

  // Filtrar actividades de hoy en BD
  const actividadesBDHoy = actividadesBD.filter(act => act.fecha === today);

  // Crear Sets para comparación rápida
  const idsActividadesBD = new Set(actividadesBDHoy.map(a => a.actividadId));
  const idsActividadesAPI = new Set(actividadesAPI.map(a => a.actividadId));

  // 1. DETECTAR ACTIVIDADES NUEVAS
  actividadesAPI.forEach(actAPI => {
    if (!idsActividadesBD.has(actAPI.actividadId)) {
      cambios.actividadesNuevas.push(actAPI);
    }
  });

  // 2. DETECTAR CAMBIOS EN PENDIENTES DE ACTIVIDADES EXISTENTES
  actividadesAPI.forEach(actAPI => {
    const actBD = actividadesBDHoy.find(a => a.actividadId === actAPI.actividadId);
    
    if (!actBD) return; // Ya se manejó como actividad nueva

    // Crear Sets de pendientes
    const idsPendientesBD = new Set((actBD.pendientes || []).map(p => p.pendienteId));
    const idsPendientesAPI = new Set(actAPI.pendientes.map(p => p.id));

    // 2.1 PENDIENTES NUEVOS
    actAPI.pendientes.forEach(pAPI => {
      if (!idsPendientesBD.has(pAPI.id)) {
        cambios.pendientesNuevos.push({
          actividadId: actAPI.actividadId,
          pendiente: pAPI
        });
      }
    });

    // 2.2 PENDIENTES ELIMINADOS (ya no están en la API)
    (actBD.pendientes || []).forEach(pBD => {
      if (!idsPendientesAPI.has(pBD.pendienteId)) {
        cambios.pendientesEliminados.push({
          actividadId: actBD.actividadId,
          pendienteId: pBD.pendienteId,
          nombre: pBD.nombre
        });
      }
    });

    // 2.3 PENDIENTES ACTUALIZADOS (existen en ambos)
    actAPI.pendientes.forEach(pAPI => {
      const pBD = (actBD.pendientes || []).find(p => p.pendienteId === pAPI.id);
      
      if (!pBD) return; // Ya se manejó como nuevo

      // Detectar cambios en campos
      const cambiosEnPendiente = {};
      let hayCambio = false;

      if (pAPI.duracionMin !== pBD.duracionMin) {
        cambiosEnPendiente.duracionMin = pAPI.duracionMin;
        hayCambio = true;
      }

      if (pAPI.nombre !== pBD.nombre) {
        cambiosEnPendiente.nombre = pAPI.nombre;
        hayCambio = true;
      }

      // Solo actualizar terminada/confirmada si NO tiene explicación
      if (!pBD.descripcion && !pBD.queHizo) {
        if (pAPI.terminada !== pBD.terminada) {
          cambiosEnPendiente.terminada = pAPI.terminada;
          hayCambio = true;
        }

        if (pAPI.confirmada !== pBD.confirmada) {
          cambiosEnPendiente.confirmada = pAPI.confirmada;
          hayCambio = true;
        }
      }

      // Comparar colaboradores
      const colabsBDStr = JSON.stringify((pBD.colaboradores || []).sort());
      const colabsAPIStr = JSON.stringify(pAPI.colaboradores.sort());
      
      if (colabsBDStr !== colabsAPIStr) {
        cambiosEnPendiente.colaboradores = pAPI.colaboradores;
        hayCambio = true;
      }

      if (hayCambio) {
        cambios.pendientesActualizados.push({
          actividadId: actAPI.actividadId,
          pendienteId: pAPI.id,
          cambios: cambiosEnPendiente
        });
      }
    });
  });

  // 3. DETECTAR PENDIENTES REASIGNADOS A OTRO DÍA
  // (pendientes en BD que ya no están en ninguna actividad de la API de hoy)
  actividadesBDHoy.forEach(actBD => {
    const actAPI = actividadesAPI.find(a => a.actividadId === actBD.actividadId);
    
    // Si la actividad completa ya no existe en la API de hoy
    if (!actAPI) {
      (actBD.pendientes || []).forEach(pBD => {
        cambios.pendientesReasignados.push({
          actividadId: actBD.actividadId,
          pendienteId: pBD.pendienteId,
          nombre: pBD.nombre,
          razon: 'Actividad completa reasignada a otro día'
        });
      });
    }
  });

  return cambios;
}

/**
 * Verificar si hay cambios
 */
function hayCambios(cambios) {
  return cambios.actividadesNuevas.length > 0 ||
         cambios.pendientesNuevos.length > 0 ||
         cambios.pendientesEliminados.length > 0 ||
         cambios.pendientesActualizados.length > 0 ||
         cambios.pendientesReasignados.length > 0;
}

/**
 * Aplicar cambios a la BD
 */
async function aplicarCambios(odooUserId, email, registroBD, cambios, actividadesAPI, today) {
  try {
    console.log('💾 Aplicando cambios a la base de datos...');

    const fechaActual = new Date();
    const actividadesActualizadas = [...registroBD.actividades];

    let contadores = {
      actividadesNuevas: 0,
      pendientesNuevos: 0,
      pendientesEliminados: 0,
      pendientesActualizados: 0,
      pendientesReasignados: 0
    };

    // ============================================================================
    // 1. ELIMINAR PENDIENTES REASIGNADOS Y ELIMINADOS
    // ============================================================================
    
    // 1.1 Eliminar pendientes reasignados
    cambios.pendientesReasignados.forEach(eliminacion => {
      const actIndex = actividadesActualizadas.findIndex(
        a => a.actividadId === eliminacion.actividadId
      );

      if (actIndex !== -1) {
        const actividadOriginal = actividadesActualizadas[actIndex];
        
        // Eliminar TODOS los pendientes de esta actividad (reasignada completa)
        actividadesActualizadas[actIndex] = {
          ...actividadOriginal,
          pendientes: [],
          ultimaActualizacion: fechaActual
        };

        contadores.pendientesReasignados += (actividadOriginal.pendientes || []).length;
        
        console.log(`🗑️ Actividad ${eliminacion.actividadId} reasignada - eliminando todos sus pendientes`);
      }
    });

    // 1.2 Eliminar pendientes específicos eliminados
    cambios.pendientesEliminados.forEach(eliminacion => {
      const actIndex = actividadesActualizadas.findIndex(
        a => a.actividadId === eliminacion.actividadId
      );

      if (actIndex !== -1) {
        const pendientesActuales = actividadesActualizadas[actIndex].pendientes || [];
        
        actividadesActualizadas[actIndex] = {
          ...actividadesActualizadas[actIndex],
          pendientes: pendientesActuales.filter(
            p => p.pendienteId !== eliminacion.pendienteId
          ),
          ultimaActualizacion: fechaActual
        };

        contadores.pendientesEliminados++;
        
        console.log(`🗑️ Pendiente ${eliminacion.pendienteId} eliminado de actividad ${eliminacion.actividadId}`);
      }
    });

    // 1.3 Eliminar actividades que quedaron sin pendientes
    const actividadesConPendientes = actividadesActualizadas.filter(act => {
      if (act.fecha !== today) return true; // Mantener actividades de otros días
      return (act.pendientes || []).length > 0; // Solo mantener si tiene pendientes
    });

    // ============================================================================
    // 2. AGREGAR ACTIVIDADES NUEVAS
    // ============================================================================
    cambios.actividadesNuevas.forEach(actAPI => {
      const nuevaActividad = {
        actividadId: actAPI.actividadId,
        titulo: actAPI.titulo,
        tituloProyecto: actAPI.tituloProyecto,
        horaInicio: actAPI.horaInicio,
        horaFin: actAPI.horaFin,
        status: actAPI.status,
        fecha: today,
        pendientes: actAPI.pendientes.map(p => ({
          pendienteId: p.id,
          nombre: p.nombre,
          descripcion: "",
          queHizo: "",
          terminada: p.terminada,
          confirmada: p.confirmada,
          duracionMin: p.duracionMin,
          fechaCreacion: p.fechaCreacion,
          fechaFinTerminada: p.fechaFinTerminada,
          colaboradores: p.colaboradores,
          ultimaActualizacion: fechaActual,
          createdAt: fechaActual,
          revisadoPorVoz: false,
          vecesExplicado: 0
        })),
        ultimaActualizacion: fechaActual,
        actualizadoPor: email
      };

      actividadesConPendientes.push(nuevaActividad);
      contadores.actividadesNuevas++;
      contadores.pendientesNuevos += actAPI.pendientes.length;

      console.log(`✨ Actividad nueva agregada: ${actAPI.actividadId} con ${actAPI.pendientes.length} pendientes`);
    });

    // ============================================================================
    // 3. AGREGAR PENDIENTES NUEVOS A ACTIVIDADES EXISTENTES
    // ============================================================================
    cambios.pendientesNuevos.forEach(nuevo => {
      const actIndex = actividadesConPendientes.findIndex(
        a => a.actividadId === nuevo.actividadId
      );

      if (actIndex !== -1) {
        const nuevoPendiente = {
          pendienteId: nuevo.pendiente.id,
          nombre: nuevo.pendiente.nombre,
          descripcion: "",
          queHizo: "",
          terminada: nuevo.pendiente.terminada,
          confirmada: nuevo.pendiente.confirmada,
          duracionMin: nuevo.pendiente.duracionMin,
          fechaCreacion: nuevo.pendiente.fechaCreacion,
          fechaFinTerminada: nuevo.pendiente.fechaFinTerminada,
          colaboradores: nuevo.pendiente.colaboradores,
          ultimaActualizacion: fechaActual,
          createdAt: fechaActual,
          revisadoPorVoz: false,
          vecesExplicado: 0
        };

        actividadesConPendientes[actIndex].pendientes.push(nuevoPendiente);
        actividadesConPendientes[actIndex].ultimaActualizacion = fechaActual;

        contadores.pendientesNuevos++;

        console.log(`✨ Pendiente nuevo agregado: ${nuevo.pendiente.id} a actividad ${nuevo.actividadId}`);
      }
    });

    // ============================================================================
    // 4. ACTUALIZAR PENDIENTES EXISTENTES
    // ============================================================================
    cambios.pendientesActualizados.forEach(actualizacion => {
      const actIndex = actividadesConPendientes.findIndex(
        a => a.actividadId === actualizacion.actividadId
      );

      if (actIndex !== -1) {
        const pendientes = actividadesConPendientes[actIndex].pendientes || [];
        const pendIndex = pendientes.findIndex(
          p => p.pendienteId === actualizacion.pendienteId
        );

        if (pendIndex !== -1) {
          // Actualizar solo los campos que cambiaron
          Object.keys(actualizacion.cambios).forEach(campo => {
            actividadesConPendientes[actIndex].pendientes[pendIndex][campo] = 
              actualizacion.cambios[campo];
          });

          actividadesConPendientes[actIndex].pendientes[pendIndex].ultimaActualizacion = fechaActual;
          actividadesConPendientes[actIndex].ultimaActualizacion = fechaActual;

          contadores.pendientesActualizados++;

          console.log(`🔄 Pendiente actualizado: ${actualizacion.pendienteId} en actividad ${actualizacion.actividadId}`);
        }
      }
    });

    // ============================================================================
    // 5. GUARDAR EN BASE DE DATOS
    // ============================================================================
    const resultado = await ActividadesSchema.findOneAndUpdate(
      { odooUserId },
      {
        $set: {
          actividades: actividadesConPendientes,
          ultimaSincronizacion: fechaActual
        }
      },
      { new: true }
    );

    if (!resultado) {
      throw new Error('Error al guardar cambios en la base de datos');
    }

    console.log('✅ Cambios aplicados exitosamente');

    return {
      success: true,
      cambiosDetectados: true,
      mensaje: 'Sincronización completada exitosamente',
      estadisticas: contadores,
      detalles: {
        actividadesNuevas: cambios.actividadesNuevas.map(a => a.actividadId),
        pendientesNuevos: cambios.pendientesNuevos.length,
        pendientesEliminados: cambios.pendientesEliminados.map(p => p.pendienteId),
        pendientesActualizados: cambios.pendientesActualizados.map(p => p.pendienteId),
        pendientesReasignados: cambios.pendientesReasignados.map(p => p.pendienteId)
      }
    };

  } catch (error) {
    console.error('❌ Error aplicando cambios:', error);
    throw error;
  }
}

/**
 * Sincronización inicial (primera vez)
 */
async function sincronizacionInicial(odooUserId, email, actividadesAPI, revisionesAPI, today) {
  try {
    console.log('📦 Realizando sincronización inicial...');

    const actividadesValidasAPI = procesarActividadesAPI(
      actividadesAPI,
      revisionesAPI,
      email
    );

    const fechaActual = new Date();

    const actividadesParaGuardar = actividadesValidasAPI.map(act => ({
      actividadId: act.actividadId,
      titulo: act.titulo,
      tituloProyecto: act.tituloProyecto,
      horaInicio: act.horaInicio,
      horaFin: act.horaFin,
      status: act.status,
      fecha: today,
      pendientes: act.pendientes.map(p => ({
        pendienteId: p.id,
        nombre: p.nombre,
        descripcion: "",
        queHizo: "",
        terminada: p.terminada,
        confirmada: p.confirmada,
        duracionMin: p.duracionMin,
        fechaCreacion: p.fechaCreacion,
        fechaFinTerminada: p.fechaFinTerminada,
        colaboradores: p.colaboradores,
        ultimaActualizacion: fechaActual,
        createdAt: fechaActual,
        revisadoPorVoz: false,
        vecesExplicado: 0
      })),
      ultimaActualizacion: fechaActual,
      actualizadoPor: email
    }));

    await ActividadesSchema.create({
      odooUserId,
      emailUsuario: email,
      actividades: actividadesParaGuardar,
      ultimaSincronizacion: fechaActual
    });

    const totalPendientes = actividadesParaGuardar.reduce(
      (sum, act) => sum + act.pendientes.length, 
      0
    );

    console.log('✅ Sincronización inicial completada');

    return {
      success: true,
      cambiosDetectados: true,
      mensaje: 'Sincronización inicial completada',
      estadisticas: {
        actividadesNuevas: actividadesParaGuardar.length,
        pendientesNuevos: totalPendientes,
        pendientesEliminados: 0,
        pendientesActualizados: 0,
        pendientesReasignados: 0
      }
    };

  } catch (error) {
    console.error('❌ Error en sincronización inicial:', error);
    throw error;
  }
}

/**
 * Convertir hora a decimal
 */
function convertirHoraADecimal(hora) {
  if (!hora || typeof hora !== 'string') return 0;
  
  const [horas, minutos] = hora.split(':').map(Number);
  
  if (isNaN(horas) || isNaN(minutos)) return 0;
  
  return horas + (minutos / 60);
}

/**
 * Detectar cambios SIN sincronizar (solo verificación)
 */
export async function detectarCambiosSinSincronizar(odooUserId, email) {
  try {
    console.log(`🔍 Verificando cambios (sin sincronizar) para usuario: ${email}`);

    const today = new Date().toISOString().split('T')[0];

    // 1. Obtener datos de la API
    const { actividadesAPI, revisionesAPI } = await obtenerDatosAPI(email, today);

    if (!actividadesAPI.length) {
      return {
        success: true,
        hayCambios: false,
        mensaje: 'No hay actividades en la API para hoy',
        estadisticas: {
          actividadesNuevas: 0,
          pendientesNuevos: 0,
          pendientesEliminados: 0,
          pendientesActualizados: 0,
          pendientesReasignados: 0
        }
      };
    }

    // 2. Obtener datos de la BD
    const registroBD = await ActividadesSchema.findOne({ odooUserId });

    if (!registroBD) {
      // Primera vez - todo es nuevo
      const actividadesValidasAPI = procesarActividadesAPI(
        actividadesAPI,
        revisionesAPI,
        email
      );

      const totalPendientes = actividadesValidasAPI.reduce(
        (sum, act) => sum + act.pendientes.length,
        0
      );

      return {
        success: true,
        hayCambios: true,
        mensaje: 'Primera sincronización - todas las actividades son nuevas',
        estadisticas: {
          actividadesNuevas: actividadesValidasAPI.length,
          pendientesNuevos: totalPendientes,
          pendientesEliminados: 0,
          pendientesActualizados: 0,
          pendientesReasignados: 0
        },
        detalles: {
          actividadesNuevas: actividadesValidasAPI.map(a => a.actividadId),
          esPrimeraSincronizacion: true
        }
      };
    }

    // 3. Procesar actividades de la API
    const actividadesValidasAPI = procesarActividadesAPI(
      actividadesAPI,
      revisionesAPI,
      email
    );

    // 4. Detectar cambios
    const cambios = detectarCambios(
      registroBD.actividades || [],
      actividadesValidasAPI,
      today
    );

    // 5. Verificar si hay cambios
    const hayCambiosDetectados = hayCambios(cambios);

    // 6. Calcular estadísticas
    const estadisticas = {
      actividadesNuevas: cambios.actividadesNuevas.length,
      pendientesNuevos: cambios.pendientesNuevos.length,
      pendientesEliminados: cambios.pendientesEliminados.length,
      pendientesActualizados: cambios.pendientesActualizados.length,
      pendientesReasignados: cambios.pendientesReasignados.length
    };

    return {
      success: true,
      hayCambios: hayCambiosDetectados,
      mensaje: hayCambiosDetectados 
        ? 'Se detectaron cambios pendientes de sincronizar'
        : 'No hay cambios pendientes',
      estadisticas,
      detalles: hayCambiosDetectados ? {
        actividadesNuevas: cambios.actividadesNuevas.map(a => ({
          id: a.actividadId,
          titulo: a.titulo,
          pendientes: a.pendientes.length
        })),
        pendientesNuevos: cambios.pendientesNuevos.map(p => ({
          actividadId: p.actividadId,
          pendienteId: p.pendiente.id,
          nombre: p.pendiente.nombre
        })),
        pendientesEliminados: cambios.pendientesEliminados.map(p => ({
          actividadId: p.actividadId,
          pendienteId: p.pendienteId,
          nombre: p.nombre
        })),
        pendientesActualizados: cambios.pendientesActualizados.map(p => ({
          actividadId: p.actividadId,
          pendienteId: p.pendienteId,
          cambios: Object.keys(p.cambios)
        })),
        pendientesReasignados: cambios.pendientesReasignados.map(p => ({
          actividadId: p.actividadId,
          pendienteId: p.pendienteId,
          nombre: p.nombre,
          razon: p.razon
        }))
      } : null
    };

  } catch (error) {
    console.error('❌ Error en detectarCambiosSinSincronizar:', error);
    return {
      success: false,
      hayCambios: false,
      error: error.message,
      estadisticas: {
        actividadesNuevas: 0,
        pendientesNuevos: 0,
        pendientesEliminados: 0,
        pendientesActualizados: 0,
        pendientesReasignados: 0
      }
    };
  }
}

