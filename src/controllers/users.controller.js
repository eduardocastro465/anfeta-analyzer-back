import axios from "axios";
import jwt from "jsonwebtoken";
import { API_URL_ANFETA, TOKEN_SECRET } from "../config.js";
import { sanitizeObject } from "../libs/sanitize.js";
import User from "../models/user.model.js";

export const getAllUsers = async () => {
  try {
    const response = await axios.get(`${API_URL_ANFETA}/users/search`);

    const usersClean = response.data.items.map(user => ({
      id: user.collaboratorId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    }));

    await User.bulkWrite(
      usersClean.map(user => ({
        updateOne: {
          filter: { odooUserId: user.id },
          update: {
            $set: {
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName
            }
          },
          upsert: true
        }
      }))
    );


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

    const { tema, velocidadVoz, idiomaVoz, modoAsistenteIA } = sanitizeObject(req.body);

    const update = {};
    if (tema !== undefined) update["preferencias.tema"] = tema;
    if (velocidadVoz !== undefined) update["preferencias.velocidadVoz"] = velocidadVoz;
    if (idiomaVoz !== undefined) update["preferencias.idiomaVoz"] = idiomaVoz;
    if (modoAsistenteIA !== undefined) update["preferencias.modoAsistenteIA"] = modoAsistenteIA;

    await User.updateOne(
      { odooUserId: decoded.id },
      { $set: update }
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

    const user = await User.findOne({ odooUserId: decoded.id })
      .select("preferencias")
      .lean();

    return res.json({
      success: true,
      preferencias: user?.preferencias || {
        tema: "AUTO",
        velocidadVoz: 1,
        idiomaVoz: "es-MX",
        modoAsistenteIA: "proyecto"
      }
    });
  } catch (error) {
    console.error("Error obteniendo preferencias:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}
export async function guardarKeysUsuario(req, res) {
  try {
    const { token } = req.cookies;
    if (!token) return res.status(401).json({ success: false, message: "No autorizado" });

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const { groq, gemini } = sanitizeObject(req.body);

    const update = {};

    if (groq !== undefined) {
      const groqArray = Array.isArray(groq) ? groq : [groq];
      update["keys.groq"] = groqArray.map((k) => k.trim()).filter(Boolean);
    }
    if (gemini !== undefined) update["keys.gemini"] = gemini;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: "No se proporcionaron keys para guardar" });
    }

    await User.findOneAndUpdate(
      { odooUserId: decoded.id },
      { $set: update },
      { new: true }
    );

    return res.json({ success: true, message: "Keys guardadas correctamente" });
  } catch (error) {
    console.error("Error guardando keys:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function obtenerKeysUsuario(req, res) {
  try {
    const { token } = req.cookies;
    if (!token) return res.status(401).json({ success: false, message: "No autorizado" });

    const decoded = jwt.verify(token, TOKEN_SECRET);
    const user = await User.findOne({ odooUserId: decoded.id });

    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });

    return res.json({
      success: true,
      keys: {
        groq: (user.keys?.groq || []).filter(k => k.trim() !== ""),
        gemini: user.keys?.gemini || "",
      },
    });
  } catch (error) {
    console.error("Error obteniendo keys:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}