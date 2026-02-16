import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY, GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3 } from "../config.js";
import { callGeminiWithRetry } from "./geminiRetry.js";

/* ===============================
   CONFIGURACIÓN
================================ */

const genAI = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
});

const clavesValidas = [GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3]
    .filter(key => key && key.trim() !== "");

const poolGroq = clavesValidas.map(key => new Groq({ apiKey: key }));
let indiceActual = 0;

/* ===============================
   GROQ (PRIMARY)
================================ */

async function llamarGroq(prompt) {
    const instancia = poolGroq[indiceActual];
    indiceActual = (indiceActual + 1) % poolGroq.length;

    const completion = await instancia.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
    });

    const text = completion?.choices?.[0]?.message?.content;

    if (!text) {
        throw new Error("EMPTY_GROQ_RESPONSE");
    }

    return {
        text,
        provider: "Groq",
    };
}

/* ===============================
   GEMINI (FAILOVER TOTAL)
================================ */

async function llamarGemini(prompt) {
    return callGeminiWithRetry(async () => {
        const response = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }],
                },
            ],
        });

        const text =
            response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (!text) {
            throw new Error("EMPTY_GEMINI_RESPONSE");
        }

        return {
            text,
            provider: "Gemini",
        };
    }, 1);
}

/* ===============================
   SMART CALL (LA CLAVE)
================================ */

export async function smartAICall(prompt) {
  try {
    if (poolGroq.length === 0) {
      throw new Error("NO_GROQ_KEYS");
    }

    return await llamarGroq(prompt);

  } catch (groqError) {
    console.warn(" Groq falló, usando Gemini:", groqError.message);

    try {
      return await llamarGemini(prompt);
    } catch (geminiError) {
      const err = new Error("AI_PROVIDER_FAILED");
      err.cause = {
        groq: groqError?.message || groqError,
        gemini: geminiError?.message || geminiError
      };
      throw err;
    }
  }
}


/* ===============================
   UTIL
================================ */

export function parseAIJSONSafe(text) {
    if (!text) return null;

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}