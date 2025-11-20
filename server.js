// api/server.js
import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./config/db.js";

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

dotenv.config();

const app = express();

// --- Security & middleware ---
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// In case you sometimes hit from multiple local origins, you can add them here
const ALLOWED_ORIGINS = [
  process.env.CLIENT_ORIGIN || "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "https://prime-ops.vercel.app",
  "https://prime-ops-jrpoloks-projects.vercel.app",
  "https://prime-i4fgju99s-jrpoloks-projects.vercel.app",
];
app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser tools like curl (no origin)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      // Also allow any vercel.app subdomain for this project
      if (
        origin &&
        origin.includes("prime-ops") &&
        origin.includes(".vercel.app")
      )
        return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);

app.get(`/`);
async (req, res) => {
  return res.json({ ok: true, message: "ci/cd" });
};

// --- Health check ---
app.get("/health", (req, res) =>
  res.json({ ok: true, service: "primeops-api" })
);

// --- Feature routes (order matters: mount before 404 handler) ---
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/dm", dmRoutes);
app.use("/api/admission", admissionRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/mg", mgRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/admission-targets", admissionTargetsRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/targets", targetsRoutes);
app.use("/api/coordinator", coordinatorRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/tada", tadaRoutes);
app.use("/api/notifications", notificationRoutes);

// --- Recruitment ---
app.use("/api/recruitment", recruitmentRoutes);

// --- 404 handler (keep after all routes) ---
app.use((req, res, next) => {
  res.status(404).json({ code: "NOT_FOUND", message: "Route not found" });
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error("Unhandled:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    code: err.code || "SERVER_ERROR",
    message: err.message || "Unexpected error",
  });
});

// --- Start server ---
const PORT = process.env.PORT || 5001;
connectDB(process.env.MONGO_URI).then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 API running on http://localhost:${PORT}`)
  );
});
