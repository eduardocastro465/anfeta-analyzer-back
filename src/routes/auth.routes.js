import { Router } from "express";

const router = Router();
import {
    signIn, verifyToken, logout,
    //  getAnfetaToken
} from "../controllers/auth.controller.js";


router.post('/signIn', signIn);
router.get('/verifyToken', verifyToken);
router.post('/logout', logout);
// router.get('/getAnfetaToken', getAnfetaToken);

export default router;