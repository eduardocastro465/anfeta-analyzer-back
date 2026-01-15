// import { OPTIONS } from '../constants/options.js';

// export async function selectOptionWithGemini(ai, message) {
//   const prompt = `
// Eres un selector de opciones para un asistente.
// Debes responder SOLO con UNA de estas opciones exactas:
// - ${OPTIONS.CONSULT_ACTIVITIES}
// - ${OPTIONS.CONSULT_REVIEWS}
// - ${OPTIONS.UPDATE_ACTIVITY}
// - ${OPTIONS.NONE}

// Reglas:
// - No expliques nada
// - No agregues texto adicional
// - Si el mensaje no es claro, responde: ${OPTIONS.NONE}

// Guía para elegir:
// - ${OPTIONS.CONSULT_ACTIVITIES}: cuando el usuario quiere ver o consultar su agenda,
//   actividades del día.
// - ${OPTIONS.CONSULT_REVIEWS}: cuando pregunta por revisiones o evaluaciones.
// - ${OPTIONS.UPDATE_ACTIVITY}: cuando quiere mover una actividad.

// Mensaje del usuario:
// "${message}"
// `.trim();

//   const response = await ai.models.generateContent({
//     model: 'gemini-3-flash-preview',
//     contents: prompt,
//   });

//   const option = response.text.trim();

//   return Object.values(OPTIONS).includes(option)
//     ? option
//     : OPTIONS.NONE;
// }
