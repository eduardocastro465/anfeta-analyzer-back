import HistorialBot from "../models/historialBot.model.js";

export async function generarSessionIdDiario(idUser) {
  const base = generarSessionBase(idUser);

  const ultima = await HistorialBot.findOne({
    sessionId: { $regex: `^${base}` }
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!ultima) return base;

  const partes = ultima.sessionId.split("_");
  const ultimo = Number(partes[partes.length - 1]);

  return isNaN(ultimo) ? `${base}_2` : `${base}_${ultimo + 1}`;
}

function obtenerFechaMX() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Mexico_City"
  });
}

export function generarSessionBase(idUser) {
  const fecha = obtenerFechaMX(); // YYYY-MM-DD
  return `Act_${idUser}_${fecha.replace(/-/g, "_")}`;
}

export async function obtenerSesionActivaDelDia(idUser) {
  const base = generarSessionBase(idUser);

  // 1. Buscar sesión existente del día
  const existente = await HistorialBot.findOne({
    userId: idUser,
    sessionId: { $regex: `^${base}` }
  }).select("sessionId").lean();


  if (existente) return existente.sessionId;

  const nueva = await HistorialBot.findOneAndUpdate(
    { userId: idUser, sessionId: base },
    { $setOnInsert: { userId: idUser, sessionId: base, /* ... */ } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return nueva.sessionId;
}
export async function generarNuevaSesionDelDia(idUser) {
  const base = generarSessionBase(idUser);

  const ultima = await HistorialBot.findOne({
    sessionId: { $regex: `^${base}` }
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!ultima) return base;

  const partes = ultima.sessionId.split("_");
  const ultimo = Number(partes[partes.length - 1]);

  return isNaN(ultimo) ? `${base}_2` : `${base}_${ultimo + 1}`;
}
