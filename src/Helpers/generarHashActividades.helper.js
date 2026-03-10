import crypto from 'crypto';

/**
 * Genera un hash único de las actividades
 * Si cambian las actividades, cambia el hash
 */
export function generarHashActividades(actividadesFinales, revisionesPorActividad) {
  const datos = actividadesFinales.map(a => {
    const revision = revisionesPorActividad[a.id];
    const meta = revision?.actividad || revision;

    // 🧪 DEBUG
    console.log(`📦 actividad ${a.id} → meta.titulo: ${meta?.titulo} | meta.horaInicio: ${meta?.horaInicio}`);

    const conTiempo = (revision?.pendientesConTiempo || [])
      .map(t => `${t.id}:${t.nombre}:${t.duracionMin}:${(t.colaboradoresEmails || []).filter(Boolean).sort().join('|')}`);

    const sinTiempo = (revision?.pendientesSinTiempo || [])
      .map(t => `${t.id}:${t.nombre}:sin-tiempo:${(t.colaboradoresEmails || []).filter(Boolean).sort().join('|')}`);

    return {
      id: a.id,
      titulo: meta?.titulo || a.titulo,
      horario: `${meta?.horaInicio || a.horaInicio}-${meta?.horaFin || a.horaFin}`,
      tareas: [...conTiempo, ...sinTiempo].sort().join(',')
    };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // 🧪 DEBUG
  console.log("📊 datos para hash:", JSON.stringify(datos));

  return crypto.createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}