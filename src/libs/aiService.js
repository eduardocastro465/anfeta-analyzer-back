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

console.log("[AI Service] Claves Groq disponibles:", poolGroq.length > 0 ? `${poolGroq.length} clave(s) activa(s)` : "NINGUNA - se usara Gemini como fallover");
console.log("[AI Service] Proveedor principal:", poolGroq.length > 0 ? "Groq" : "Gemini");

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

        const resultado = await llamarGroq(prompt);
        console.log(`[AI] Respondio: Groq (indice ${(indiceActual === 0 ? poolGroq.length : indiceActual) - 1})`);
        return resultado;

    } catch (groqError) {
        console.warn("[AI] Groq fallo:", groqError.message, "-> usando Gemini como fallover");

        try {
            const resultado = await llamarGemini(prompt);
            console.log("[AI] Respondio: Gemini (fallover)");
            return resultado;
        } catch (geminiError) {
            console.error("[AI] Ambos proveedores fallaron.", { groq: groqError.message, gemini: geminiError.message });
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
        console.warn("parseAIJSONSafe fallido:", err.message);
        return null;
    }
}
export function parseRespuestaConversacional(text) {
    if (!text) return null;

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

    const candidates = [
        cleaned,
        cleaned.match(/\{[\s\S]*\}/)?.[0],
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);

            if (
                parsed &&
                typeof parsed === "object" &&
                typeof parsed.deteccion === "string" &&
                typeof parsed.razon === "string" &&
                typeof parsed.respuesta === "string"
            ) {
                return parsed;
            }

        } catch (err) {
            console.warn("Parse conversacional fallido:", err.message);
        }
    }

    return null;
}