import express from 'express';
import Course from '../models/Course.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

const genCourseId = async () => {
  const count = await Course.countDocuments({});
  const n = (count + 1).toString().padStart(4, '0');
  return `CRS-${n}`;
};

// List (All roles except Accountant can view)
router.get('/', requireAuth, authorize(['Admin', 'SuperAdmin', 'DigitalMarketing', 'Admission', 'Recruitment', 'MotionGraphics']), async (req, res) => {
  const courses = await Course.find().sort({ createdAt: -1 });
  return res.json({ courses });
});

// Create (Admin + SuperAdmin)
router.post('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  const { name, category, duration, regularFee, discountFee, teacher, details } = req.body || {};
  if (!name) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Course name required' });

  const course = await Course.create({
    courseId: await genCourseId(),
    name, category, duration,
    regularFee: Number(regularFee || 0),
    discountFee: Number(discountFee || 0),
    teacher: teacher || '',
    details: details || '',
    status: 'Active'
  });
  return res.status(201).json({ course });
});

// Update (Admin + SuperAdmin)
router.put('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  const c = await Course.findById(req.params.id);
  if (!c) return res.status(404).json({ code: 'NOT_FOUND', message: 'Course not found' });

  const { name, category, duration, regularFee, discountFee, teacher, details, status } = req.body || {};
  if (name !== undefined) c.name = name;
  if (category !== undefined) c.category = category;
  if (duration !== undefined) c.duration = duration;
  if (regularFee !== undefined) c.regularFee = Number(regularFee);
  if (discountFee !== undefined) c.discountFee = Number(discountFee);
  if (teacher !== undefined) c.teacher = teacher;
  if (details !== undefined) c.details = details;
  if (status && ['Active', 'Inactive'].includes(status)) c.status = status;

  await c.save();
  return res.json({ course: c });
});

// Delete (Admin + SuperAdmin)
router.delete('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  const c = await Course.findById(req.params.id);
  if (!c) return res.status(404).json({ code: 'NOT_FOUND', message: 'Course not found' });
  await c.deleteOne();
  return res.json({ ok: true });
});

export default router;
