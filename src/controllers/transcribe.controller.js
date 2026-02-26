// src/controllers/transcribe.controller.js
import path from "path";
import vosk from "vosk";

const MODEL_PATH = path.join(process.cwd(), "models", "vosk-model-small-es-0.42");
const SAMPLE_RATE = 16000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Singleton del modelo (se carga una sola vez al arrancar) ───────────────
let model = null;

function getModel() {
  if (!model) {
    vosk.setLogLevel(-1);
    model = new vosk.Model(MODEL_PATH);
    console.log("[Vosk] Modelo cargado correctamente.");
  }
  return model;
}

// Precarga al importar el controlador
try {
  getModel();
} catch (err) {
  console.error("[Vosk] Error cargando modelo:", err.message);
  console.error("  → Asegúrate de tener el modelo descomprimido en:", MODEL_PATH);
}

// ── POST /api/vX/transcribe/transcribe ────────────────────────────────────
// Body: audio raw PCM16 mono 16kHz (application/octet-stream)
export const transcribeAudio = (req, res) => {
  if (!req.is("application/octet-stream")) {
    return res.status(415).json({
      ok: false,
      error: "Content-Type debe ser application/octet-stream",
    });
  }

  const chunks = [];
  let totalBytes = 0;

  req.on("data", (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_AUDIO_BYTES) {
      req.destroy(new Error("Audio demasiado grande"));
      return;
    }
    chunks.push(chunk);
  });

  req.on("error", (err) => {
    console.error("[Vosk] Error recibiendo audio:", err.message);
    if (!res.headersSent) {
      return res.status(400).json({
        ok: false,
        error: "Error recibiendo audio: " + err.message,
      });
    }
  });

  req.on("end", () => {
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      return res.status(400).json({ ok: false, error: "Audio vacío" });
    }

    try {
      const rec = new vosk.Recognizer({
        model: getModel(),
        sampleRate: SAMPLE_RATE,
      });

      rec.acceptWaveform(audioBuffer);
      const result = rec.finalResult();
      rec.free();

      const text = result?.text ?? "";
      console.log("[Vosk] Transcripción:", text || "(vacío)");

      return res.json({ ok: true, text });
    } catch (err) {
      console.error("[Vosk] Error procesando audio:", err.message);
      return res.status(500).json({
        ok: false,
        error: "Error procesando audio",
        detail: err.message,
      });
    }
  });
};
