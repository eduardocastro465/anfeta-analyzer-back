import crypto from 'crypto';

/**
 * Genera un hash único de las actividades
 * Si cambian las actividades, cambia el hash
 */
export function generarHashActividades(actividadesFinales, revisionesPorActividad) {
  const datos = actividadesFinales.map(a => ({
    id: a.id,
    titulo: a.titulo,
    horario: `${a.horaInicio}-${a.horaFin}`,
    tareas: (revisionesPorActividad[a.id]?.pendientesConTiempo || [])
      .map(t => t.id)
      .sort()
      .join(',')
  }));

  return crypto.createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}

