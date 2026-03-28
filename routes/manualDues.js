// routes/manualDues.js
import express from 'express';
import ManualDue from '../models/ManualDue.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// GET /api/manual-dues/summary - Dashboard summary
router.get('/summary', auth, async (req, res) => {
  try {
    const dues = await ManualDue.find();
    
    const totalAmount = dues.reduce((sum, d) => sum + d.totalAmount, 0);
    const paidAmount = dues.reduce((sum, d) => sum + d.paidAmount, 0);
    const dueAmount = totalAmount - paidAmount;
    const pendingCount = dues.filter(d => d.status !== 'Paid').length;
    
    // Pending approvals count
    let pendingApprovals = 0;
    dues.forEach(d => {
      pendingApprovals += d.payments.filter(p => p.status === 'Pending').length;
    });
    
    res.json({ totalAmount, paidAmount, dueAmount, pendingCount, pendingApprovals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manual-dues/pending-approvals - Get all pending payment approvals (for Accountant)
router.get('/pending-approvals', auth, async (req, res) => {
  try {
    const dues = await ManualDue.find({ 'payments.status': 'Pending' })
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name');
    
    // Flatten to get pending payments with due info
    const pendingPayments = [];
    dues.forEach(due => {
      due.payments.forEach((payment, index) => {
        if (payment.status === 'Pending') {
          pendingPayments.push({
            dueId: due._id,
            paymentIndex: index,
            payment: payment,
            studentName: due.studentName,
            studentPhone: due.studentPhone,
            courseName: due.courseName,
            leadId: due.leadId,
            totalAmount: due.totalAmount,
            paidAmount: due.paidAmount,
            dueAmount: due.dueAmount
          });
        }
      });
    });
    
    res.json({ pendingPayments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manual-dues - List all manual dues
router.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    
    const dues = await ManualDue.find(filter)
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name')
      .populate('payments.approvedBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json({ dues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manual-dues/:id - Get single due
router.get('/:id', auth, async (req, res) => {
  try {
    const due = await ManualDue.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name')
      .populate('payments.approvedBy', 'name');
    
    if (!due) return res.status(404).json({ error: 'Due not found' });
    res.json(due);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manual-dues - Create new manual due entry (Coordinator)
router.post('/', auth, async (req, res) => {
  try {
    const { studentName, studentPhone, studentEmail, leadId, courseName, batchName, totalAmount, description, dueDate } = req.body;
    
    const due = new ManualDue({
      studentName,
      studentPhone,
      studentEmail,
      leadId,
      courseName,
      batchName,
      totalAmount,
      description,
      dueDate,
      createdBy: req.user._id
    });
    
    await due.save();
    res.status(201).json(due);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manual-dues/:id/collect - Collect payment (Coordinator) - needs approval
router.post('/:id/collect', auth, async (req, res) => {
  try {
    const { amount, method, note } = req.body;
    const due = await ManualDue.findById(req.params.id);
    
    if (!due) return res.status(404).json({ error: 'Due not found' });
    
    const remainingDue = due.totalAmount - due.paidAmount;
    if (amount > remainingDue) {
      return res.status(400).json({ error: `Amount exceeds remaining due (${remainingDue})` });
    }
    
    due.payments.push({
      amount,
      method: method || 'Cash',
      collectedBy: req.user._id,
      collectedAt: new Date(),
      status: 'Pending', // Needs accountant approval
      note
    });
    
    await due.save();
    
    const populated = await ManualDue.findById(due._id)
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name')
      .populate('payments.approvedBy', 'name');
    
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/manual-dues/:id/payment/:paymentIndex/approve - Approve payment (Accountant)
router.patch('/:id/payment/:paymentIndex/approve', auth, async (req, res) => {
  try {
    const due = await ManualDue.findById(req.params.id);
    if (!due) return res.status(404).json({ error: 'Due not found' });
    
    const paymentIndex = parseInt(req.params.paymentIndex);
    if (paymentIndex < 0 || paymentIndex >= due.payments.length) {
      return res.status(400).json({ error: 'Invalid payment index' });
    }
    
    due.payments[paymentIndex].status = 'Approved';
    due.payments[paymentIndex].approvedBy = req.user._id;
    due.payments[paymentIndex].approvedAt = new Date();
    
    await due.save(); // This will recalculate paidAmount and status
    
    const populated = await ManualDue.findById(due._id)
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name')
      .populate('payments.approvedBy', 'name');
    
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/manual-dues/:id/payment/:paymentIndex/reject - Reject payment (Accountant)
router.patch('/:id/payment/:paymentIndex/reject', auth, async (req, res) => {
  try {
    const { rejectionNote } = req.body;
    const due = await ManualDue.findById(req.params.id);
    if (!due) return res.status(404).json({ error: 'Due not found' });
    
    const paymentIndex = parseInt(req.params.paymentIndex);
    if (paymentIndex < 0 || paymentIndex >= due.payments.length) {
      return res.status(400).json({ error: 'Invalid payment index' });
    }
    
    due.payments[paymentIndex].status = 'Rejected';
    due.payments[paymentIndex].approvedBy = req.user._id;
    due.payments[paymentIndex].approvedAt = new Date();
    due.payments[paymentIndex].rejectionNote = rejectionNote || '';
    
    await due.save();
    
    const populated = await ManualDue.findById(due._id)
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name')
      .populate('payments.approvedBy', 'name');
    
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/manual-dues/:id - Update due entry
router.put('/:id', auth, async (req, res) => {
  try {
    const updates = req.body;
    const due = await ManualDue.findByIdAndUpdate(req.params.id, updates, { new: true })
      .populate('createdBy', 'name')
      .populate('payments.collectedBy', 'name')
      .populate('payments.approvedBy', 'name');
    
    if (!due) return res.status(404).json({ error: 'Due not found' });
    res.json(due);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/manual-dues/:id - Delete due (only if no approved payments)
router.delete('/:id', auth, async (req, res) => {
  try {
    const due = await ManualDue.findById(req.params.id);
    if (!due) return res.status(404).json({ error: 'Due not found' });
    
    const hasApprovedPayments = due.payments.some(p => p.status === 'Approved');
    if (hasApprovedPayments) {
      return res.status(400).json({ error: 'Cannot delete due with approved payments' });
    }
    
    await ManualDue.findByIdAndDelete(req.params.id);
    res.json({ message: 'Due deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
