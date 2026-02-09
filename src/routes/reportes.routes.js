import { Router } from "express";
import {
    obtenerTodosReportes,
    obtenerReportesPorUsuario,
    obtenerReportePorId,
    obtenerResumenReportes,
    exportarReportes,
    generarReporteDiario,
    obtenerExplicacionesPorSesion ,
    obtenerTareasReportadas  
} from "../controllers/reporte.controller.js"

const router = Router();

// Ruta para generar reporte diario (admin)
router.post('/generar-diario', generarReporteDiario);

// Ruta para obtener todos los reportes (con filtros)
router.get('/todos', obtenerTodosReportes);

// Ruta para obtener resumen/estadísticas
router.get('/resumen', obtenerResumenReportes);

router.get('/tareas-reportadas', obtenerTareasReportadas);
// Ruta para exportar reportes
router.get('/exportar', exportarReportes);

// Ruta para obtener reportes por usuario
router.get('/usuario/:userId', obtenerReportesPorUsuario);

// Ruta para obtener reporte por ID específico
router.get('/:id', obtenerReportePorId);

// Ruta para obtener explicaciones por sesión (para frontend)
router.get('/explicaciones/sesion/:sessionId', obtenerExplicacionesPorSesion);


// Ruta para obtener explicaciones por sesión (para frontend)
router.get('/explicaciones/sesion/:sessionId', obtenerExplicacionesPorSesion);

export default router;