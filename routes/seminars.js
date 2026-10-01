// Seminar notices — Digital Marketing posts, every logged-in employee reads.
// Upcoming/live seminars show on dashboards; ended ones move to the archive automatically.
import express from 'express';
import mongoose from 'mongoose';
import Seminar from '../models/Seminar.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logActivity } from './activities.js';

const router = express.Router();
const MANAGE_ROLES = ['DigitalMarketing', 'Admin', 'SuperAdmin'];

function cleanLink(link) {
  const v = String(link || '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function readBody(body = {}) {
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).trim();
  if (body.mentorName !== undefined) out.mentorName = String(body.mentorName).trim();
  if (body.hostName !== undefined) out.hostName = String(body.hostName).trim();
  if (body.meetingLink !== undefined) out.meetingLink = cleanLink(body.meetingLink);
  if (body.startAt !== undefined) out.startAt = new Date(body.startAt);
  if (body.durationMinutes !== undefined && body.durationMinutes !== '') out.durationMinutes = Number(body.durationMinutes);
  return out;
}

function validate(data, isCreate) {
  const required = ['title', 'mentorName', 'hostName', 'meetingLink', 'startAt'];
  for (const f of required) {
    if (isCreate && !data[f]) return `${f} is required`;
    if (!isCreate && f in data && !data[f]) return `${f} cannot be empty`;
  }
  if ('startAt' in data && Number.isNaN(data.startAt?.getTime?.())) return 'Invalid date/time';
  if ('meetingLink' in data) {
    try { new URL(data.meetingLink); } catch { return 'Invalid meeting link'; }
  }
  if ('durationMinutes' in data && (!Number.isFinite(data.durationMinutes) || data.durationMinutes < 15 || data.durationMinutes > 720)) {
    return 'Duration must be between 15 and 720 minutes';
  }
  return null;
}

// GET /api/seminars?view=upcoming|archived — any logged-in employee
router.get('/', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const archived = req.query.view === 'archived';
    const q = archived ? { endAt: { $lte: now } } : { endAt: { $gt: now } };
    const seminars = await Seminar.find(q)
      .sort({ startAt: archived ? -1 : 1 })
      .limit(archived ? 100 : 50)
      .populate('createdBy', 'name');
    return res.json({ seminars, now });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

router.post('/', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const data = readBody(req.body);
    const err = validate(data, true);
    if (err) return res.status(400).json({ code: 'VALIDATION_ERROR', message: err });

    const seminar = await Seminar.create({ ...data, createdBy: req.user.id });
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'CREATE', 'Seminar', seminar.title,
      `Posted seminar notice: ${seminar.title} (${seminar.startAt.toISOString()})`);
    return res.status(201).json({ seminar: await seminar.populate('createdBy', 'name') });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

router.patch('/:id', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Seminar not found' });
    const seminar = await Seminar.findById(req.params.id);
    if (!seminar) return res.status(404).json({ code: 'NOT_FOUND', message: 'Seminar not found' });

    const data = readBody(req.body);
    const err = validate(data, false);
    if (err) return res.status(400).json({ code: 'VALIDATION_ERROR', message: err });

    Object.assign(seminar, data, { updatedBy: req.user.id });
    await seminar.save();
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'Seminar', seminar.title,
      `Updated seminar notice: ${seminar.title}`);
    return res.json({ seminar: await seminar.populate('createdBy', 'name') });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

router.delete('/:id', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ code: 'NOT_FOUND', message: 'Seminar not found' });
    const seminar = await Seminar.findByIdAndDelete(req.params.id);
    if (!seminar) return res.status(404).json({ code: 'NOT_FOUND', message: 'Seminar not found' });
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'DELETE', 'Seminar', seminar.title,
      `Deleted seminar notice: ${seminar.title}`);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
