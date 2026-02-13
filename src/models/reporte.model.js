import mongoose from "mongoose";

const ReportePendienteSchema = new mongoose.Schema(
    {
        reporteId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        emailUsuario: {
            type: String,
            required: true,
            index: true
        },
        proyectoNombre: {
            type: String,
            required: true
        },

        actividadId: {
            type: String,
            required: true,
            index: true
        },

        actividadEstado: {
            type: String,
            default: "En proceso"
        },

        pendienteId: {
            type: String,
            required: true,
            index: true
        },

        pendienteNombre: {
            type: String,
            required: true
        },
        tipoReporte: {
            type: String,
            enum: ["completado", "pendiente", "cancelado"],
            required: true,
            index: true
        },

        texto: {
            type: String,
            required: true
        },


        estadoFinal: {
            type: String,
            enum: ["pendiente", "cancelado"],
            required: true
        },

        motivoNoCompletado: {
            type: String,
            required: true
        },

        prioridad: {
            type: String,
            enum: ["ALTA", "MEDIA", "BAJA"],
            default: "BAJA"
        },

        duracionMin: {
            type: Number,
            default: 0
        },

        fechaReporte: {
            type: Date,
            default: Date.now,
            index: true
        },
        validadaPorIA: {
            type: Boolean,
            default: false
        },

        razonIA: {
            type: String
        },

        confianzaIA: {
            type: Number,
            min: 0,
            max: 1
        },

        calidadExplicacion: {
            type: Number,
            min: 0,
            max: 100
        },
        sessionId: {
            type: String,
            index: true
        },

        encontradoEn: {
            type: String,
            enum: ["explicacionVoz", "historialExplicaciones", "reporteManual", "reporteTarde"],
            default: "reporteManual"
        }
    },
    {
        timestamps: true
    }
);
ReportePendienteSchema.index({ userId: 1, fechaReporte: -1 });
ReportePendienteSchema.index({ actividadId: 1, pendienteId: 1 });

export default mongoose.model(
    "ReportePendiente",
    ReportePendienteSchema
);