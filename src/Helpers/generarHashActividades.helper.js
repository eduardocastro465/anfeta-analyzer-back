import crypto from 'crypto';

/**
 * Genera un hash único de las actividades
 * Si cambian las actividades, cambia el hash
 */
export function generarHashActividades(actividadesFinales, revisionesPorActividad) {
  const datos = actividadesFinales.map(a => {
    const conTiempo = (revisionesPorActividad[a.id]?.pendientesConTiempo || [])
      .map(t => `${t.id}:${t.duracionMin}`);

    const sinTiempo = (revisionesPorActividad[a.id]?.pendientesSinTiempo || [])
      .map(t => `${t.id}:sin-tiempo`);

    return {
      id: a.id,
      titulo: a.titulo,
      horario: `${a.horaInicio}-${a.horaFin}`,
      tareas: [...conTiempo, ...sinTiempo].sort().join(',')
    };
  });

  return crypto.createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}