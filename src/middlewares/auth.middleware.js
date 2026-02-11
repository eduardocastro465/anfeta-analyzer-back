import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";

export const authMiddleware = (req, res, next) => {
    try {
        const token = req.cookies?.token;

        if (!token) {
            return res.status(401).json({ message: "No token" });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;


        next();
    } catch (error) {
        // 🔥 TOKEN EXPIRADO O INVÁLIDO
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token expirado" });
        }

        return res.status(401).json({ message: "Token inválido" });
    }
}
