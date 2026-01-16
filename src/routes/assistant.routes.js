import { Router } from "express";
import { devuelveActividades,devuelveActReviciones } from "../controllers/assistant.controller.js";

const router = Router();

router.post("/act-col", devuelveActividades);
router.post("/act-revisiones-col",devuelveActReviciones );

export default router;