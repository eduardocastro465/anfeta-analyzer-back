import https from "https";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
const MODEL_DIR = path.join(process.cwd(), "models");
const MODEL_ZIP = path.join(MODEL_DIR, "model.zip");

if (fs.existsSync(path.join(MODEL_DIR, "vosk-model-small-es-0.42"))) {
  console.log("[Model] Ya existe, saltando descarga.");
  process.exit(0);
}

fs.mkdirSync(MODEL_DIR, { recursive: true });
console.log("[Model] Descargando modelo...");

const file = fs.createWriteStream(MODEL_ZIP);
https.get(MODEL_URL, (res) => {
  res.pipe(file);
  file.on("finish", () => {
    file.close();
    console.log("[Model] Descomprimiendo...");
    execSync(`unzip -o ${MODEL_ZIP} -d ${MODEL_DIR}`);
    fs.unlinkSync(MODEL_ZIP);
    console.log("[Model] Listo.");
  });
});