import { Router } from "express";

const router = Router();
import {
  getActividadesConRevisiones,
  confirmarEstadoPendientes,
  actualizarEstadoPendientes,
  consultarIA,
  consultarIAProyecto,
  obtenerMensajesConversacion,
  verificarAnalisisDelDia,
  guardarExplicacionesTarde,
  eliminarConversacion,
  verificarCambiosDesdeAnfeta
} from '../controllers/assistant.controller.js';

import {
  obtenerOCrearSessionActual,
  obtenerHistorialSesion,
  obtenerTodoHistorialSesion,
  obtenerHistorialSidebar,
  guardarExplicaciones,
  validarExplicacion,
  validarYGuardarExplicacion,
  obtenerActividadesConTiempoHoy,
  obtenerTodasExplicacionesAdmin,
  modificarMotivoNoCompletado,
  verificarCambiosTareas,
  soloVerificarCambios
} from '../controllers/assistant.controller.js';


// Rutas de historial
router.get("/session/actual", obtenerOCrearSessionActual);
router.get('/historial/sesion/:sessionId', obtenerHistorialSesion);
router.get('/historial/usuario', obtenerTodoHistorialSesion);
router.get('/historial/titulos', obtenerHistorialSidebar);

// funcion para obtener todo los reportes de obtenerExplicacionesUsuario
router.get('/admin/todas-explicaciones', obtenerTodasExplicacionesAdmin);

// Rutas de actividades/pendientes
router.get('/actividades/hoy/con-tiempo', obtenerActividadesConTiempoHoy);
router.put('/actividades/pendientes/actualizar', actualizarEstadoPendientes);
router.post('/validar-explicacion', validarExplicacion);
router.post('/validar-guardar-explicacion', validarYGuardarExplicacion);
router.post('/guardar-explicaciones', guardarExplicaciones);
router.post('/actividades-con-revisiones', getActividadesConRevisiones);
router.post('/confirmarEstadoPendientes', confirmarEstadoPendientes);

router.post('/guardarDescripcionTarde', guardarExplicacionesTarde);

router.post('/consultar-ia', consultarIA);
router.post('/consultar-ia-proyecto', consultarIAProyecto);

router.get('/historial/:sessionId/mensajes', obtenerMensajesConversacion);
router.get('/analisis/verificar', verificarAnalisisDelDia);

router.delete("/historial/sesion/:sessionId", eliminarConversacion);


router.get('/verificar-cambios-tareas', verificarCambiosTareas);

router.post('/modificar-motivo', modificarMotivoNoCompletado);

router.get('/soloVerificarCambios', soloVerificarCambios);
router.get("/verificar-cambios-anfeta", verificarCambiosDesdeAnfeta);


export default router;