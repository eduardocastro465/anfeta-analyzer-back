//Configuración del servidor
export const PORT = process.env.PORT || 4000;
export const API_VERSION = process.env.API_VERSION || "v1";

export const CORS_ORIGINS = process.env.CORS_ORIGINS ||  "http://localhost:4200";

//Conexion a la base de datos
export const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://usuario:"

//Credenciales de la API de Google Gemini
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

