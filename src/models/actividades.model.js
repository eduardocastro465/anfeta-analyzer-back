import mongoose from "mongoose";

// 🔥 ESQUEMA PARA METADATOS DE EXPLICACIÓN DE VOZ
const explicacionVozSchema = new mongoose.Schema(
  {
    texto: String,
    emailUsuario: String,
    fechaRegistro: { type: Date, default: Date.now },
    validadaPorIA: { type: Boolean, default: false },
    razonIA: String,
    metadata: {
      sessionId: String,
      duracionMin: Number,
      prioridad: String,
      fuente: { type: String, default: "voz-a-texto" },
      version: { type: String, default: "1.0" },
      dispositivo: String,
      lenguaje: { type: String, default: "es-MX" }
    }
  },
  { _id: false }
);

// 🔥 ESQUEMA PARA HISTORIAL DE EXPLICACIONES
const historialExplicacionSchema = new mongoose.Schema(
  {
    texto: String,
    emailUsuario: String,
    fecha: { type: Date, default: Date.now },
    validadaPorIA: { type: Boolean, default: false },
    razonIA: String,
    sessionId: String,
    resultado: {
      esValida: Boolean,
      puntuacion: Number,
      feedback: String
    }
  },
  { _id: false }
);

// 🔥 ESQUEMA PARA PENDIENTE (ACTUALIZADO)
const pendienteSchema = new mongoose.Schema(
  {
    pendienteId: String,
    nombre: String,
    descripcion: String,
    queHizo: String,
    terminada: { type: Boolean, default: false },
    confirmada: { type: Boolean, default: false },
    duracionMin: { type: Number, default: 0 },
    fechaCreacion: Date,
    fechaFinTerminada: Date,
    motivoNoCompletado: { type: String, default: "" },

    // 🔥 NUEVOS CAMPOS PARA VOZ
    prioridad: { type: String, enum: ['ALTA', 'MEDIA', 'BAJA', 'URGENTE'], default: 'MEDIA' },

    // 🔥 CAMPOS DE AUDITORÍA Y SEGUIMIENTO
    ultimaActualizacion: { type: Date, default: Date.now },
    actualizadoPor: String, // Email del usuario que actualizó
    revisadoPorVoz: { type: Boolean, default: false },
    fechaRevisionVoz: Date,
    vecesExplicado: { type: Number, default: 0 },
    ultimaExplicacionFecha: Date,

    // 🔥 EXPLICACIÓN DE VOZ ACTUAL
    explicacionVoz: explicacionVozSchema,

    // 🔥 HISTORIAL COMPLETO DE EXPLICACIONES
    historialExplicaciones: [historialExplicacionSchema],

    // 🔥 ESTADÍSTICAS DE USO
    tiempoTotalExplicacion: { type: Number, default: 0 }, // en segundos
    intentosValidacion: { type: Number, default: 0 },
    intentosExitosos: { type: Number, default: 0 },

    // 🔥 FLAGS ADICIONALES
    requiereAtencion: { type: Boolean, default: false },
    complejidad: { type: String, enum: ['BAJA', 'MEDIA', 'ALTA'], default: 'MEDIA' },
    tags: [String] // Etiquetas para categorización
  },
  { _id: false }
);

// 🔥 ESQUEMA PARA ACTIVIDAD (ACTUALIZADO)
const actividadSchema = new mongoose.Schema(
  {
    actividadId: { type: String, required: true },
    titulo: String,
    tituloProyecto: String,
    horaInicio: String,
    horaFin: String,
    status: String,
    fecha: String,
    pendientes: [pendienteSchema],
    ultimaActualizacion: { type: Date, default: Date.now },

    // 🔥 NUEVOS CAMPOS PARA VOZ
    actualizadoPor: String, // Email del usuario que actualizó
    fechaRevisionVoz: Date,
    totalExplicacionesVoz: { type: Number, default: 0 },
    completadaPorVoz: { type: Boolean, default: false },

    // 🔥 METADATOS ADICIONALES
    contexto: String, // Contexto adicional de la actividad
    ubicacion: String, // Ubicación o entorno
    herramientas: [String], // Herramientas utilizadas

    // 🔥 ESTADÍSTICAS
    tiempoTotalEstimado: Number, // en minutos
    tiempoRealUtilizado: Number, // en minutos
    eficiencia: Number, // porcentaje

    // 🔥 FLAGS
    requiereFeedback: { type: Boolean, default: false },
    prioridadGlobal: { type: String, enum: ['ALTA', 'MEDIA', 'BAJA'], default: 'MEDIA' }
  },
  { _id: false }
);

