import { smartAICall } from "../libs/aiService.js";


export async function corregirTranscripcionMañana(texto, nombreTarea = "", descripcionTarea = "") {
  if (!texto || texto.trim().length < 10) return texto;

  const prompt = `Eres un corrector literal de transcripciones de voz a texto en español mexicano en contexto laboral de software.

Tu objetivo es: Corregir errores de reconocimiento de voz sin alterar el significado original.

━━━ CONTEXTO DE LA TAREA (SOLO REFERENCIA LÉXICA) ━━━
Nombre: "${nombreTarea}"
Descripción: "${descripcionTarea || 'Sin descripción'}"

El contexto SOLO puede usarse para corregir términos técnicos mal reconocidos o desambiguar palabras fonéticamente similares.
NO puede usarse para agregar acciones, completar tareas implícitas, inventar resultados ni anticipar avances futuros.

━━━ TEXTO A CORREGIR (PLAN DE HOY — VOZ A TEXTO) ━━━
"${texto}"

━━━ REGLAS ESTRICTAS ━━━
1. El texto es un plan de lo que el usuario VA A HACER hoy — mantén el tiempo futuro o presente intencional
2. No agregues pasos, subtareas ni acciones que el usuario no mencionó
3. No cambies expresiones de intención ("voy a", "planeo", "tengo que") por afirmaciones de hecho
4. Solo corrige: errores fonéticos obvios, muletillas y repeticiones
5. Si algo es ambiguo, consérvalo ambiguo
6. Máximo 3 oraciones
7. Si la corrección cambia el significado, devuelve el texto original
8. NUNCA completes palabras parciales ni inventes términos que no están en el original
9. Si una palabra es incomprensible, cópiala tal cual

CRÍTICO: Responde ÚNICAMENTE con el texto corregido.
- Sin comillas al inicio o al final
- Sin paréntesis explicativos
- Sin notas ni comentarios
- Sin markdown

CRÍTICO: NUNCA alteres expresiones de incertidumbre, duda o limitación en el plan.
Ejemplos que NO debes cambiar:
→ "no sé si voy a poder terminarlo" → NO cambiar
→ "depende de si llega la respuesta" → NO cambiar
→ "tal vez lo reviso si me da tiempo" → NO cambiar
→ "voy a intentar avanzar" → NO cambiar

PRIORIDAD MÁXIMA: Ante la duda, copia la frase original sin modificar.`;

  try {
    const result = await smartAICall(prompt);
    let corregido = result.text
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .trim();

    if (!corregido) return texto;
    if (corregido.length < texto.length * 0.2) return texto;
    if (corregido.length > texto.length * 1.5) return texto;

    console.log("🔧 Transcripción mañana corregida:", {
      original: texto,
      corregido,
      reduccion: `${Math.round((1 - corregido.length / texto.length) * 100)}%`,
    });

    return corregido;
  } catch (err) {
    console.warn("⚠️ Error en corregirTranscripcionMañana, usando original:", err.message);
    return texto;
  }
}

