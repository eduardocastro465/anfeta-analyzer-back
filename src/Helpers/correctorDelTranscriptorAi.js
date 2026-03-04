import { smartAICall } from "../libs/aiService.js";

export async function corregirTranscripcion(texto, nombreTarea = "", descripcionTarea = "") {
  if (!texto || texto.trim().length < 10) return texto;

  const prompt = `Eres un corrector literal de transcripciones de voz a texto en español mexicano en contexto laboral de software.

Tu objetivo es: Corregir errores de reconocimiento de voz sin alterar el significado original.

━━━ CONTEXTO DE LA TAREA (SOLO REFERENCIA LÉXICA) ━━━
Nombre: "${nombreTarea}"
Descripción: "${descripcionTarea || 'Sin descripción'}"

El contexto SOLO puede usarse para corregir términos técnicos mal reconocidos o desambiguar palabras fonéticamente similares.

NO puede usarse para agregar acciones, completar tareas implícitas, inventar resultados o mejorar artificialmente el nivel técnico.

━━━ TEXTO A CORREGIR ━━━
"${texto}"

━━━ REGLAS ESTRICTAS ━━━
1. Mantén exactamente la misma intención del usuario
2. No agregues información no dicha explícitamente
3. No cambies el nivel de avance
4. No agregues verbos de finalización no dichos
5. Solo corrige: errores fonéticos obvios, muletillas y repeticiones
6. Si algo es ambiguo, consérvalo ambiguo
7. Máximo 3 oraciones
8. Si la corrección cambia el significado, devuelve el texto original
9. NUNCA completes palabras parciales ni inventes términos que no están en el original.
10. Si una palabra es incomprensible, cópiala tal cual.

CRÍTICO: Responde ÚNICAMENTE con el texto corregido.
- Si el usuario usó pasado ("hice", "modifiqué", "fui modificando"), mantenlo en pasado.
- Si usó presente ("estoy haciendo"), mantenlo en presente.
- Los tiempos verbales son la señal más importante para determinar si la tarea fue completada.
- Sin comillas al inicio o al final
- Sin paréntesis explicativos
- Sin notas ni comentarios
- Sin markdown

CRÍTICO: NUNCA alteres el sentido de frases que expresen resultado, estado o capacidad.

Esto incluye cualquier combinación de:
- Negaciones: "no", "nunca", "jamás", "tampoco", "ni"
- Verbos de capacidad: "pude", "pudo", "podía", "logré", "alcancé", "conseguí"
- Verbos de finalización: "terminé", "completé", "acabé", "entregué"
- Verbos de bloqueo: "faltó", "quedó", "pendiente", "faltó"

Ejemplos de frases que NUNCA debes alterar:
→ "no lo pude terminar" → NO cambiar
→ "no alcancé a completarlo" → NO cambiar  
→ "no logré terminarlo" → NO cambiar
→ "quedó pendiente" → NO cambiar
→ "no tuve tiempo" → NO cambiar
→ "sí lo terminé" → NO cambiar
→ "ya quedó listo" → NO cambiar

REGLA GENERAL: Si una frase contiene cualquier combinación de negación + verbo de acción,
o cualquier expresión que indique si algo SE HIZO o NO SE HIZO,
cópiala exactamente como está aunque tenga errores ortográficos.

PRIORIDAD MÁXIMA: Ante la duda, copia la frase original sin modificar.
Es preferible conservar un error de transcripción que alterar el significado.
`;

  try {
    const result = await smartAICall(prompt);
    let corregido = result.text
      .trim()
      .replace(/^["']|["']$/g, '')  // quitar comillas
      .split('\n')[0]               // solo primera línea, ignora comentarios
      .trim();

    if (!corregido) return texto;
    if (corregido.length < texto.length * 0.2) return texto;
    if (corregido.length > texto.length * 1.5) return texto; // ← bajé de 2x a 1.5x

    console.log('🔧 Transcripción corregida:', {
      original: texto,
      corregido,
      reduccion: `${Math.round((1 - corregido.length / texto.length) * 100)}%`
    });

    return corregido;
  } catch (err) {
    console.warn('⚠️ Error en corregirTranscripcion, usando original:', err.message);
    return texto;
  }
}