// 🔥 ESQUEMA PRINCIPAL (ACTUALIZADO)
const actividadesSchema = new mongoose.Schema(
  {
    odooUserId: { type: String, required: true },
    emailUsuario: String, // Email principal del usuario
    nombreUsuario: String, // Nombre completo

    actividades: [actividadSchema],
    ultimaSincronizacion: { type: Date, default: Date.now },

    // 🔥 METADATOS GLOBALES DE VOZ
    fechaPrimeraExplicacion: Date,
    fechaUltimaExplicacion: Date,
    totalExplicacionesVoz: { type: Number, default: 0 },
    totalExplicacionesValidadas: { type: Number, default: 0 },
    totalExplicacionesRechazadas: { type: Number, default: 0 },

    // 🔥 SESIONES DE VOZ
    sesionesVoz: [{
      sessionId: String,
      fechaInicio: Date,
      fechaFin: Date,
      totalPendientes: Number,
      pendientesExplicados: Number,
      duracionTotal: Number, // en segundos
      dispositivo: String,
      estado: { type: String, enum: ['COMPLETADA', 'INTERRUMPIDA', 'ERROR'], default: 'COMPLETADA' }
    }],

    // 🔥 ESTADÍSTICAS GLOBALES
    estadisticas: {
      totalActividades: { type: Number, default: 0 },
      totalPendientes: { type: Number, default: 0 },
      pendientesConExplicacion: { type: Number, default: 0 },
      pendientesCompletadosVoz: { type: Number, default: 0 },
      tiempoTotalExplicacion: { type: Number, default: 0 }, // en segundos
      promedioExplicacionPorPendiente: Number, // en segundos
      eficienciaGlobal: Number, // porcentaje
      ultimaSessionId: String,
      fechaUltimaEstadistica: Date
    },

    // 🔥 PREFERENCIAS DE USUARIO
    preferencias: {
      velocidadVoz: { type: Number, default: 1.0, min: 0.5, max: 2.0 },
      idiomaVoz: { type: String, default: "es-MX" },
      notificaciones: {
        email: { type: Boolean, default: false },
        push: { type: Boolean, default: true }
      },
      tema: { type: String, enum: ['CLARO', 'OSCURO', 'AUTO'], default: 'AUTO' }
    },

    // 🔥 AUDITORÍA
    metadata: {
      versionApp: String,
      sistemaOperativo: String,
      navegador: String,
      ipRegistro: String,
      fechaRegistro: { type: Date, default: Date.now }
    }
  },
  {
    timestamps: true, // Crea createdAt y updatedAt automáticamente
    collection: 'actividades_con_explicaciones' // Nombre personalizado de colección
  }
);

// 🔥 ÍNDICES COMPLETOS PARA BÚSQUEDAS RÁPIDAS
actividadesSchema.index({ odooUserId: 1 });
actividadesSchema.index({ emailUsuario: 1 });
actividadesSchema.index({ "actividades.actividadId": 1 });
actividadesSchema.index({ "actividades.fecha": 1 });
actividadesSchema.index({ "actividades.pendientes.pendienteId": 1 });
actividadesSchema.index({ "actividades.pendientes.revisadoPorVoz": 1 });
actividadesSchema.index({ "actividades.pendientes.ultimaExplicacionFecha": -1 });
actividadesSchema.index({ fechaUltimaExplicacion: -1 });
actividadesSchema.index({ "sesionesVoz.sessionId": 1 });

