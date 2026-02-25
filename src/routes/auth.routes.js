import { Router } from "express";

const router = Router();
import {
    signIn, verifyToken, logout,
} from "../controllers/auth.controller.js";
import {
    obtenerPreferenciasUsuario, guardarPreferenciasUsuario
} from "../controllers/users.controller.js";


router.post('/signIn', signIn);
router.get('/verifyToken', verifyToken);
router.post('/logout', logout);
router.get("/preferencias", obtenerPreferenciasUsuario);
router.post("/preferencias", guardarPreferenciasUsuario);

export default router;