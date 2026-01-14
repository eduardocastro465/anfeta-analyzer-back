import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../config.js";
import { getAllUsers } from "./users.controller.js";

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

const urlApi = "https://wlserver-production.up.railway.app/api";


export async function assistantController(req, res) {
  try {
    
    const { question, email} = req.body;

    if (!question  || !email) {
      return res.status(400).json({
        error: "La pregunta es obligatoria"
      });
    }

  const usersData = await getAllUsers();

    // Buscar usuario por email
    const user = usersData.items.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }


    // 3️⃣ Consultar actividades del día
   const response = await axios.get(
      `${urlApi}/actividades/assignee/${user.email}/del-dia`
    );


console.log("Actividades del día:",  response.data.data);

const actividadesDelDia = response.data.data; // 👈 array REAL

const resumen = actividadesDelDia.map(a => ({
  titulo: a.titulo,
  horaInicio: a.horaInicio,
  horaFin: a.horaFin,
  status: a.status
}));

const resumenReducido = resumen.map(a => ({
  h: `${a.horaInicio}-${a.horaFin}`,
  t: a.titulo.slice(0, 60),
  s: a.status
}));

    // 3️⃣ AQUÍ ENTRA GEMINI 🧠🔥
    const prompt = `
Eres un asistente de productividad.

Usuario: ${user.firstName} ${user.lastName}
Pregunta: "${question}"

Actividades del día:
${JSON.stringify(resumenReducido)}

Responde de forma clara y directa.
    `;

    const geminiResponse = await callGeminiWithRetry(() =>
  ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  })
  );

    // 4️⃣ Respuesta final
    res.json({
      answer: geminiResponse.text,
      // rawData: resumen // opcional, para debug
    });

  } catch (error) {
    console.error("Assistant error:", error.message);
    res.status(500).json({ error: "Error del asistente" });
  }


  async function callGeminiWithRetry(fn, retries = 3, delay = 2000) {
  try {
    return await fn();
  } catch (error) {
    const code = error?.error?.code || error?.status;

    if ((code === 503 || code === 429) && retries > 0) {
      console.warn(`Gemini saturado. Reintentando en ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return callGeminiWithRetry(fn, retries - 1, delay * 2);
    }

    throw error;
  }
}

}