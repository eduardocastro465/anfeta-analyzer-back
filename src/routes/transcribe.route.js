// src/routes/transcribe.route.js
import { Router } from "express";
import { transcribeAudio } from "../controllers/transcribe.controller.js";

const router = Router();


router.post("/", transcribeAudio);

export default router;