import ActividadesSchema from "../models/actividades.model.js";

/**
 * Sincroniza las explicaciones de compañeros hacia el documento del usuario actual.
 * Se debe llamar después de crear o cargar el documento del usuario,
 * para que herede explicaciones que sus compañeros ya guardaron.
 *
 * @param {string} odooUserId - ID del usuario que recibirá las explicaciones
 * @param {string[]} actividadIds - IDs de las actividades a sincronizar
 */
export async function sincronizarExplicacionesCompaneros(odooUserId, actividadIds) {
  if (!odooUserId || !actividadIds?.length) return;

  try {
    const docsCompaneros = await ActividadesSchema.find({
      odooUserId: { $ne: odooUserId },
      "actividades.actividadId": { $in: actividadIds }
    }).lean();

    if (!docsCompaneros.length) return;

    for (const docCompanero of docsCompaneros) {
      for (const actividad of docCompanero.actividades) {
        if (!actividadIds.includes(actividad.actividadId)) continue;

        for (const pendiente of actividad.pendientes) {
          if (!pendiente.explicacionVoz && !pendiente.descripcion) continue;

          await ActividadesSchema.findOneAndUpdate(
            {
              odooUserId,
              "actividades.actividadId": actividad.actividadId,
              "actividades.pendientes.pendienteId": pendiente.pendienteId,
              "actividades.pendientes.explicacionVoz": null,
              "actividades.pendientes.descripcion": ""
            },
            {
              $set: {
                "actividades.$[act].pendientes.$[pend].descripcion": pendiente.descripcion || "",
                "actividades.$[act].pendientes.$[pend].explicacionVoz": pendiente.explicacionVoz || null,
                "actividades.$[act].pendientes.$[pend].resumen": pendiente.resumen || pendiente.explicacionVoz?.resumen || null,
                "actividades.$[act].pendientes.$[pend].revisadoPorVoz": true,
                "actividades.$[act].pendientes.$[pend].actualizadoPor": pendiente.actualizadoPor || docCompanero.emailUsuario,
                "actividades.$[act].pendientes.$[pend].ultimaActualizacion": new Date()
              }
            },
            {
              arrayFilters: [
                { "act.actividadId": actividad.actividadId },
                { "pend.pendienteId": pendiente.pendienteId }
              ]
            }
          );
        }
      }
    }
  } catch (error) {
    console.error("Error en sincronizarExplicacionesCompaneros:", error.message);
  }
}