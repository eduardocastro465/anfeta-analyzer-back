import axios from "axios";
import jwt from "jsonwebtoken";
import { API_URL_ANFETA, TOKEN_SECRET } from "../config.js";
import { sanitizeObject } from "../libs/sanitize.js";
import ActividadesSchema from "../models/actividades.model.js";

export const getAllUsers = async () => {
  try {
    const response = await axios.get(`${API_URL_ANFETA}/users/search`);

    const usersClean = response.data.items.map(user => ({
      id: user.collaboratorId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    }));

    return {
      items: usersClean
    };

  } catch (error) {
    console.error("Error obteniendo usuarios:", error.message);
    throw error;
  }
};


export async function guardarPreferenciasUsuario(req, res) {
  try {
    const { token } = req.cookies;
    if (!token) return res.status(401).json({ success: false, message: "No autorizado" });

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const odooUserId = decoded.id;

    const { tema, velocidadVoz, idiomaVoz } = sanitizeObject(req.body);

    const update = {};
    if (tema !== undefined) update["preferencias.tema"] = tema;
    if (velocidadVoz !== undefined) update["preferencias.velocidadVoz"] = velocidadVoz;
    if (idiomaVoz !== undefined) update["preferencias.idiomaVoz"] = idiomaVoz;

    await ActividadesSchema.findOneAndUpdate(
      { odooUserId },
      { $set: update },
      { upsert: true }
    );

    return res.json({ success: true, message: "Preferencias guardadas" });
  } catch (error) {
    console.error("Error guardando preferencias:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function obtenerPreferenciasUsuario(req, res) {
  try {
    const { token } = req.cookies;
    if (!token) return res.status(401).json({ success: false, message: "No autorizado" });

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const doc = await ActividadesSchema.findOne({ odooUserId: decoded.id })
      .select("preferencias")
      .lean();

    return res.json({
      success: true,
      preferencias: doc?.preferencias || {
        tema: "AUTO",
        velocidadVoz: 1,
        idiomaVoz: "es-MX"
      }
    });
  } catch (error) {
    console.error("Error obteniendo preferencias:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}