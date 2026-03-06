import crypto from 'crypto';

/**
 * Genera un hash único de las actividades
 * Si cambian las actividades, cambia el hash
 */
export function generarHashActividades(actividadesFinales, revisionesPorActividad) {
  const datos = actividadesFinales.map(a => {
    const revision = revisionesPorActividad[a.id];

    const conTiempo = (revision?.pendientesConTiempo || [])
      .map(t => `${t.id}:${t.nombre}:${t.duracionMin}:${(t.colaboradoresEmails || []).filter(Boolean).sort().join('|')}`);

    const sinTiempo = (revision?.pendientesSinTiempo || [])
      .map(t => `${t.id}:${t.nombre}:sin-tiempo:${(t.colaboradoresEmails || []).filter(Boolean).sort().join('|')}`);

    return {
      id: a.id,
      titulo: revision?.titulo || a.titulo,
      horario: `${revision?.horaInicio || a.horaInicio}-${revision?.horaFin || a.horaFin}`,
      tareas: [...conTiempo, ...sinTiempo].sort().join(',')
    };
  });

  return crypto.createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}