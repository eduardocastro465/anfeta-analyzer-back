import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from '../config.js';
import { getAllUsers } from './users.controller.js';
import { callGeminiWithRetry } from '../libs/geminiRetry.js'
import { sanitizeObject } from '../libs/sanitize.js'


const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

const urlApi = 'https://wlserver-production.up.railway.app/api';

export async function devuelveActividades(req, res) {
  try {
    const { question, email } = sanitizeObject(req.body);

    const usersData = await getAllUsers();

    // Buscar usuario por email
    const user = usersData.items.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Consultar actividades del día
    const response = await axios.get(`${urlApi}/actividades/assignee/${user.email}/del-dia`);

    const { data } = response.data.data;

    const actividades = (data?.data || []).map((a) => ({
      h: `${a.horaInicio}-${a.horaFin}`,
      t: a.titulo.slice(0, 60),
      s: a.status,
    }));

    // Preparamos el prompt para Gemini
    const prompt = `Eres un asistente de productividad.
      Usuario: ${user.firstName} ${user.lastName}
      Pregunta: "${question}"
      Agenda de hoy:${JSON.stringify(actividades)}
      Responde de forma clara y directa.`.trim();

    // Enviamos el prompt a Gemini con reintentos
    const geminiResponse = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      })
    );

    // Respuesta final
    res.json({
      answer: geminiResponse.text,
    });
  } catch (error) {
    console.error('Assistant error:', error.message);
    res.status(500).json({ error: 'Error del asistente' });
  }
}

export async function devuelveActReviciones(req, res) {
  try {
    const { colaborador } = sanitizeObject(req.body);

    console.log("Received parameters:", { colaborador });

    // Obtenemos la fecha de hoy
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const formattedToday = `${yyyy}-${mm}-${dd}`;

    const response = await axios.get(
      `${urlApi}/reportes/revisiones-por-fecha?date=${formattedToday}&colaborador=${colaborador}`,
    );

    //https://wlserver-production.up.railway.app/api/reportes/revisiones-por-fecha?date=2026-01-15&colaborador=eedua@practicante.com

    if (!response.data.success) {
      console.error("API responded with an error:", response.data.message);
      return res.status(500).json({
        success: false,
        message: "Error al obtener revisiones",
        error: response.data.message
      });
    }

    return res.status(200).json({
      success: true,
      filtros: {
        date: formattedToday,
        colaborador: colaborador
      },
      data: response.data
    });

  } catch (error) {
    console.error("Error fetching revisiones:", error);

    return res.status(500).json({
      success: false,
      message: "Error al obtener revisiones",
      error: error.message
    });
  }
}
