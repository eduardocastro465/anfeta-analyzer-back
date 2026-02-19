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
  transports: ["websocket", "polling"]
});

// Hacer io accesible en las rutas
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Manejar conexiones Socket.io
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  // Registrar usuario por email
  socket.on("registrar", (email) => {
    if (email) {
      socket.join(`usuario:${email}`);
      console.log(`Usuario ${email} registrado en sala usuario:${email}`);
      socket.emit("registrado", { email, sala: `usuario:${email}` });
    }
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