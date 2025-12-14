import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./config/db.js";
import { seedInitialUsers } from "./seed.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import taskRoutes from "./routes/tasks.js";
import courseRoutes from "./routes/courses.js";
import leadRoutes from "./routes/leads.js";
import dmRoutes from "./routes/dm.js";
import admissionRoutes from "./routes/admission.js";
import accountingRoutes from "./routes/accounting.js";
import reportsRoutes from "./routes/reports.js";
import recruitmentRoutes from "./routes/recruitment.js";
import mgRoutes from "./routes/mg.js";
import messagesRoutes from "./routes/messages.js";
import admissionTargetsRoutes from "./routes/admissionTargets.js";
import batchRoutes from "./routes/batches.js";
import targetsRoutes from "./routes/targets.js";
import coordinatorRoutes from "./routes/coordinator.js";
import leaveRoutes from "./routes/leave.js";
import tadaRoutes from "./routes/tada.js";
import notificationRoutes from "./routes/notifications.js";
import bankRoutes from "./routes/bank.js";
import activitiesRoutes from "./routes/activities.js";

dotenv.config();

const app = express();

// ---------- Middlewares ----------
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// ---------- CORS ----------
// In development, allow localhost on any port. In production, allow same origin.
const corsOrigin = process.env.NODE_ENV === 'development' 
  ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']
  : true;

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400, // 24 hours
  })
);

// ---------- Health check ----------
app.get("/healthi", (req, res) =>
  res.json({ ok: true, service: "primeops-api" })
);

// ---------- Routes ----------
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/dm", dmRoutes);
app.use("/api/admission", admissionRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/mg", mgRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/admission-targets", admissionTargetsRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/targets", targetsRoutes);
app.use("/api/coordinator", coordinatorRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/tada", tadaRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/recruitment", recruitmentRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/activities", activitiesRoutes);

// ---------- 404 Handler ----------
app.use((req, res) => {
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found" });
});

// ---------- Error Handler ----------
app.use((err, req, res, next) => {
  console.error("Unhandled:", err);
  res.status(err.status || 500).json({
    code: err.code || "SERVER_ERROR",
    message: err.message || "Unexpected error",
  });
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 5001;

connectDB(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");

    // Seed users AFTER DB connect
    await seedInitialUsers();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 API running on http://0.0.0.0:${PORT}`);
      console.log(`🚀 Accessible at http://31.97.228.226:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  });
