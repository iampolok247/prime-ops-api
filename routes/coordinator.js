import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import Lead from '../models/Lead.js';
import AdmissionFee from '../models/AdmissionFee.js';
import DueFeesFollowUp from '../models/DueFeesFollowUp.js';
import DueCollection from '../models/DueCollection.js';

const router = express.Router();

const isCoordinator = (u) => u?.role === 'Coordinator';
const isAdmin = (u) => u?.role === 'Admin';
const isSA = (u) => u?.role === 'SuperAdmin';

/**
 * GET /api/coordinator/students-with-dues
 * List all admitted students who have due fees
 */
router.get('/students-with-dues', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user) && !isAdmin(req.user) && !isSA(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator, Admin, or SuperAdmin only' });
  }

  try {
    // Get all admitted students with fees
    const fees = await AdmissionFee.find({ status: 'Approved' })
      .populate('lead', 'leadId name phone email status admittedAt interestedCourse')
      .sort({ createdAt: -1 });

    // Filter only those with dues
    const studentsWithDues = fees.filter(f => (f.dueAmount || 0) > 0);

    return res.json({ students: studentsWithDues });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * GET /api/coordinator/payment-notifications
 * Get students whose nextPaymentDate is approaching or overdue
 */
router.get('/payment-notifications', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user) && !isAdmin(req.user) && !isSA(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator, Admin, or SuperAdmin only' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    // Get fees with dues and upcoming payment dates
    const fees = await AdmissionFee.find({
      status: 'Approved',
      dueAmount: { $gt: 0 },
      nextPaymentDate: { $lte: threeDaysFromNow }
    })
      .populate('lead', 'leadId name phone email')
      .sort({ nextPaymentDate: 1 });

    const notifications = fees.map(f => {
      const isOverdue = f.nextPaymentDate && new Date(f.nextPaymentDate) < today;
      const daysUntil = f.nextPaymentDate 
        ? Math.ceil((new Date(f.nextPaymentDate) - today) / (1000 * 60 * 60 * 24))
        : null;

      return {
        ...f.toObject(),
        isOverdue,
        daysUntil
      };
    });

    return res.json({ notifications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * GET /api/coordinator/student-history/:admissionFeeId
 * Get complete history of a student's admission fee including all follow-ups
 */
router.get('/student-history/:admissionFeeId', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user) && !isAdmin(req.user) && !isSA(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator, Admin, or SuperAdmin only' });
  }

  try {
    const admissionFee = await AdmissionFee.findById(req.params.admissionFeeId)
      .populate('lead', 'leadId name phone email status admittedAt interestedCourse')
      .populate('submittedBy', 'name email role');

    if (!admissionFee) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Admission fee not found' });
    }

    // Get all follow-ups for this admission fee
    const followUps = await DueFeesFollowUp.find({ admissionFee: req.params.admissionFeeId })
      .populate('coordinator', 'name email')
      .sort({ createdAt: -1 });

    return res.json({ 
      admissionFee,
      followUps
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * POST /api/coordinator/add-follow-up
 * Record a follow-up contact with a student
 */
router.post('/add-follow-up', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator only' });
  }

  try {
    const { admissionFeeId, leadId, followUpType, note, amountPromised, updatedNextPaymentDate } = req.body || {};

    if (!admissionFeeId || !leadId || !followUpType || !note) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Missing required fields' });
    }

    const admissionFee = await AdmissionFee.findById(admissionFeeId);
    if (!admissionFee) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Admission fee not found' });
    }

    // Create follow-up record
    const followUp = await DueFeesFollowUp.create({
      admissionFee: admissionFeeId,
      lead: leadId,
      coordinator: req.user.id,
      followUpType,
      note,
      previousNextPaymentDate: admissionFee.nextPaymentDate,
      updatedNextPaymentDate: updatedNextPaymentDate ? new Date(updatedNextPaymentDate) : null,
      amountPromised: amountPromised || 0,
      contactedAt: new Date()
    });

    // If next payment date is updated, update the admission fee
    if (updatedNextPaymentDate) {
      admissionFee.nextPaymentDate = new Date(updatedNextPaymentDate);
      await admissionFee.save();
    }

    const populated = await DueFeesFollowUp.findById(followUp._id)
      .populate('coordinator', 'name email')
      .populate('lead', 'leadId name');

    return res.status(201).json({ followUp: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * PATCH /api/coordinator/update-payment-date/:admissionFeeId
 * Update next payment date for a student
 */
router.patch('/update-payment-date/:admissionFeeId', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator only' });
  }

  try {
    const { nextPaymentDate } = req.body || {};

    if (!nextPaymentDate) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'nextPaymentDate is required' });
    }

    const admissionFee = await AdmissionFee.findById(req.params.admissionFeeId);
    if (!admissionFee) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Admission fee not found' });
    }

    admissionFee.nextPaymentDate = new Date(nextPaymentDate);
    await admissionFee.save();

    const populated = await AdmissionFee.findById(admissionFee._id)
      .populate('lead', 'leadId name phone email');

    return res.json({ admissionFee: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * GET /api/coordinator/dashboard-stats
 * Get statistics for coordinator dashboard
 */
router.get('/dashboard-stats', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user) && !isAdmin(req.user) && !isSA(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator, Admin, or SuperAdmin only' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Total students with dues
    const totalWithDues = await AdmissionFee.countDocuments({
      status: 'Approved',
      dueAmount: { $gt: 0 }
    });

    // Overdue payments
    const overdue = await AdmissionFee.countDocuments({
      status: 'Approved',
      dueAmount: { $gt: 0 },
      nextPaymentDate: { $lt: today }
    });

    // Due this week
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const dueThisWeek = await AdmissionFee.countDocuments({
      status: 'Approved',
      dueAmount: { $gt: 0 },
      nextPaymentDate: { $gte: today, $lte: weekFromNow }
    });

    // Total due amount
    const feesWithDues = await AdmissionFee.find({
      status: 'Approved',
      dueAmount: { $gt: 0 }
    });
    const totalDueAmount = feesWithDues.reduce((sum, f) => sum + (f.dueAmount || 0), 0);

    // My follow-ups today (if coordinator)
    let myFollowUpsToday = 0;
    if (isCoordinator(req.user)) {
      const todayStart = new Date(today);
      const todayEnd = new Date(today);
      todayEnd.setDate(todayEnd.getDate() + 1);
      
      myFollowUpsToday = await DueFeesFollowUp.countDocuments({
        coordinator: req.user.id,
        createdAt: { $gte: todayStart, $lt: todayEnd }
      });
    }

    return res.json({
      totalWithDues,
      overdue,
      dueThisWeek,
      totalDueAmount,
      myFollowUpsToday
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * POST /api/coordinator/collect-due
 * Record a due payment collection
 */
router.post('/collect-due', requireAuth, async (req, res) => {
  if (!isCoordinator(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Coordinator only' });
  }

  try {
    const { admissionFeeId, additionalPayment, paymentMethod, paymentDate, nextPaymentDate, note } = req.body || {};

    if (!admissionFeeId || !additionalPayment || additionalPayment <= 0) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid payment data' });
    }

    const admissionFee = await AdmissionFee.findById(admissionFeeId);
    if (!admissionFee) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Admission fee not found' });
    }

    if (additionalPayment > admissionFee.dueAmount) {
      return res.status(400).json({ code: 'INVALID_AMOUNT', message: 'Cannot collect more than due amount' });
    }

    // Create a DueCollection record that requires accountant approval
    const dueCollection = await DueCollection.create({
      admissionFee: admissionFee._id,
      lead: admissionFee.lead,
      coordinator: req.user.id,
      amount: Number(additionalPayment),
      paymentMethod: paymentMethod || 'Cash',
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      nextPaymentDate: nextPaymentDate ? new Date(nextPaymentDate) : null,
      note: note || '',
      status: 'Pending',
      submittedAt: new Date()
    });

    // Also create a follow-up record for tracking
    const collectionNote = `Submitted due collection of ৳${additionalPayment} (Pending Approval)${note ? ` - ${note}` : ''}`;
    await DueFeesFollowUp.create({
      admissionFee: admissionFee._id,
      lead: admissionFee.lead,
      coordinator: req.user.id,
      followUpType: 'Other',
      note: collectionNote,
      amountPromised: Number(additionalPayment),
      contactedAt: new Date()
    });

    const populated = await DueCollection.findById(dueCollection._id)
      .populate('lead', 'leadId name phone email')
      .populate('coordinator', 'name email');

    return res.json({ 
      dueCollection: populated, 
      message: 'Due collection submitted for accountant approval' 
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
