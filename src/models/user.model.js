import mongoose from "mongoose";

const preferenciasSchema = new mongoose.Schema(
    {
        velocidadVoz: { type: Number, default: 1.0 },
        idiomaVoz: { type: String, default: "es-MX" },
        modoAsistenteIA: { type: String, default: "normal" },
        notificaciones: {
            email: { type: Boolean, default: true },
            push: { type: Boolean, default: false },
        },
        tema: { type: String, enum: ["light", "dark", "system"], default: "system" },
    },
    { _id: false }
);

const keysSchema = new mongoose.Schema(
    {
        groq: { type: [String], default: [] },
        gemini: { type: String, default: "" },
    },
    { _id: false }
);

const userSchema = new mongoose.Schema(
    {
        odooUserId: { type: String, required: true, unique: true },
        email: { type: String, required: true, unique: true },
        firstName: { type: String, default: "" },
        lastName: { type: String, default: "" },
        role: {
            type: String,
            enum: ["admin", "colaborador", "practicante"],
            default: "colaborador",
        },
        preferencias: { type: preferenciasSchema, default: () => ({}) },
        keys: { type: keysSchema, default: () => ({}) },
        actividades: { type: mongoose.Schema.Types.ObjectId, ref: "Actividades" },
        ultimoAcceso: { type: Date, default: null },
        activo: { type: Boolean, default: false },
    },
    {
        timestamps: true,
        collection: "users",
    }
);

userSchema.index({ email: 1 });
userSchema.index({ odooUserId: 1 });
userSchema.index({ role: 1 });
userSchema.index({ activo: 1 });

userSchema.virtual("nombreCompleto").get(function () {
    return `${this.first_name} ${this.last_name}`.trim();
});

userSchema.methods.registrarAcceso = function () {
    this.ultimoAcceso = new Date();
    return this.save();
};

export default mongoose.model("User", userSchema);