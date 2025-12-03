// api/routes/recruitment.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

import Candidate from '../models/RecruitmentCandidate.js';
import Employer from '../models/RecruitmentEmployer.js';
import Job from '../models/RecruitmentJob.js';
import RIncome from '../models/RecruitmentIncome.js';
import RExpense from '../models/RecruitmentExpense.js';

const router = express.Router();

// ---------- Utils ----------
function pad(num, size = 4) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}
async function nextId(model, prefix) {
  const count = await model.countDocuments();
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${pad(count + 1)}`;
}

// Capitalized roles to match your app
const R_VIEW = ['Recruitment', 'Admin', 'SuperAdmin'];
const R_WRITE = ['Recruitment']; // write ops only by Recruitment role

// ---------- Dashboard Stats ----------
router.get(
  '/stats',
  requireAuth,
  authorize(R_VIEW),
  async (_req, res) => {
    try {
      const totalRecruitment = await Candidate.countDocuments({ recruited: true });
      const pendingCandidate = await Candidate.countDocuments({ recruited: false });
      const activeJobPosition = await Job.countDocuments({ status: 'Active' });
      const totalEmployer = await Employer.countDocuments();

      const now = new Date();
      const series = [];
      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const cand = await Candidate.countDocuments({ createdAt: { $gte: start, $lt: end } });
        const rec = await Candidate.countDocuments({
          recruited: true,
          'recruitedMeta.date': { $gte: start, $lt: end }
        });
        series.push({ month: start.toISOString().slice(0, 7), candidates: cand, recruited: rec });
      }

      res.json({
        cards: { totalRecruitment, pendingCandidate, activeJobPosition, totalEmployer },
        series
      });
    } catch (e) {
      res.status(500).json({ message: e.message || 'Failed to load recruitment stats' });
    }
  }
);

// ---------- Candidates ----------
router.get(
  '/candidates',
  requireAuth,
  authorize(R_VIEW),
  async (req, res) => {
    const { status } = req.query; // 'pending' | 'recruited' | undefined
    const q = {};
    if (status === 'pending') q.recruited = false;
    if (status === 'recruited') q.recruited = true;

    const items = await Candidate.find(q)
      .sort({ createdAt: -1 })
      .populate({
        path: 'recruitedMeta.employer recruitedMeta.job',
        select: 'name position jobId empId'
      });
    res.json(items);
  }
);

router.post(
  '/candidates',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const { canId, name, phone, email, jobInterest, source, district, trained, cvLink, date } = req.body;
      // Use provided canId or generate one if not provided
      const finalCanId = canId && canId.trim() ? canId.trim() : await nextId(Candidate, 'CAN');
      const created = await Candidate.create({
        canId: finalCanId, name, phone, email, jobInterest, source, district, trained, cvLink, date
      });
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to create candidate' });
    }
  }
);

router.patch(
  '/candidates/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const updated = await Candidate.findByIdAndUpdate(req.params.id, req.body, { new: true });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to update candidate' });
    }
  }
);

router.delete(
  '/candidates/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      await Candidate.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to delete candidate' });
    }
  }
);

// Recruit action
router.post(
  '/candidates/:id/recruit',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const { employerId, jobId, date } = req.body;
      const emp = await Employer.findById(employerId);
      const job = await Job.findById(jobId);
      if (!emp || !job) return res.status(400).json({ message: 'Invalid employer or job' });

      const updated = await Candidate.findByIdAndUpdate(
        req.params.id,
        {
          recruited: true,
          recruitedMeta: { employer: emp._id, job: job._id, date: date || new Date() }
        },
        { new: true }
      );
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Recruit action failed' });
    }
  }
);

// ---------- Employers ----------
router.get(
  '/employers',
  requireAuth,
  authorize(R_VIEW),
  async (_req, res) => {
    const items = await Employer.find().sort({ name: 1 });
    res.json(items);
  }
);

router.post(
  '/employers',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const { empId, name, address, jobLocation, mouDate } = req.body;
      // Use provided empId or generate one if not provided
      const finalEmpId = empId && empId.trim() ? empId.trim() : await nextId(Employer, 'EMP');
      const created = await Employer.create({ empId: finalEmpId, name, address, jobLocation, mouDate });
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to create employer' });
    }
  }
);

router.patch(
  '/employers/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const updated = await Employer.findByIdAndUpdate(req.params.id, req.body, { new: true });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to update employer' });
    }
  }
);

router.delete(
  '/employers/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      await Employer.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to delete employer' });
    }
  }
);

// ---------- Jobs ----------
router.get(
  '/jobs',
  requireAuth,
  authorize(R_VIEW),
  async (_req, res) => {
    const items = await Job.find().sort({ createdAt: -1 }).populate('employer', 'name empId');
    res.json(items);
  }
);

router.post(
  '/jobs',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const { jobId, position, employerId, salaryRange, deadline, status } = req.body;
      const employer = await Employer.findById(employerId);
      if (!employer) return res.status(400).json({ message: 'Invalid employer' });
      // Use provided jobId or generate one if not provided
      const finalJobId = jobId && jobId.trim() ? jobId.trim() : await nextId(Job, 'JOB');
      const created = await Job.create({
        jobId: finalJobId, position, employer: employer._id, salaryRange, deadline, status
      });
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to create job' });
    }
  }
);

router.patch(
  '/jobs/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const updated = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to update job' });
    }
  }
);

router.delete(
  '/jobs/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      await Job.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to delete job' });
    }
  }
);

// ---------- Income ----------
router.get(
  '/income',
  requireAuth,
  authorize([...R_VIEW, 'Accountant']), // Accountant can also view
  async (req, res) => {
    try {
      const { status } = req.query; // 'Pending' | 'Approved' | 'Rejected'
      const query = {};
      if (status) query.status = status;
      
      const items = await RIncome.find(query)
        .sort({ date: -1, createdAt: -1 })
        .populate('submittedBy', 'name email role')
        .populate('approvedBy', 'name email role');
      res.json(items);
    } catch (e) {
      res.status(500).json({ message: e.message || 'Failed to load income' });
    }
  }
);

router.post(
  '/income',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const { date, source, amount, description } = req.body;
      const created = await RIncome.create({ 
        date, 
        source, 
        amount, 
        description,
        status: 'Pending',
        submittedBy: req.user.id 
      });
      const populated = await RIncome.findById(created._id)
        .populate('submittedBy', 'name email role');
      res.status(201).json(populated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to add income' });
    }
  }
);

// Approve income (Accountant only)
router.post(
  '/income/:id/approve',
  requireAuth,
  authorize(['Accountant', 'Admin', 'SuperAdmin']),
  async (req, res) => {
    try {
      const updated = await RIncome.findByIdAndUpdate(
        req.params.id,
        {
          status: 'Approved',
          approvedBy: req.user.id,
          approvedAt: new Date()
        },
        { new: true }
      ).populate('submittedBy approvedBy', 'name email role');
      
      if (!updated) return res.status(404).json({ message: 'Income not found' });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to approve income' });
    }
  }
);

// Reject income (Accountant only)
router.post(
  '/income/:id/reject',
  requireAuth,
  authorize(['Accountant', 'Admin', 'SuperAdmin']),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const updated = await RIncome.findByIdAndUpdate(
        req.params.id,
        {
          status: 'Rejected',
          approvedBy: req.user.id,
          approvedAt: new Date(),
          rejectionReason: reason || ''
        },
        { new: true }
      ).populate('submittedBy approvedBy', 'name email role');
      
      if (!updated) return res.status(404).json({ message: 'Income not found' });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to reject income' });
    }
  }
);

router.delete(
  '/income/:id',
  requireAuth,
  authorize([...R_WRITE, 'Admin', 'SuperAdmin']), // Only allow deletion by Recruitment, Admin, SuperAdmin
  async (req, res) => {
    try {
      await RIncome.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to delete income' });
    }
  }
);

// ---------- Expenses ----------
router.get(
  '/expenses',
  requireAuth,
  authorize(R_VIEW),
  async (_req, res) => {
    const items = await RExpense.find().sort({ date: -1, createdAt: -1 });
    res.json(items);
  }
);

router.post(
  '/expenses',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      const { date, purpose, amount } = req.body;
      const created = await RExpense.create({ date, purpose, amount });
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to add expense' });
    }
  }
);

router.delete(
  '/expenses/:id',
  requireAuth,
  authorize(R_WRITE),
  async (req, res) => {
    try {
      await RExpense.findByIdAndDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: e.message || 'Failed to delete expense' });
    }
  }
);

export default router;
