import ActividadesSchema from "../models/actividades.model.js";

export function indexById(array = []) {
  return Object.fromEntries(array.map(item => [item.id, item]));
}

export function estaEnHorarioLaboral(horaInicio) {
  const h = parseInt(horaInicio?.split(":")[0] || "0");
  return h >= 9 && h <= 17;
}

export function calcularPrioridad(min) {
  if (min > 60) return "ALTA";
  if (min > 30) return "MEDIA";
  return "BAJA";
}


export async function detectarCambiosEnRevisiones(odooUserId, actividadesActuales, revisionesPorActividadActuales) {
  try {
    const actividadesGuardadas = await ActividadesSchema.findOne({ odooUserId: odooUserId });

    if (!actividadesGuardadas || !actividadesGuardadas.actividades || actividadesGuardadas.actividades.length === 0) {
      return {
        revisionesNuevas: actividadesActuales,
        revisionesEliminadas: [],
        cambiosEnTareas: [],
        cambiosDetectados: true,
        esPrimeraVez: true
      };
    }

    const today = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'America/Mexico_City'
    });
    const actividadesGuardadasHoy = actividadesGuardadas.actividades.filter(a => a.fecha === today);

    if (actividadesGuardadasHoy.length === 0) {
      return {
        revisionesNuevas: actividadesActuales,
        revisionesEliminadas: [],
        cambiosEnTareas: [],
        cambiosDetectados: true,
        esPrimeraVez: true
      };
    }

    const idsActuales = new Set(actividadesActuales.map(a => a.id));
    const idsGuardados = new Set(actividadesGuardadasHoy.map(a => a.actividadId));

    const revisionesNuevas = actividadesActuales.filter(a => !idsGuardados.has(a.id));
    const revisionesEliminadas = actividadesGuardadasHoy.filter(a => !idsActuales.has(a.actividadId));

    const cambiosEnTareas = [];

    actividadesActuales.forEach(actividadActual => {
      const actividadGuardada = actividadesGuardadasHoy.find(ag => ag.actividadId === actividadActual.id);

      if (actividadGuardada) {
        const revisionesActuales = revisionesPorActividadActuales[actividadActual.id];
        if (!revisionesActuales) return;

        const todasTareasActuales = [
          ...(revisionesActuales.pendientesConTiempo || []),
          ...(revisionesActuales.pendientesSinTiempo || [])
        ];

        const tareasActualesIds = new Set(todasTareasActuales.map(p => p.id));
        const tareasGuardadasIds = new Set((actividadGuardada.pendientes || []).map(p => p.pendienteId));

        const tareasNuevas = todasTareasActuales.filter(p => !tareasGuardadasIds.has(p.id));
        const tareasEliminadas = (actividadGuardada.pendientes || []).filter(p => !tareasActualesIds.has(p.pendienteId));

        if (tareasNuevas.length > 0 || tareasEliminadas.length > 0) {
          cambiosEnTareas.push({
            actividadId: actividadActual.id,
            titulo: actividadActual.titulo,
            horario: `${actividadActual.horaInicio}-${actividadActual.horaFin}`,
            tareasNuevas: tareasNuevas.map(t => ({ id: t.id, nombre: t.nombre, duracionMin: t.duracionMin || 0 })),
            tareasEliminadas: tareasEliminadas.map(t => ({ id: t.pendienteId, nombre: t.nombre, duracionMin: t.duracionMin || 0 }))
          });
        }
      }
    });

    return {
      revisionesNuevas,
      revisionesEliminadas,
      cambiosEnTareas,
      cambiosDetectados: revisionesNuevas.length > 0 || revisionesEliminadas.length > 0 || cambiosEnTareas.length > 0,
      esPrimeraVez: false
    };

  } catch (error) {
    console.error("Error en detectarCambiosEnRevisiones:", error);
    return {
      revisionesNuevas: actividadesActuales,
      revisionesEliminadas: [],
      cambiosEnTareas: [],
      cambiosDetectados: false,
      esPrimeraVez: false
    };
  }
}