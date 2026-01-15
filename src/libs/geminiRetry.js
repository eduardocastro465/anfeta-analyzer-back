export async function callGeminiWithRetry(fn, retries = 3, delay = 2000) {
  try {
    return await fn();
  } catch (error) {
    const code = error?.error?.code || error?.status;

    if ((code === 503 || code === 429) && retries > 0) {
      console.warn(`Gemini saturado. Reintentando en ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      return callGeminiWithRetry(fn, retries - 1, delay * 2);
    }

    throw error;
  }
}
