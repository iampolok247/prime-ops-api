import express from 'express';
import RecruitmentDue from '../models/RecruitmentDue.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// Get summary stats
router.get('/summary', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin', 'Accountant'), async (req, res) => {
  try {
    const totalDues = await RecruitmentDue.aggregate([
      { $group: { 
        _id: null, 
        totalAmount: { $sum: '$totalAmount' },
        paidAmount: { $sum: '$paidAmount' }
      }}
    ]);
    
    const pendingCount = await RecruitmentDue.countDocuments({ status: { $in: ['Pending', 'Partial'] } });
    const paidCount = await RecruitmentDue.countDocuments({ status: 'Paid' });
    
    const summary = totalDues[0] || { totalAmount: 0, paidAmount: 0 };
    summary.dueAmount = summary.totalAmount - summary.paidAmount;
    summary.pendingCount = pendingCount;
    summary.paidCount = paidCount;
    
    res.json(summary);
  } catch (err) {
    console.error('Error fetching recruitment due summary:', err);
    res.status(500).json({ message: 'Failed to fetch summary' });
  }
});

// Get all dues
router.get('/', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin', 'Accountant'), async (req, res) => {
  try {
    const { status, candidate } = req.query;
    let query = {};
    
    if (status && status !== 'all') {
      query.status = status;
    }
    if (candidate) {
      query.candidate = candidate;
    }
    
    const dues = await RecruitmentDue.find(query)
      .populate('candidate', 'name phone email')
      .populate('employer', 'name')
      .populate('job', 'title')
      .populate('createdBy', 'name')
      .populate('payments.receivedBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json({ dues });
  } catch (err) {
    console.error('Error fetching recruitment dues:', err);
    res.status(500).json({ message: 'Failed to fetch dues' });
  }
});

// Get single due
router.get('/:id', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin', 'Accountant'), async (req, res) => {
  try {
    const due = await RecruitmentDue.findById(req.params.id)
      .populate('candidate', 'name phone email')
      .populate('employer', 'name')
      .populate('job', 'title')
      .populate('createdBy', 'name')
      .populate('payments.receivedBy', 'name');
    
    if (!due) {
      return res.status(404).json({ message: 'Due not found' });
    }
    
    res.json(due);
  } catch (err) {
    console.error('Error fetching recruitment due:', err);
    res.status(500).json({ message: 'Failed to fetch due' });
  }
});

// Create new due
router.post('/', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const { candidate, employer, job, description, totalAmount, dueDate } = req.body;
    
    if (!candidate || !totalAmount) {
      return res.status(400).json({ message: 'Candidate and total amount are required' });
    }
    
    const due = await RecruitmentDue.create({
      candidate,
      employer,
      job,
      description,
      totalAmount: Number(totalAmount),
      dueDate: dueDate ? new Date(dueDate) : null,
      createdBy: req.user._id
    });
    
    const populated = await RecruitmentDue.findById(due._id)
      .populate('candidate', 'name phone email')
      .populate('employer', 'name')
      .populate('job', 'title')
      .populate('createdBy', 'name');
    
    res.status(201).json(populated);
  } catch (err) {
    console.error('Error creating recruitment due:', err);
    res.status(500).json({ message: 'Failed to create due' });
  }
});

// Add payment to due
router.post('/:id/payment', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin', 'Accountant'), async (req, res) => {
  try {
    const { amount, method, note } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }
    
    const due = await RecruitmentDue.findById(req.params.id);
    
    if (!due) {
      return res.status(404).json({ message: 'Due not found' });
    }
    
    const remainingDue = due.totalAmount - due.paidAmount;
    if (amount > remainingDue) {
      return res.status(400).json({ message: `Payment amount cannot exceed remaining due (${remainingDue})` });
    }
    
    due.payments.push({
      amount: Number(amount),
      method: method || 'Cash',
      note: note || '',
      receivedBy: req.user._id
    });
    
    due.paidAmount += Number(amount);
    await due.save();
    
    const populated = await RecruitmentDue.findById(due._id)
      .populate('candidate', 'name phone email')
      .populate('employer', 'name')
      .populate('job', 'title')
      .populate('createdBy', 'name')
      .populate('payments.receivedBy', 'name');
    
    res.json(populated);
  } catch (err) {
    console.error('Error adding payment:', err);
    res.status(500).json({ message: 'Failed to add payment' });
  }
});

// Update due
router.put('/:id', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const { description, totalAmount, dueDate } = req.body;
    
    const due = await RecruitmentDue.findById(req.params.id);
    
    if (!due) {
      return res.status(404).json({ message: 'Due not found' });
    }
    
    // Don't allow reducing total below paid amount
    if (totalAmount && Number(totalAmount) < due.paidAmount) {
      return res.status(400).json({ message: 'Total amount cannot be less than paid amount' });
    }
    
    if (description !== undefined) due.description = description;
    if (totalAmount) due.totalAmount = Number(totalAmount);
    if (dueDate !== undefined) due.dueDate = dueDate ? new Date(dueDate) : null;
    
    await due.save();
    
    const populated = await RecruitmentDue.findById(due._id)
      .populate('candidate', 'name phone email')
      .populate('employer', 'name')
      .populate('job', 'title')
      .populate('createdBy', 'name')
      .populate('payments.receivedBy', 'name');
    
    res.json(populated);
  } catch (err) {
    console.error('Error updating recruitment due:', err);
    res.status(500).json({ message: 'Failed to update due' });
  }
});

// Delete due (only if no payments made)
router.delete('/:id', requireAuth, authorize('Recruitment', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const due = await RecruitmentDue.findById(req.params.id);
    
    if (!due) {
      return res.status(404).json({ message: 'Due not found' });
    }
    
    if (due.paidAmount > 0) {
      return res.status(400).json({ message: 'Cannot delete due with existing payments' });
    }
    
    await RecruitmentDue.findByIdAndDelete(req.params.id);
    res.json({ message: 'Due deleted successfully' });
  } catch (err) {
    console.error('Error deleting recruitment due:', err);
    res.status(500).json({ message: 'Failed to delete due' });
  }
});

export default router;
