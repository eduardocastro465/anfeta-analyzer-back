
import Groq from "groq-sdk";
import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GROQ_API_KEY_1, GROQ_API_KEY_2 } from '../config.js';
import { isGeminiQuotaError } from './geminiRetry.js';
import { callGeminiWithRetry } from './geminiRetry.js';

// Configuración de Instancias
const genAI = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
});

const clavesValidas = [GROQ_API_KEY_1, GROQ_API_KEY_2].filter(key => key && key.trim() !== "");

// Crear el pool solo con las que sí existen
const poolGroq = clavesValidas.map(key => new Groq({ apiKey: key }));
let indiceActual = 0;


/**
 * Intenta obtener respuesta de las cuentas de Groq de forma rotativa
 */
async function llamarGroqConRespaldo(prompt) {
    for (let i = 0; i < poolGroq.length; i++) {
        const instancia = poolGroq[indiceActual];
        const numCuenta = indiceActual + 1;
        indiceActual = (indiceActual + 1) % poolGroq.length;

        try {
            const completion = await instancia.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: "llama-3.1-8b-instant",
            });
            return {
                text: completion.choices[0].message.content,
                provider: `Groq (Cuenta ${numCuenta})`
            };
        } catch (error) {
            // Si es error de cuota (429) y tenemos más cuentas, continuamos
            if (error.status === 429 && i < poolGroq.length - 1) {
                console.warn(`⚠️ Groq Cuenta ${numCuenta} saturada, rotando...`);
                continue;
            }
            throw error;
        }
    }
}

/**
 * Función principal de llamada inteligente (Gemini -> Groq Pool)
 */
export async function smartAICall(prompt, retries = 1) {
    try {

        // const geminiResponse = await callGeminiWithRetry(() =>
        const geminiResponse = await callGeminiWithRetry(() => genAI.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
        }));
        return { text: geminiResponse.text, provider: 'Gemini' };

    } catch (error) {
        console.error(`❌ Error en Gemini: ${error.message || error}`);
        const isQuota = isGeminiQuotaError(error);

        if (isQuota || retries <= 0) {
            console.warn("⚠️ Gemini agotado. Entrando al pool de Groq...");
            try {
                return await llamarGroqConRespaldo(prompt);
            } catch (finalError) {
                console.error("🚨 CRÍTICO: Todos los proveedores de IA fallaron (numero de peticiones gratuitas por minutos rebasadas), por favor espere un minuto");
                throw new Error("AI_PROVIDER_FAILED");
            }
        }

        console.warn(`Reintentando Gemini... (${retries} restantes)`);
        await new Promise(r => setTimeout(r, 2000));
        return smartAICall(prompt, retries - 1);
    }
}