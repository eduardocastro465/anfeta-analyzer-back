import ActividadesSchema from "../models/actividades.model.js";
import ReportePendiente from "../models/reporte.model.js";
import jwt from "jsonwebtoken";
import { TOKEN_SECRET } from "../config.js"

// 1. Función para obtener TODOS los reportes (todos los usuarios)
export async function obtenerTodosReportes(req, res) {
    try {
        const {
            fechaInicio,
            fechaFin,
            proyecto,
            estado,
            prioridad,
            page = 1,
            limit = 50
        } = req.query;

        // Construir filtro
        const filtro = {};

        // Filtro por fecha
        if (fechaInicio || fechaFin) {
            filtro.fechaReporte = {};
            if (fechaInicio) {
                const inicio = new Date(fechaInicio);
                inicio.setHours(0, 0, 0, 0);
                filtro.fechaReporte.$gte = inicio;
            }
            if (fechaFin) {
                const fin = new Date(fechaFin);
                fin.setHours(23, 59, 59, 999);
                filtro.fechaReporte.$lte = fin;
            }
        }

        // Filtro por proyecto
        if (proyecto) {
            filtro.proyectoNombre = { $regex: proyecto, $options: 'i' };
        }

        // Filtro por estado
        if (estado) {
            filtro.estadoFinal = estado;
        }

        // Filtro por prioridad
        if (prioridad) {
            filtro.prioridad = prioridad;
        }

        // Calcular paginación
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Ejecutar consulta con paginación
        const [reportes, total] = await Promise.all([
            ReportePendiente.find(filtro)
                .sort({ fechaReporte: -1, userId: 1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            ReportePendiente.countDocuments(filtro)
        ]);

        // Calcular estadísticas
        const estadisticas = {
            porEstado: await ReportePendiente.aggregate([
                { $match: filtro },
                { $group: { _id: "$estadoFinal", count: { $sum: 1 } } }
            ]),
            porPrioridad: await ReportePendiente.aggregate([
                { $match: filtro },
                { $group: { _id: "$prioridad", count: { $sum: 1 } } }
            ]),
            porProyecto: await ReportePendiente.aggregate([
                { $match: filtro },
                { $group: { _id: "$proyectoNombre", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]),
            porFecha: await ReportePendiente.aggregate([
                { $match: filtro },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$fechaReporte" }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 30 }
            ])
        };

        res.json({
            success: true,
            data: reportes,
            paginacion: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            estadisticas,
            filtros: {
                fechaInicio,
                fechaFin,
                proyecto,
                estado,
                prioridad
            }
        });

    } catch (error) {
        console.error("Error al obtener todos los reportes:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener reportes",
            error: error.message
        });
    }
}

// 2. Función para obtener reportes por usuario específico
export async function obtenerReportesPorUsuario(req, res) {
    try {
        const { userId } = req.params;
        const {
            fechaInicio,
            fechaFin,
            proyecto,
            estado,
            prioridad,
            page = 1,
            limit = 50
        } = req.query;

        // Construir filtro base con userId
        const filtro = { userId };

        // Filtro por fecha
        if (fechaInicio || fechaFin) {
            filtro.fechaReporte = {};
            if (fechaInicio) {
                const inicio = new Date(fechaInicio);
                inicio.setHours(0, 0, 0, 0);
                filtro.fechaReporte.$gte = inicio;
            }
            if (fechaFin) {
                const fin = new Date(fechaFin);
                fin.setHours(23, 59, 59, 999);
                filtro.fechaReporte.$lte = fin;
            }
        }

        // Filtro por proyecto
        if (proyecto) {
            filtro.proyectoNombre = { $regex: proyecto, $options: 'i' };
        }

        // Filtro por estado
        if (estado) {
            filtro.estadoFinal = estado;
        }

        // Filtro por prioridad
        if (prioridad) {
            filtro.prioridad = prioridad;
        }

        // Calcular paginación
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Ejecutar consulta con paginación
        const [reportes, total] = await Promise.all([
            ReportePendiente.find(filtro)
                .sort({ fechaReporte: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            ReportePendiente.countDocuments(filtro)
        ]);

        // Obtener información del usuario desde ActividadesSchema
        const usuarioInfo = await ActividadesSchema.findOne({ userId })
            .select('userId nombre email -_id')
            .lean();

        // Calcular estadísticas específicas del usuario
        const estadisticas = {
            porEstado: await ReportePendiente.aggregate([
                { $match: filtro },
                { $group: { _id: "$estadoFinal", count: { $sum: 1 } } }
            ]),
            porPrioridad: await ReportePendiente.aggregate([
                { $match: filtro },
                { $group: { _id: "$prioridad", count: { $sum: 1 } } }
            ]),
            porProyecto: await ReportePendiente.aggregate([
                { $match: filtro },
                { $group: { _id: "$proyectoNombre", count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            porFecha: await ReportePendiente.aggregate([
                { $match: filtro },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$fechaReporte" }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 30 }
            ])
        };

        res.json({
            success: true,
            usuario: usuarioInfo || { userId },
            data: reportes,
            paginacion: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            estadisticas,
            filtros: {
                fechaInicio,
                fechaFin,
                proyecto,
                estado,
                prioridad
            }
        });

    } catch (error) {
        console.error(`Error al obtener reportes para usuario ${req.params.userId}:`, error);
        res.status(500).json({
            success: false,
            message: "Error al obtener reportes del usuario",
            error: error.message
        });
    }
}

// 3. Función para obtener reporte por ID específico
export async function obtenerReportePorId(req, res) {
    try {
        const { id } = req.params;

        // Buscar el reporte por ID
        const reporte = await ReportePendiente.findById(id).lean();

        if (!reporte) {
            return res.status(404).json({
                success: false,
                message: "Reporte no encontrado"
            });
        }

        // Obtener información adicional del proyecto y actividad
        const proyectoInfo = await ActividadesSchema.findOne({
            userId: reporte.userId,
            "actividades.ActividadId": reporte.actividadId
        })
            .select('userId nombre actividades.$ -_id')
            .lean();

        // Encontrar la actividad específica
        let actividadInfo = null;
        if (proyectoInfo && proyectoInfo.actividades) {
            actividadInfo = proyectoInfo.actividades.find(
                act => act.ActividadId === reporte.actividadId
            );
        }

        // Encontrar el pendiente específico
        let pendienteInfo = null;
        if (actividadInfo && actividadInfo.pendientes) {
            pendienteInfo = actividadInfo.pendientes.find(
                pend => pend.pendienteId === reporte.pendienteId
            );
        }

        res.json({
            success: true,
            data: {
                ...reporte,
                informacionCompleta: {
                    proyecto: proyectoInfo || { nombre: "No disponible" },
                    actividad: actividadInfo || { titulo: "No disponible" },
                    pendiente: pendienteInfo || { nombre: "No disponible" }
                }
            }
        });

    } catch (error) {
        console.error(`Error al obtener reporte ${req.params.id}:`, error);
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: "ID de reporte inválido"
            });
        }
        res.status(500).json({
            success: false,
            message: "Error al obtener el reporte",
            error: error.message
        });
    }
}

// 4. Función para obtener resumen/estadísticas generales
export async function obtenerResumenReportes(req, res) {
    try {
        const { fechaInicio, fechaFin } = req.query;

        const filtro = {};

        // Filtro por fecha si se proporciona
        if (fechaInicio || fechaFin) {
            filtro.fechaReporte = {};
            if (fechaInicio) {
                const inicio = new Date(fechaInicio);
                inicio.setHours(0, 0, 0, 0);
                filtro.fechaReporte.$gte = inicio;
            }
            if (fechaFin) {
                const fin = new Date(fechaFin);
                fin.setHours(23, 59, 59, 999);
                filtro.fechaReporte.$lte = fin;
            }
        }

        const estadisticas = await ReportePendiente.aggregate([
            { $match: filtro },
            {
                $facet: {
                    totalReportes: [{ $count: "count" }],
                    porEstado: [{ $group: { _id: "$estadoFinal", count: { $sum: 1 } } }],
                    porPrioridad: [{ $group: { _id: "$prioridad", count: { $sum: 1 } } }],
                    porUsuario: [
                        { $group: { _id: "$userId", count: { $sum: 1 } } },
                        { $sort: { count: -1 } }
                    ],
                    porProyecto: [
                        { $group: { _id: "$proyectoNombre", count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $limit: 10 }
                    ],
                    evolucionDiaria: [
                        {
                            $group: {
                                _id: {
                                    $dateToString: { format: "%Y-%m-%d", date: "$fechaReporte" }
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ]
                }
            }
        ]);

        res.json({
            success: true,
            data: estadisticas[0],
            periodo: {
                fechaInicio,
                fechaFin,
                totalDias: fechaInicio && fechaFin ?
                    Math.ceil((new Date(fechaFin) - new Date(fechaInicio)) / (1000 * 60 * 60 * 24)) :
                    null
            }
        });

    } catch (error) {
        console.error("Error al obtener resumen de reportes:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener resumen de reportes",
            error: error.message
        });
    }
}

// 5. Función para exportar reportes (CSV/Excel)
export async function exportarReportes(req, res) {
    try {
        const { format = 'csv', fechaInicio, fechaFin } = req.query;

        const filtro = {};

        if (fechaInicio || fechaFin) {
            filtro.fechaReporte = {};
            if (fechaInicio) {
                const inicio = new Date(fechaInicio);
                inicio.setHours(0, 0, 0, 0);
                filtro.fechaReporte.$gte = inicio;
            }
            if (fechaFin) {
                const fin = new Date(fechaFin);
                fin.setHours(23, 59, 59, 999);
                filtro.fechaReporte.$lte = fin;
            }
        }

        const reportes = await ReportePendiente.find(filtro)
            .sort({ fechaReporte: -1, userId: 1 })
            .lean();

        if (format === 'csv') {
            // Generar CSV
            const headers = [
                'ID Reporte',
                'Usuario ID',
                'Proyecto',
                'Actividad ID',
                'Pendiente ID',
                'Pendiente Nombre',
                'Estado',
                'Motivo No Completado',
                'Prioridad',
                'Duración (min)',
                'Fecha Reporte'
            ];

            const csvRows = reportes.map(reporte => [
                reporte._id,
                reporte.userId,
                reporte.proyectoNombre,
                reporte.actividadId,
                reporte.pendienteId,
                `"${reporte.pendienteNombre}"`,
                reporte.estadoFinal,
                `"${reporte.motivoNoCompletado || ''}"`,
                reporte.prioridad,
                reporte.duracionMin,
                new Date(reporte.fechaReporte).toISOString().split('T')[0]
            ]);

            const csvContent = [
                headers.join(','),
                ...csvRows.map(row => row.join(','))
            ].join('\n');

            res.header('Content-Type', 'text/csv');
            res.attachment(`reportes_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csvContent);
        } else if (format === 'json') {
            // Generar JSON
            res.json({
                success: true,
                metadata: {
                    total: reportes.length,
                    fechaGeneracion: new Date().toISOString(),
                    filtros: { fechaInicio, fechaFin }
                },
                data: reportes
            });
        } else {
            return res.status(400).json({
                success: false,
                message: "Formato no soportado. Use 'csv' o 'json'"
            });
        }

    } catch (error) {
        console.error("Error al exportar reportes:", error);
        res.status(500).json({
            success: false,
            message: "Error al exportar reportes",
            error: error.message
        });
    }
}

// Función existente que ya tenías
export async function generarReporteDiario(req, res) {
    try {
        // Fecha normalizada del día
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Borrar reporte de hoy (si existe)
        await ReportePendiente.deleteMany({
            fechaReporte: {
                $gte: hoy,
                $lt: new Date(hoy.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        // Obtener TODOS los proyectos
        const proyectos = await ActividadesSchema.find({});

        const reportes = [];

        // Generar snapshot diario
        for (const proyecto of proyectos) {
            for (const actividad of proyecto.actividades) {
                for (const pendiente of actividad.pendientes) {
                    if (
                        pendiente.estado !== "completado" &&
                        pendiente.motivoNoCompletado
                    ) {
                        reportes.push({
                            userId: proyecto.userId,
                            proyectoNombre: proyecto.nombre,
                            actividadId: actividad.ActividadId,
                            pendienteId: pendiente.pendienteId,
                            pendienteNombre: pendiente.nombre,
                            estadoFinal: pendiente.estado,
                            motivoNoCompletado: pendiente.motivoNoCompletado,
                            prioridad: actividad.prioridad,
                            duracionMin: actividad.duracionMin,
                            fechaReporte: hoy
                        });
                    }
                }
            }
        }

        // Guardar reporte diario
        if (reportes.length) {
            await ReportePendiente.insertMany(reportes);
        }

        res.json({
            success: true,
            fecha: hoy.toISOString().split("T")[0],
            totalReportes: reportes.length,
            resumen: {
                porUsuario: reportes.reduce((acc, reporte) => {
                    acc[reporte.userId] = (acc[reporte.userId] || 0) + 1;
                    return acc;
                }, {}),
                porProyecto: reportes.reduce((acc, reporte) => {
                    acc[reporte.proyectoNombre] = (acc[reporte.proyectoNombre] || 0) + 1;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error al generar reporte diario"
        });
    }
}

// 
// Agregar esta función al final del archivo reporte.controller.js

// 6. Función para obtener explicaciones por sesión (para frontend)
export async function obtenerExplicacionesPorSesion(req, res) {
    try {
        const { sessionId } = req.params;
        const { userId } = req.query; // opcional, para validación

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "sessionId es requerido"
            });
        }

        // Buscar actividades del usuario que coincidan con la sesión
        // Obtener todas las actividades que tengan pendientes con explicaciones
        const actividadesConExplicaciones = await ActividadesSchema.find({
            // Si tienes userId, filtra por él
            ...(userId && { userId: userId }),
            "actividades.pendientes.descripcion": { $exists: true, $ne: "" }
        }).lean();

        // Filtrar y formatear las explicaciones
        const explicaciones = [];

        actividadesConExplicaciones.forEach(proyecto => {
            proyecto.actividades.forEach(actividad => {
                actividad.pendientes
                    .filter(pendiente => pendiente.descripcion && pendiente.descripcion.trim() !== "")
                    .forEach(pendiente => {
                        explicaciones.push({
                            pendienteId: pendiente.pendienteId,
                            actividadId: actividad.ActividadId || actividad.actividadId,
                            actividadTitulo: actividad.titulo,
                            pendienteNombre: pendiente.nombre,
                            explicacion: pendiente.descripcion,
                            duracionMin: pendiente.duracionMin,
                            prioridad: pendiente.prioridad || "MEDIA",
                            terminada: pendiente.terminada || false,
                            confirmada: pendiente.confirmada || false,
                            fechaCreacion: pendiente.fechaCreacion,
                            fechaFinTerminada: pendiente.fechaFinTerminada,
                            // Información del usuario que reportó
                            usuarioId: proyecto.userId,
                            emailUsuario: proyecto.email || "No disponible",
                            fechaReporte: pendiente.ultimaActualizacion || pendiente.fechaCreacion || new Date(),
                            // Metadatos adicionales si existen
                            explicacionVoz: pendiente.explicacionVoz,
                            revisadoPorVoz: pendiente.revisadoPorVoz || false,
                            sessionId: sessionId // Guardamos la sesión actual
                        });
                    });
            });
        });

        res.json({
            success: true,
            sessionId,
            total: explicaciones.length,
            data: explicaciones,
            metadata: {
                fechaConsulta: new Date().toISOString(),
                userId: userId || "todos",
                totalActividades: actividadesConExplicaciones.length
            }
        });

    } catch (error) {
        console.error("Error al obtener explicaciones por sesión:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener explicaciones",
            error: error.message
        });
    }
}



// Funciones auxiliares para estadísticas
async function obtenerEstadisticasPorEstado(filtroBase) {
    const pipeline = [
        { $match: filtroBase },
        { $unwind: "$actividades" },
        { $unwind: "$actividades.pendientes" },
        {
            $match: {
                "actividades.pendientes.descripcion": {
                    $exists: true,
                    $ne: ""
                }
            }
        },
        {
            $group: {
                _id: "$actividades.pendientes.estado",
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } }
    ];

    return await ActividadesSchema.aggregate(pipeline);
}

async function obtenerEstadisticasPorPrioridad(filtroBase) {
    const pipeline = [
        { $match: filtroBase },
        { $unwind: "$actividades" },
        { $unwind: "$actividades.pendientes" },
        {
            $match: {
                "actividades.pendientes.descripcion": {
                    $exists: true,
                    $ne: ""
                }
            }
        },
        {
            $group: {
                _id: "$actividades.pendientes.prioridad",
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } }
    ];

    return await ActividadesSchema.aggregate(pipeline);
}

export async function obtenerTareasReportadas(req, res) {
    try {
        const { actividadId, limit = 50 } = req.query;

        const { token } = req.cookies;
        const decoded = jwt.verify(token, TOKEN_SECRET);
        const userId = decoded.id;
        const email = decoded.email;

        if (!email) {
            return res.status(400).json({ success: false, message: "Email requerido" });
        }

        const todosLosDocumentos = await ActividadesSchema.find({}).lean();

        const tareasDelUsuario = [];
        const tareasDeColaboradores = [];

        // ✅ DEFINE LISTA DE EMAILS INVÁLIDOS
        const emailsInvalidos = ['desconocido', '', null, undefined];

        for (const documento of todosLosDocumentos) {
            if (documento.actividades && Array.isArray(documento.actividades)) {
                for (const actividad of documento.actividades) {
                    if (actividadId && actividad.actividadId !== actividadId) {
                        continue;
                    }

                    if (actividad.pendientes && Array.isArray(actividad.pendientes)) {
                        for (const pendiente of actividad.pendientes) {
                            let esDelUsuario = false;
                            let donde = '';
                            let texto = '';

                            // ✅ PRIORIDAD 1: explicacionVoz.texto (con metadata completa)
                            // 🔥 IMPORTANTE: NO considerar si el texto es igual a la descripción
                            // (indica que se copió automáticamente, no es una explicación real)
                            if (pendiente.explicacionVoz &&
                                pendiente.explicacionVoz.emailUsuario === email &&
                                pendiente.explicacionVoz.texto &&
                                pendiente.explicacionVoz.texto.trim() !== '' &&
                                pendiente.explicacionVoz.texto.trim() !== (pendiente.descripcion || '').trim()) {
                                esDelUsuario = true;
                                donde = 'explicacionVoz';
                                texto = pendiente.explicacionVoz.texto;
                            }
                            // ✅ PRIORIDAD 2: queHizo (campo simple, pero válido)  
                            else if (pendiente.queHizo &&
                                pendiente.queHizo.trim() !== '' &&
                                pendiente.queHizo.trim() !== (pendiente.descripcion || '').trim() &&
                                pendiente.actualizadoPor === email) {
                                esDelUsuario = true;
                                donde = 'queHizo';
                                texto = pendiente.queHizo;
                            }
                            // ✅ PRIORIDAD 3: historialExplicaciones
                            else if (pendiente.historialExplicaciones && Array.isArray(pendiente.historialExplicaciones)) {
                                const historialConEmail = pendiente.historialExplicaciones.find(
                                    h => h.emailUsuario === email &&
                                        h.texto &&
                                        h.texto.trim() !== '' &&
                                        h.texto.trim() !== (pendiente.descripcion || '').trim()
                                );
                                if (historialConEmail) {
                                    esDelUsuario = true;
                                    donde = 'historialExplicaciones';
                                    texto = historialConEmail.texto;
                                }
                            }

                            // ❌ NO USAR: descripcion (es "qué hacer", NO "qué hiciste")

                            // ✅ SOLO AGREGAR SI TIENE TEXTO DE EXPLICACIÓN REAL
                            if (esDelUsuario && texto && texto.trim() !== '') {
                                tareasDelUsuario.push({
                                    actividad: actividad.titulo || 'Sin título',
                                    tarea: pendiente.nombre || 'Sin nombre',
                                    texto: texto,
                                    encontradoEn: donde,
                                    fecha: pendiente.ultimaActualizacion || new Date(),
                                    pendienteId: pendiente.pendienteId,
                                    actividadId: actividad.actividadId,
                                    esMiReporte: true,
                                    reportadoPor: {
                                        email: email,
                                        nombre: email.split('@')[0],
                                        esYo: true
                                    }
                                });
                            }

                            // ✅ VALIDAR REPORTES DE OTROS COLABORADORES

                            // CASO 1: explicacionVoz de otro usuario
                            if (pendiente.explicacionVoz &&
                                pendiente.explicacionVoz.emailUsuario) {
                                const otroEmail = pendiente.explicacionVoz.emailUsuario;
                                const otroTexto = pendiente.explicacionVoz.texto || '';

                                // ⭐ RECHAZA EMAILS INVÁLIDOS
                                if (emailsInvalidos.includes(otroEmail)) {
                                    continue;
                                }

                                // 🔥 NO agregar si el texto es igual a descripcion
                                const esIgualADescripcion = otroTexto.trim() === (pendiente.descripcion || '').trim();

                                // ✅ SOLO AGREGAR SI TIENE TEXTO REAL Y ES OTRO USUARIO
                                if (otroTexto &&
                                    otroTexto.trim() !== '' &&
                                    !esIgualADescripcion &&
                                    otroEmail !== email) {
                                    tareasDeColaboradores.push({
                                        actividad: actividad.titulo || 'Sin título',
                                        tarea: pendiente.nombre || 'Sin nombre',
                                        texto: otroTexto,
                                        encontradoEn: 'explicacionVoz',
                                        fecha: pendiente.ultimaActualizacion || new Date(),
                                        pendienteId: pendiente.pendienteId,
                                        actividadId: actividad.actividadId,
                                        esMiReporte: false,
                                        reportadoPor: {
                                            email: otroEmail,
                                            nombre: otroEmail.split('@')[0],
                                            esYo: false
                                        },
                                        esReporteColaborativo: true,
                                        colaborador: otroEmail.split('@')[0]
                                    });
                                }
                            }

                            // CASO 2: queHizo de otro usuario
                            else if (pendiente.queHizo &&
                                pendiente.queHizo.trim() !== '' &&
                                pendiente.queHizo.trim() !== (pendiente.descripcion || '').trim() &&
                                pendiente.actualizadoPor &&
                                pendiente.actualizadoPor !== email &&
                                !emailsInvalidos.includes(pendiente.actualizadoPor)) {
                                tareasDeColaboradores.push({
                                    actividad: actividad.titulo || 'Sin título',
                                    tarea: pendiente.nombre || 'Sin nombre',
                                    texto: pendiente.queHizo,
                                    encontradoEn: 'queHizo',
                                    fecha: pendiente.ultimaActualizacion || new Date(),
                                    pendienteId: pendiente.pendienteId,
                                    actividadId: actividad.actividadId,
                                    esMiReporte: false,
                                    reportadoPor: {
                                        email: pendiente.actualizadoPor,
                                        nombre: pendiente.actualizadoPor.split('@')[0],
                                        esYo: false
                                    },
                                    esReporteColaborativo: true,
                                    colaborador: pendiente.actualizadoPor.split('@')[0]
                                });
                            }

                            // ✅ VALIDAR EN HISTORIAL
                            if (pendiente.historialExplicaciones && Array.isArray(pendiente.historialExplicaciones)) {
                                for (const historial of pendiente.historialExplicaciones) {
                                    // ⭐ RECHAZA EMAILS INVÁLIDOS
                                    if (emailsInvalidos.includes(historial.emailUsuario)) {
                                        continue;
                                    }

                                    // 🔥 NO agregar si el texto es igual a descripcion
                                    const esIgualADescripcion = (historial.texto || '').trim() === (pendiente.descripcion || '').trim();

                                    // ✅ SOLO AGREGAR SI TIENE TEXTO REAL Y ES OTRO USUARIO
                                    if (historial.emailUsuario &&
                                        historial.emailUsuario !== email &&
                                        historial.texto &&
                                        historial.texto.trim() !== '' &&
                                        !esIgualADescripcion) {
                                        tareasDeColaboradores.push({
                                            actividad: actividad.titulo || 'Sin título',
                                            tarea: pendiente.nombre || 'Sin nombre',
                                            texto: historial.texto,
                                            encontradoEn: 'historialExplicaciones',
                                            fecha: historial.fecha || pendiente.ultimaActualizacion || new Date(),
                                            pendienteId: pendiente.pendienteId,
                                            actividadId: actividad.actividadId,
                                            esMiReporte: false,
                                            reportadoPor: {
                                                email: historial.emailUsuario,
                                                nombre: historial.emailUsuario.split('@')[0],
                                                esYo: false
                                            },
                                            esReporteColaborativo: true,
                                            colaborador: historial.emailUsuario.split('@')[0]
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let tareasFinales = [];
        tareasFinales.push(...tareasDelUsuario);
        tareasFinales.push(...tareasDeColaboradores);

        tareasFinales.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        // ✅ DEDUPLICAR POR pendienteId (mantener el más reciente)
        // NOTA: Si una tarea tiene TANTO queHizo como explicacionVoz, 
        // la lógica if-else anterior prioriza explicacionVoz porque:
        // 1. Se evalúa primero
        // 2. Tiene más metadata (email, fecha, validación IA)
        // 3. Es la forma recomendada de reportar
        const seen = new Set();
        tareasFinales = tareasFinales.filter(t => {
            if (seen.has(t.pendienteId)) return false;
            seen.add(t.pendienteId);
            return true;
        });

        tareasFinales = tareasFinales.slice(0, limit);

        res.json({
            success: true,
            count: tareasFinales.length,
            data: tareasFinales,
            info: {
                emailBuscado: email,
                totalDocumentosRevisados: todosLosDocumentos.length,
                fuenteDatos: 'combinada',
                tareasUsuario: tareasDelUsuario.length,
                tareasColaboradores: tareasDeColaboradores.length,
                fecha: new Date().toISOString()
            },
            metadata: {
                tieneReportesPropios: tareasDelUsuario.length > 0,
                tieneReportesColaborativos: tareasDeColaboradores.length > 0,
                tareasUsuario: tareasDelUsuario.length,
                tareasColaboradores: tareasDeColaboradores.length,
                mensaje: tareasDelUsuario.length > 0 && tareasDeColaboradores.length > 0
                    ? 'Mostrando tus reportes y reportes de colaboradores en tus actividades'
                    : tareasDelUsuario.length > 0
                        ? 'Mostrando tus reportes personales'
                        : tareasDeColaboradores.length > 0
                            ? 'Mostrando reportes de colaboradores en tus actividades'
                            : 'No hay reportes disponibles'
            }
        });

    } catch (error) {
        console.error("Error al buscar tareas:", error);
        res.status(500).json({
            success: false,
            error: "Error al buscar tareas",
            detalle: error.message
        });
    }
}

export async function obtenerReportesPorActividad(req, res) {
    try {
        const { actividadId, tareaId, limit = 50 } = req.query;

        console.log(`🔍 Buscando reportes para actividad: ${actividadId || 'Todas'}, tarea: ${tareaId || 'Todas'}`);

        // 1. Buscar TODOS los documentos
        const todosLosDocumentos = await ActividadesSchema.find({}).lean();

        // 2. Buscar reportes por actividad/tarea
        const reportesEncontrados = [];
        const actividadesUnicas = new Set();
        const colaboradoresUnicos = new Set();

        for (const documento of todosLosDocumentos) {
            if (documento.actividades && Array.isArray(documento.actividades)) {

                for (const actividad of documento.actividades) {
                    // Filtrar por actividadId si se especifica
                    if (actividadId && actividad.actividadId !== actividadId) {
                        continue;
                    }

                    actividadesUnicas.add(actividad.titulo || 'Sin título');

                    if (actividad.pendientes && Array.isArray(actividad.pendientes)) {

                        for (const pendiente of actividad.pendientes) {
                            // Filtrar por tareaId si se especifica
                            if (tareaId && pendiente.pendienteId !== tareaId) {
                                continue;
                            }

                            // BUSCAR REPORTES EN EXPLICACIONVOZ
                            if (pendiente.explicacionVoz && pendiente.explicacionVoz.texto) {
                                const emailUsuario = pendiente.explicacionVoz.emailUsuario || "Desconocido";
                                const nombreUsuario = emailUsuario.split('@')[0];
                                colaboradoresUnicos.add(nombreUsuario);

                                reportesEncontrados.push({
                                    tipo: 'explicacionVoz',
                                    actividadId: actividad.actividadId,
                                    actividadTitulo: actividad.titulo || 'Sin título',
                                    tareaId: pendiente.pendienteId,
                                    tareaNombre: pendiente.nombre || 'Sin nombre',
                                    texto: pendiente.explicacionVoz.texto,
                                    reportadoPor: {
                                        email: emailUsuario,
                                        nombre: nombreUsuario,
                                        esColaborador: true
                                    },
                                    fecha: pendiente.explicacionVoz.fecha || pendiente.ultimaActualizacion || new Date(),
                                    duracionMin: pendiente.duracionMin || 0,
                                    prioridad: pendiente.prioridad || 'MEDIA',
                                    estado: pendiente.terminada ? 'COMPLETADA' : 'PENDIENTE'
                                });
                            }

                            // BUSCAR REPORTES EN HISTORIAL EXPLICACIONES
                            if (pendiente.historialExplicaciones && Array.isArray(pendiente.historialExplicaciones)) {
                                for (const historial of pendiente.historialExplicaciones) {
                                    if (historial.texto) {
                                        const emailUsuario = historial.emailUsuario || "Desconocido";
                                        const nombreUsuario = emailUsuario.split('@')[0];
                                        colaboradoresUnicos.add(nombreUsuario);

                                        reportesEncontrados.push({
                                            tipo: 'historialExplicaciones',
                                            actividadId: actividad.actividadId,
                                            actividadTitulo: actividad.titulo || 'Sin título',
                                            tareaId: pendiente.pendienteId,
                                            tareaNombre: pendiente.nombre || 'Sin nombre',
                                            texto: historial.texto,
                                            reportadoPor: {
                                                email: emailUsuario,
                                                nombre: nombreUsuario,
                                                esColaborador: true
                                            },
                                            fecha: historial.fecha || pendiente.ultimaActualizacion || new Date(),
                                            duracionMin: pendiente.duracionMin || 0,
                                            prioridad: pendiente.prioridad || 'MEDIA',
                                            estado: pendiente.terminada ? 'COMPLETADA' : 'PENDIENTE'
                                        });
                                    }
                                }
                            }

                            // BUSCAR EN ACTUALIZADOPOR
                            if (pendiente.actualizadoPor) {
                                const emailUsuario = pendiente.actualizadoPor;
                                const nombreUsuario = emailUsuario.split('@')[0];
                                colaboradoresUnicos.add(nombreUsuario);

                                reportesEncontrados.push({
                                    tipo: 'actualizadoPor',
                                    actividadId: actividad.actividadId,
                                    actividadTitulo: actividad.titulo || 'Sin título',
                                    tareaId: pendiente.pendienteId,
                                    tareaNombre: pendiente.nombre || 'Sin nombre',
                                    texto: pendiente.descripcion || pendiente.nombre || '',
                                    reportadoPor: {
                                        email: emailUsuario,
                                        nombre: nombreUsuario,
                                        esColaborador: true
                                    },
                                    fecha: pendiente.ultimaActualizacion || new Date(),
                                    duracionMin: pendiente.duracionMin || 0,
                                    prioridad: pendiente.prioridad || 'MEDIA',
                                    estado: pendiente.terminada ? 'COMPLETADA' : 'PENDIENTE'
                                });
                            }
                        }
                    }
                }
            }
        }

        console.log(`✅ Encontrados ${reportesEncontrados.length} reportes en ${actividadesUnicas.size} actividades`);

        // 3. Agrupar reportes por actividad
        const reportesPorActividad = {};
        reportesEncontrados.forEach(reporte => {
            const key = `${reporte.actividadId}-${reporte.actividadTitulo}`;
            if (!reportesPorActividad[key]) {
                reportesPorActividad[key] = {
                    actividadId: reporte.actividadId,
                    actividadTitulo: reporte.actividadTitulo,
                    reportes: []
                };
            }
            reportesPorActividad[key].reportes.push(reporte);
        });

        // 4. Ordenar reportes por fecha (más reciente primero)
        Object.keys(reportesPorActividad).forEach(key => {
            reportesPorActividad[key].reportes.sort((a, b) =>
                new Date(b.fecha) - new Date(a.fecha)
            );
        });

        // Convertir a array
        const actividadesConReportes = Object.values(reportesPorActividad);

        // 5. Devolver resultados
        res.json({
            success: true,
            count: reportesEncontrados.length,
            actividades: actividadesConReportes.length,
            colaboradores: Array.from(colaboradoresUnicos),
            data: actividadesConReportes,
            info: {
                actividadBuscada: actividadId || 'Todas',
                tareaBuscada: tareaId || 'Todas',
                totalDocumentosRevisados: todosLosDocumentos.length,
                actividadesEncontradas: Array.from(actividadesUnicas),
                fecha: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({
            success: false,
            error: "Error al buscar reportes por actividad",
            detalle: error.message
        });
    }
}