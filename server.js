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
import previousIncomeRoutes from "./routes/previousIncome.js";
import requisitionsRoutes from "./routes/requisitions.js"; // Requisition system for all employees
import recruitmentDuesRoutes from "./routes/recruitmentDues.js"; // Recruitment due collection
import manualDuesRoutes from "./routes/manualDues.js"; // Manual due entry for coordinator
import attendanceRoutes from "./routes/attendance.js"; // OPS Attendance tracking
import seminarRoutes from "./routes/seminars.js";      // Seminar notices on dashboards
import metaLeadsRoutes from "./routes/metaLeads.js";   // Meta CRM — DM side + Make.com webhook + CAPI
import cron from "node-cron";
import { runFollowUpDueReminders } from "./jobs/followUpReminders.js";
import { sendPendingCapiEvents } from "./utils/metaCapi.js";

dotenv.config();

const app = express();

// ---------- Middlewares ----------
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// ---------- CORS ----------
// Use a whitelist and echo the incoming origin when allowed. Also explicitly
// handle preflight OPTIONS for all routes so proxies or load-balancers don't
// end up returning responses without CORS headers.
const defaultAllowed = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
  'https://ops.primeacademy.org',
  'https://www.ops.primeacademy.org',
  'https://ops-backend.primeacademy.org'
];

const rawClient = process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGINS;
const whitelist = rawClient ? rawClient.split(',').map(s => s.trim()) : defaultAllowed;

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl, server-to-server)
    if (!origin) return callback(null, true);
    if (whitelist.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    console.warn('[CORS] Rejected origin:', origin);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400
};

// TEMP: permissive CORS to restore connectivity while debugging 502.
// This allows any origin and returns CORS headers for preflight. Replace
// with a stricter whitelist once the origin health is confirmed.
app.use(cors({ origin: true, credentials: true }));
app.options('*', cors({ origin: true, credentials: true }));

// ---------- Health check ----------
// Multi-role system deployed
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
app.use("/api/previous-income", previousIncomeRoutes);
app.use("/api/requisitions", requisitionsRoutes);
app.use("/api/recruitment-dues", recruitmentDuesRoutes);
app.use("/api/manual-dues", manualDuesRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/seminars", seminarRoutes);
app.use("/api/meta-leads", metaLeadsRoutes); // Meta CRM — DM side + Make.com webhook + CAPI
// Meta CRM — Admission side: same admission pipeline router, backed by MetaCrmLead
app.use("/api/meta-crm/admission", (req, res, next) => { req.leadModel = 'MetaCrmLead'; next(); }, admissionRoutes);

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

    // Daily 9 AM BST (= 03:00 UTC) — notify counsellors of follow-ups due today
    cron.schedule('0 3 * * *', () => {
      console.log('[Cron] Triggering follow-up due reminders…');
      runFollowUpDueReminders().catch(e => console.error('[Cron] Follow-up reminders failed:', e.message));
    }, { timezone: 'UTC' });

    // Daily 11 PM BST (= 17:00 UTC) — send queued Meta CAPI (CRM) events.
    // Meta wants CRM events at least daily; failed sends stay pending and retry.
    cron.schedule('0 17 * * *', () => {
      console.log('[Cron] Sending pending Meta CAPI events…');
      sendPendingCapiEvents()
        .then(r => console.log('[Cron] Meta CAPI:', r.message || `${r.sent} sent, ${r.retrying} retrying, ${r.failed} failed`))
        .catch(e => console.error('[Cron] Meta CAPI send failed:', e.message));
    }, { timezone: 'UTC' });
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  });
// CI/CD trigger - Sun Mar 29 02:00:15 +06 2026
