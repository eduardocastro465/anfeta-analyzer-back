// src/services/voskRealtimeService.js
// ─────────────────────────────────────────────
// Registra los eventos de transcripción en tiempo real en un socket.
// Llama a registerVoskSocket(socket) dentro de io.on("connection", ...)
//
// Eventos que escucha:
//   "vosk-start"  → inicia reconocedor para este socket
//   "vosk-chunk"  → recibe ArrayBuffer con audio PCM16 mono 16kHz
//   "vosk-stop"   → libera el reconocedor
//
// Eventos que emite al cliente:
//   "vosk-parcial"  → { text: string } texto parcial en vivo
//   "vosk-error"    → { error: string }
// ─────────────────────────────────────────────

import path from "path";
import vosk from "vosk";

const MODEL_PATH = path.join(
  process.cwd(),
  "models",
  "vosk-model-small-es-0.42"
);
const SAMPLE_RATE = 16000;

// ── Singleton del modelo ───────────────────────────────────────────────────
let model = null;

function getModel() {
  if (!model) {
    vosk.setLogLevel(-1);
    model = new vosk.Model(MODEL_PATH);
    console.log("[Vosk] Modelo listo para transcripción en tiempo real.");
  }
  return model;
}

try {
  getModel();
} catch (err) {
  console.error("[Vosk] Error cargando modelo:", err.message);
}

// ── Sesiones activas: socketId → Recognizer ────────────────────────────────
const sessions = new Map();

// ── Registrar eventos Vosk en un socket ───────────────────────────────────
export function registerVoskSocket(socket) {
  // ── vosk-start ────────────────────────────────────────────────────────
  socket.on("vosk-start", () => {
    try {
      // Limpiar sesión previa si existe
      if (sessions.has(socket.id)) {
        try { sessions.get(socket.id).free(); } catch {}
        sessions.delete(socket.id);
      }

      const rec = new vosk.Recognizer({
        model: getModel(),
        sampleRate: SAMPLE_RATE,
      });

      sessions.set(socket.id, rec);
      console.log(`[Vosk] Sesión iniciada: ${socket.id}`);
    } catch (err) {
      console.error("[Vosk] Error iniciando sesión:", err.message);
      socket.emit("vosk-error", { error: "No se pudo iniciar el reconocedor" });
    }
  });

  // ── vosk-chunk ────────────────────────────────────────────────────────
  // Recibe un chunk de audio PCM16 como ArrayBuffer y emite texto parcial
  socket.on("vosk-chunk", (arrayBuffer) => {
    const rec = sessions.get(socket.id);
    if (!rec) return;

    try {
      const buffer = Buffer.from(arrayBuffer);

      // acceptWaveform devuelve true cuando hay un resultado final de frase
      const isFinal = rec.acceptWaveform(buffer);

      if (isFinal) {
        const result = rec.result();
        const text = result?.text ?? "";
        if (text) {
          socket.emit("vosk-parcial", { text, final: true });
        }
      } else {
        const partial = rec.partialResult();
        const text = partial?.partial ?? "";
        if (text) {
          socket.emit("vosk-parcial", { text, final: false });
        }
      }
    } catch (err) {
      console.error("[Vosk] Error procesando chunk:", err.message);
      socket.emit("vosk-error", { error: "Error procesando audio" });
    }
  });

  // ── vosk-stop ─────────────────────────────────────────────────────────
  socket.on("vosk-stop", () => {
    const rec = sessions.get(socket.id);
    if (!rec) return;

    try {
      rec.free();
    } catch {}

    sessions.delete(socket.id);
    console.log(`[Vosk] Sesión terminada: ${socket.id}`);
  });

  // ── Limpiar al desconectar ─────────────────────────────────────────────
  socket.on("disconnect", () => {
    const rec = sessions.get(socket.id);
    if (rec) {
      try { rec.free(); } catch {}
      sessions.delete(socket.id);
    }
  });
}