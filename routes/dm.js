import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import DMExpense from "../models/DMExpense.js";
import SocialMetrics from "../models/SocialMetrics.js";
import SEOWork from "../models/SEOWork.js";

const router = express.Router();

router.get(`/euhan`);
async () => {
  return res.json({ message: "hello world" });
};

/** -------- Expense (DM only) -------- */
router.get(
  "/expense",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin"]),
  async (req, res) => {
    const items = await DMExpense.find().sort({ date: -1 });
    return res.json({ items });
  }
);

router.post(
  "/expense",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const { date, purpose, amount } = req.body || {};
    if (!date || !purpose || amount === undefined) {
      return res
        .status(400)
        .json({
          code: "VALIDATION_ERROR",
          message: "date, purpose, amount required",
        });
    }
    const item = await DMExpense.create({
      date: new Date(date),
      purpose,
      amount: Number(amount),
      addedBy: req.user.id,
    });
    return res.status(201).json({ item });
  }
);

router.delete(
  "/expense/:id",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const it = await DMExpense.findById(req.params.id);
    if (!it)
      return res
        .status(404)
        .json({ code: "NOT_FOUND", message: "Expense not found" });
    await it.deleteOne();
    return res.json({ ok: true });
  }
);

/** -------- Social metrics (DM only write; SA/Admin read) -------- */
router.get(
  "/social",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin"]),
  async (req, res) => {
    const latest = await SocialMetrics.findOne().sort({ updatedAt: -1 });
    return res.json({
      metrics: latest?.metrics || {},
      updatedAt: latest?.updatedAt || null,
    });
  }
);

router.put(
  "/social",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const payload = req.body?.metrics || {};
    const doc = await SocialMetrics.create({
      metrics: payload,
      updatedBy: req.user.id,
    });
    return res.json({ metrics: doc.metrics, updatedAt: doc.updatedAt });
  }
);

/** -------- SEO reports (DM only write; SA/Admin read) -------- */
router.get(
  "/seo",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin"]),
  async (req, res) => {
    const items = await SEOWork.find().sort({ date: -1 });
    return res.json({ items });
  }
);

router.post(
  "/seo",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const { date, typeOfWork, challenge, details } = req.body || {};
    if (!date || !typeOfWork)
      return res
        .status(400)
        .json({
          code: "VALIDATION_ERROR",
          message: "date and typeOfWork required",
        });
    const it = await SEOWork.create({
      date: new Date(date),
      typeOfWork,
      challenge: challenge || "",
      details: details || "",
      addedBy: req.user.id,
    });
    return res.status(201).json({ item: it });
  }
);

export default router;
