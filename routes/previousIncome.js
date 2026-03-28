import express from 'express';
import PreviousIncome from '../models/PreviousIncome.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// Get all previous income entries
router.get('/', requireAuth, async (req, res) => {
  try {
    const entries = await PreviousIncome.find()
      .populate('createdBy', 'name email')
      .sort({ date: -1 });
    res.json({ entries, total: entries.reduce((sum, e) => sum + (e.amount || 0), 0) });
  } catch (err) {
    console.error('Error fetching previous income:', err);
    res.status(500).json({ message: 'Failed to fetch previous income' });
  }
});

// Get summary (just total)
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const result = await PreviousIncome.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    res.json({ total: result[0]?.total || 0 });
  } catch (err) {
    console.error('Error fetching previous income summary:', err);
    res.status(500).json({ message: 'Failed to fetch summary' });
  }
});

// Create new previous income entry
router.post('/', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const { amount, description, date, category } = req.body;
    
    if (!amount || !description || !date) {
      return res.status(400).json({ message: 'Amount, description and date are required' });
    }

    const entry = await PreviousIncome.create({
      amount: Number(amount),
      description,
      date: new Date(date),
      category: category || 'Other',
      createdBy: req.user._id
    });

    const populated = await PreviousIncome.findById(entry._id).populate('createdBy', 'name email');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Error creating previous income:', err);
    res.status(500).json({ message: 'Failed to create entry' });
  }
});

// Update previous income entry
router.put('/:id', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const { amount, description, date, category } = req.body;
    
    const entry = await PreviousIncome.findByIdAndUpdate(
      req.params.id,
      { amount: Number(amount), description, date: new Date(date), category },
      { new: true }
    ).populate('createdBy', 'name email');

    if (!entry) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    res.json(entry);
  } catch (err) {
    console.error('Error updating previous income:', err);
    res.status(500).json({ message: 'Failed to update entry' });
  }
});

// Delete previous income entry
router.delete('/:id', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const entry = await PreviousIncome.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res.status(404).json({ message: 'Entry not found' });
    }
    res.json({ message: 'Entry deleted' });
  } catch (err) {
    console.error('Error deleting previous income:', err);
    res.status(500).json({ message: 'Failed to delete entry' });
  }
});

export default router;
