import jwt from "jsonwebtoken";
// import axios from "axios";
import {
  TOKEN_SECRET,
  // API_URL_ANFETA, ANFETA_SHARED_USER, ANFETA_SHARED_PASS,
} from "../config.js";
import { createAccessToken } from "../libs/jwt.js";
import { getAllUsers } from "./users.controller.js";

// export const getAnfetaToken = async (req, res) => {
//   const { token } = req.cookies;

//   if (!token) return res.sendStatus(401);

//   console.log(ANFETA_SHARED_USER, ANFETA_SHARED_PASS)

//   jwt.verify(token, TOKEN_SECRET, async (error, user) => {
//     if (error) return res.sendStatus(401);

//     try {
//       const response = await axios.post(
//         `${API_URL_ANFETA}/shared-auth/login`,
//         {
//           user: ANFETA_SHARED_USER,
//           pass: ANFETA_SHARED_PASS
//         }
//       );
//       return res.json({ token: response.data.token });
//     } catch (err) {
//       console.error("Error al obtener token de Anfeta:", err);
//       return res.status(500).json({ message: "No se pudo obtener token de Anfeta" });
//     }
//   });
// };

export const signIn = async (req, res) => {
  try {
    const { email } = req.body;
    const users = await getAllUsers();

    const userFound = users.items.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    );

    if (!userFound) {
      return res.status(400).json({
        message: ["El usuario no existe"]
      });
    }

    // const response = await axios.post(
    //   `${API_URL_ANFETA}/shared-auth/login`,
    //   {
    //     user: ANFETA_SHARED_USER,
    //     pass: ANFETA_SHARED_PASS
    //   }
    // );


    const token = await createAccessToken({
      id: userFound.id,
      email: userFound.email,
      username: userFound.firstName,
    });

    const isProduction = process.env.NODE_ENV === "production";

    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000  // 7 días
    };

    res.cookie("token", token, cookieOptions);

    res.json({
      id: userFound.collaboratorId,
      username: userFound.firstName,
      email: userFound.email,
      // anfetaToken: response.data.token
    });
  } catch (error) {
    console.error("Error en signIn:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const verifyToken = (req, res) => {
  const { token } = req.cookies;

  if (!token) return res.sendStatus(401);

  jwt.verify(token, TOKEN_SECRET, (error, user) => {
    if (error) {
      return res.sendStatus(401);
    }
    return res.json({
      id: user.id,
      email: user.email,
      username: user.username
    });
  });
};

export const logout = async (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("token", "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    expires: new Date(0),
  });

  return res.sendStatus(200);
};