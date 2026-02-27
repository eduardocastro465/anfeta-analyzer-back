import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import { textoColorido } from "./src/utils/colorText.js";
import { CORS_ORIGINS, API_VERSION } from "./src/config.js";
import { connectDB } from "./src/database/db.js";
import { registerVoskSocket } from "./src/services/voskRealtimeService.js";
import NotificationService from "./src/services/notificationService.js"; // ← NUEVO

// Constantes
const modoProduction = process.env.NODE_ENV === "production";

// DB
await connectDB();
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

// Configurar Socket.io
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"]
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 1e7,
});

// Inicializar servicio de notificaciones ← NUEVO
const notificationService = new NotificationService(io);

// Hacer io y notificationService accesibles en las rutas ← MODIFICADO
app.use((req, res, next) => {
  req.io = io;
  req.notificationService = notificationService; // ← NUEVO
  next();
});

// Manejar conexiones Socket.io ← MODIFICADO
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.onAny((event, ...args) => {
    console.log(`[onAny] evento="${event}" socketId=${socket.id}`);
  });

  registerVoskSocket(socket);

  // Registrar usuario por email
  socket.on("registrar", (email) => {
    if (email) {
      socket.join(`usuario:${email}`);
      console.log(`Usuario ${email} registrado en sala usuario:${email}`);
      socket.emit("registrado", { 
        email, 
        sala: `usuario:${email}`,
        historial: notificationService.getUserNotifications(email) // ← NUEVO
      });

      // Enviar notificación de bienvenida ← NUEVO
      const bienvenida = notificationService.createNotification('info', {
        titulo: 'Bienvenido',
        mensaje: 'Te has conectado correctamente al sistema de notificaciones',
        timestamp: new Date().toISOString()
      });
      
      notificationService.sendToUser(email, bienvenida);
    }
  });

  // Marcar notificación como leída ← NUEVO
  socket.on("marcar-leida", (data) => {
    const { email, notificationId } = data;
    if (email && notificationId) {
      const marked = notificationService.markAsRead(email, notificationId);
      if (marked) {
        socket.emit("notificacion-marcada", { notificationId, success: true });
      }
    }
  });

  // Solicitar historial ← NUEVO
  socket.on("solicitar-historial", (email) => {
    if (email) {
      const historial = notificationService.getUserNotifications(email);
      socket.emit("historial-notificaciones", historial);
    }
  });

  // Unirse a sala específica ← NUEVO
  socket.on("unirse-sala", (sala) => {
    socket.join(sala);
    console.log(`Socket ${socket.id} unido a sala: ${sala}`);
  });

  // Manejar desconexión
  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });

  // Manejar errores
  socket.on("error", (error) => {
    console.error("Error en socket:", error);
  });
});

// CORS
app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// Middlewares base
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Logs solo en dev
if (!modoProduction) {
  app.use(morgan("dev"));
}

// Headers extra
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// Rutas
import adminRouter from "./src/routes/admin.routes.js";
import assistantRoutes from "./src/routes/assistant.routes.js";
import authRoutes from "./src/routes/auth.routes.js";
import reportesRoutes from "./src/routes/reportes.routes.js";

app.use(`/api/${API_VERSION}/assistant`, assistantRoutes);
app.use(`/api/${API_VERSION}/admin`, adminRouter);
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/reportes`, reportesRoutes);

// Server
server.listen(PORT, "0.0.0.0", () => {
  textoColorido(
    [`Servidor corriendo en el puerto: ${PORT}`],
    ["rgb(33, 97, 235)", "rgb(46, 15, 183)"],
    modoProduction
  );
});