export async function corregirTranscripcionTarde(texto, nombreTarea = "", descripcionTarea = "") {
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
5. Solo corrige errores fonéticos obvios (palabras mal reconocidas que suenan igual), elimina muletillas.
6. Si algo es ambiguo, consérvalo ambiguo
7. No reduzcas ni comprimas el texto. 
8. Si la corrección cambia el significado, devuelve el texto original
9. NUNCA completes palabras parciales ni inventes términos que   no están en el original.
10. Si una palabra es incomprensible, cópiala tal cual.
11. NUNCA comprimas, resumas ni reduzcas el texto más de un 15%. Si el resultado tiene menos del 85% de las palabras del original, devuelve el texto original sin modificar.

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

ANTI-COMPRESIÓN: La transcripción puede sonar repetitiva o informal — eso es intencional y refleja cómo habló el usuario. 
Tu trabajo NO es mejorar el estilo ni hacer el texto más conciso.
Una reducción mayor al 15% de palabras es señal de que estás alterando el texto — en ese caso, devuelve el original.

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

export async function corregirTranscripcionProyecto(texto, actividadesResumidas = []) {
  if (!texto || texto.trim().length < 10) return texto;

  const contextoActividades = actividadesResumidas.length > 0
    ? `Actividades del usuario (SOLO para desambiguar términos técnicos):
${actividadesResumidas.map(a => `- ${a.actividad} (${a.estado})`).join("\n")}`
    : "Sin actividades registradas.";

  const prompt = `Eres un corrector literal de transcripciones de voz a texto en español mexicano en contexto laboral de software.

Tu objetivo es: Corregir errores de reconocimiento de voz sin alterar el significado original.

━━━ CONTEXTO DE PROYECTOS (SOLO REFERENCIA LÉXICA) ━━━
${contextoActividades}

El contexto SOLO puede usarse para corregir nombres de proyectos/actividades mal reconocidos fonéticamente.
NO puede usarse para agregar acciones, inferir estados ni inventar avances.

━━━ TEXTO A CORREGIR (MENSAJE SOBRE PROYECTO — VOZ A TEXTO) ━━━
"${texto}"

━━━ REGLAS ESTRICTAS ━━━
1. Mantén exactamente el mismo tiempo verbal que usó el usuario
2. No agregues información que el usuario no mencionó
3. No cambies el nivel de avance ni el estado de ninguna actividad
4. Solo corrige: errores fonéticos obvios, muletillas y repeticiones
5. Si algo es ambiguo, consérvalo ambiguo
6. Máximo 3 oraciones
7. Si la corrección cambia el significado, devuelve el texto original
8. NUNCA completes palabras parciales ni inventes términos que no están en el original
9. Si una palabra es incomprensible, cópiala tal cual

CRÍTICO: Responde ÚNICAMENTE con el texto corregido.
- Sin comillas al inicio o al final
- Sin paréntesis explicativos
- Sin notas ni comentarios
- Sin markdown

PRIORIDAD MÁXIMA: Ante la duda, copia la frase original sin modificar.`;

  try {
    const result = await smartAICall(prompt);
    let corregido = result.text
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .trim();

    if (!corregido) return texto;
    if (corregido.length < texto.length * 0.2) return texto;
    if (corregido.length > texto.length * 1.5) return texto;

    console.log("🔧 Transcripción proyecto corregida:", {
      original: texto,
      corregido,
      reduccion: `${Math.round((1 - corregido.length / texto.length) * 100)}%`,
    });

    return corregido;
  } catch (err) {
    console.warn("⚠️ Error en corregirTranscripcionProyecto, usando original:", err.message);
    return texto;
  }
}

export async function corregirTranscripcionGeneral(texto) {
  if (!texto || texto.trim().length < 10) return texto;

  const prompt = `Eres un corrector literal de transcripciones de voz a texto en español mexicano en contexto conversacional general.

Tu objetivo es: Corregir errores de reconocimiento de voz sin alterar el significado original.

━━━ TEXTO A CORREGIR (MENSAJE GENERAL — VOZ A TEXTO) ━━━
"${texto}"

━━━ REGLAS ESTRICTAS ━━━
1. Mantén exactamente el mismo tiempo verbal y tono que usó el usuario
2. No agregues información que el usuario no mencionó
3. No cambies preguntas por afirmaciones ni viceversa
4. Solo corrige: errores fonéticos obvios, muletillas y repeticiones
5. Si algo es ambiguo, consérvalo ambiguo
6. Máximo 3 oraciones
7. Si la corrección cambia el significado, devuelve el texto original
8. NUNCA completes palabras parciales ni inventes términos que no están en el original
9. Si una palabra es incomprensible, cópiala tal cual

CRÍTICO: Responde ÚNICAMENTE con el texto corregido.
- Sin comillas al inicio o al final
- Sin paréntesis explicativos
- Sin notas ni comentarios
- Sin markdown

PRIORIDAD MÁXIMA: Ante la duda, copia la frase original sin modificar.`;

  try {
    const result = await smartAICall(prompt);
    let corregido = result.text
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .trim();

    if (!corregido) return texto;
    if (corregido.length < texto.length * 0.2) return texto;
    if (corregido.length > texto.length * 1.5) return texto;

    console.log("🔧 Transcripción general corregida:", {
      original: texto,
      corregido,
      reduccion: `${Math.round((1 - corregido.length / texto.length) * 100)}%`,
    });

    return corregido;
  } catch (err) {
    console.warn("⚠️ Error en corregirTranscripcionGeneral, usando original:", err.message);
    return texto;
  }
}