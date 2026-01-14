import { createLogger, format, transports } from "winston";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para formatear el log de la petición HTTP
const httpLogFormat = format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    return JSON.stringify({
        timestamp,
        level,
        message,
        ...meta,
    });
});

export const logger = createLogger({
    format: format.combine(
        format.timestamp(), // Obtener el tiempo
        httpLogFormat
    ),

    transports: [
        new transports.File({
            maxsize: 5120000,
            maxFiles: 100,
            filename: `${__dirname}/../logs/log-api.log`, // ruta de donde se guardaran los errores (el archivo log)
        }),
    ],
});

// Registrar la petición HTTP
export const logHttpRequest = (req, res, responseTime) => {
    const { method, originalUrl, query, body, ip, headers } = req;
    const { statusCode } = res;

    logger.info("HTTP Request", {
        timestamp: new Date().toISOString(),
        method,
        endpoint: originalUrl,
        queryParams: query,
        userId: req.user ? req.user.id : null,
        ip,
        userAgent: headers["user-agent"],
        requestBody: body,
        responseStatus: statusCode,
        responseTime: `${responseTime}ms`,

    });
};