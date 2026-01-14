import { Router } from "express";
import { assistantController } from "../controllers/assistant.controller.js";

const router = Router();

router.post("/", assistantController);

export default router;