// 🔥 MIDDLEWARE PARA ACTUALIZAR ESTADÍSTICAS
actividadesSchema.pre('save', async function (next) {
  const doc = this;

  // Actualizar estadísticas globales
  if (doc.actividades && doc.actividades.length > 0) {
    const totalActividades = doc.actividades.length;
    let totalPendientes = 0;
    let pendientesConExplicacion = 0;
    let pendientesCompletadosVoz = 0;

    doc.actividades.forEach(actividad => {
      if (actividad.pendientes) {
        totalPendientes += actividad.pendientes.length;

        actividad.pendientes.forEach(pendiente => {
          if (pendiente.explicacionVoz && pendiente.explicacionVoz.texto) {
            pendientesConExplicacion++;
          }
          if (pendiente.revisadoPorVoz) {
            pendientesCompletadosVoz++;
          }
        });
      }
    });

    doc.estadisticas.totalActividades = totalActividades;
    doc.estadisticas.totalPendientes = totalPendientes;
    doc.estadisticas.pendientesConExplicacion = pendientesConExplicacion;
    doc.estadisticas.pendientesCompletadosVoz = pendientesCompletadosVoz;
    doc.estadisticas.fechaUltimaEstadistica = new Date();

    // Calcular eficiencia global
    if (totalPendientes > 0) {
      doc.estadisticas.eficienciaGlobal = (pendientesConExplicacion / totalPendientes) * 100;
    }
  }

});

// 🔥 MÉTODOS DE INSTANCIA ÚTILES
actividadesSchema.methods.agregarSesionVoz = function (sesionData) {
  this.sesionesVoz.push(sesionData);
  this.fechaUltimaExplicacion = new Date();
  return this.save();
};

actividadesSchema.methods.obtenerExplicacionesPorEmail = function (email) {
  const explicaciones = [];

  this.actividades.forEach(actividad => {
    actividad.pendientes.forEach(pendiente => {
      if (pendiente.explicacionVoz && pendiente.explicacionVoz.emailUsuario === email) {
        explicaciones.push({
          actividad: actividad.titulo,
          pendiente: pendiente.nombre,
          explicacion: pendiente.explicacionVoz.texto,
          fecha: pendiente.explicacionVoz.fechaRegistro,
          validada: pendiente.explicacionVoz.validadaPorIA
        });
      }
    });
  });

  return explicaciones;
};

actividadesSchema.methods.actualizarEstadisticasUsuario = function () {
  const email = this.emailUsuario;
  let totalExplicaciones = 0;
  let totalValidadas = 0;
  let totalRechazadas = 0;

  this.actividades.forEach(actividad => {
    actividad.pendientes.forEach(pendiente => {
      if (pendiente.explicacionVoz && pendiente.explicacionVoz.emailUsuario === email) {
        totalExplicaciones++;
        if (pendiente.explicacionVoz.validadaPorIA) {
          totalValidadas++;
        } else {
          totalRechazadas++;
        }
      }
    });
  });

  this.totalExplicacionesVoz = totalExplicaciones;
  this.totalExplicacionesValidadas = totalValidadas;
  this.totalExplicacionesRechazadas = totalRechazadas;

  return this.save();
};

// 🔥 MÉTODO PARA OBTENER REPORTE COMPLETO
actividadesSchema.statics.generarReporteUsuario = async function (odooUserId, emailUsuario) {
  const usuario = await this.findOne({ odooUserId });

  if (!usuario) {
    throw new Error('Usuario no encontrado');
  }

  const reporte = {
    usuario: {
      odooUserId: usuario.odooUserId,
      email: usuario.emailUsuario,
      nombre: usuario.nombreUsuario
    },
    estadisticas: usuario.estadisticas,
    preferencias: usuario.preferencias,
    sesionesVoz: usuario.sesionesVoz.length,
    actividades: []
  };

  usuario.actividades.forEach(actividad => {
    const actividadReporte = {
      titulo: actividad.titulo,
      fecha: actividad.fecha,
      totalPendientes: actividad.pendientes.length,
      pendientesConExplicacion: actividad.pendientes.filter(p =>
        p.explicacionVoz && p.explicacionVoz.emailUsuario === emailUsuario
      ).length,
      pendientes: []
    };

    actividad.pendientes.forEach(pendiente => {
      if (pendiente.explicacionVoz && pendiente.explicacionVoz.emailUsuario === emailUsuario) {
        actividadReporte.pendientes.push({
          nombre: pendiente.nombre,
          explicacion: pendiente.explicacionVoz.texto,
          fecha: pendiente.explicacionVoz.fechaRegistro,
          validada: pendiente.explicacionVoz.validadaPorIA,
          duracion: pendiente.duracionMin
        });
      }
    });

    if (actividadReporte.pendientes.length > 0) {
      reporte.actividades.push(actividadReporte);
    }
  });

  return reporte;
};

const ActividadesSchema = mongoose.model("Actividades", actividadesSchema);

export default ActividadesSchema;