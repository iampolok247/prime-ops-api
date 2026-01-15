// api/routes/mg.js
import { Router } from 'express';
import MGWork from '../models/MGWork.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

const canMG = ['MotionGraphics', 'Admin', 'SuperAdmin', 'HeadOfCreative'];

// --- Stats for MG dashboard ---
router.get('/stats', requireAuth, authorize(canMG), async (req, res, next) => {
  try {
    const [total, done, inProgress, queued] = await Promise.all([
      MGWork.countDocuments(),
      MGWork.countDocuments({ status: 'Done' }),
      MGWork.countDocuments({ status: 'InProgress' }),
      MGWork.countDocuments({ status: 'Queued' })
    ]);
    res.json({ total, done, inProgress, queued });
  } catch (e) { next(e); }
});

// --- List with optional filters ?date=YYYY-MM-DD&status=InProgress ---
router.get('/works', requireAuth, authorize(canMG), async (req, res, next) => {
  try {
    const { date, status } = req.query;
    const q = {};
    if (status) q.status = status;

    if (date) {
      const d = new Date(date);
      if (!isNaN(d)) {
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        q.date = { $gte: start, $lt: end };
      }
    }
    const list = await MGWork.find(q).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) { next(e); }
});

// --- Create ---
router.post('/works', requireAuth, authorize(canMG), async (req, res, next) => {
  try {
    const payload = { ...req.body, createdBy: req.user?.id };
    const work = await MGWork.create(payload);
    res.status(201).json(work);
  } catch (e) { next(e); }
});

// --- Update ---
router.patch('/works/:id', requireAuth, authorize(canMG), async (req, res, next) => {
  try {
    const updated = await MGWork.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

// --- Delete ---
router.delete('/works/:id', requireAuth, authorize(canMG), async (req, res, next) => {
  try {
    const del = await MGWork.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
