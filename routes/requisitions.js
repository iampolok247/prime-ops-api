import express from 'express';
import Requisition from '../models/Requisition.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// Get all requisitions (Admin/SuperAdmin see all, others see their own)
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = {};
    
    // If not Admin/SuperAdmin, only show user's own requisitions
    if (!['Admin', 'SuperAdmin'].includes(req.user.role)) {
      query.requestedBy = req.user._id;
    }
    
    const requisitions = await Requisition.find(query)
      .populate('requestedBy', 'name email role designation')
      .populate('verifiedBy', 'name')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json({ requisitions });
  } catch (err) {
    console.error('Error fetching requisitions:', err);
    res.status(500).json({ message: 'Failed to fetch requisitions' });
  }
});

// Get single requisition
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const requisition = await Requisition.findById(req.params.id)
      .populate('requestedBy', 'name email role designation')
      .populate('verifiedBy', 'name')
      .populate('approvedBy', 'name');
    
    if (!requisition) {
      return res.status(404).json({ message: 'Requisition not found' });
    }
    
    // Check if user can view this requisition
    if (!['Admin', 'SuperAdmin'].includes(req.user.role) && 
        requisition.requestedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this requisition' });
    }
    
    res.json(requisition);
  } catch (err) {
    console.error('Error fetching requisition:', err);
    res.status(500).json({ message: 'Failed to fetch requisition' });
  }
});

// Create new requisition
router.post('/', requireAuth, async (req, res) => {
  try {
    const { subject, department, items, totalAmount, amountInWords } = req.body;
    
    if (!subject || !department || !items || items.length === 0) {
      return res.status(400).json({ message: 'Subject, department and at least one item are required' });
    }

    const requisition = await Requisition.create({
      subject,
      requestedBy: req.user._id,
      department,
      items,
      totalAmount: Number(totalAmount) || items.reduce((sum, item) => sum + (item.estimatedCost || 0), 0),
      amountInWords,
      declaration: true
    });

    const populated = await Requisition.findById(requisition._id)
      .populate('requestedBy', 'name email role designation');
    
    res.status(201).json(populated);
  } catch (err) {
    console.error('Error creating requisition:', err);
    res.status(500).json({ message: 'Failed to create requisition' });
  }
});

// Update requisition status (Admin/SuperAdmin only)
router.patch('/:id/status', requireAuth, authorize('Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    
    if (!['Verified', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    const updateData = { status };
    
    if (status === 'Verified') {
      updateData.verifiedBy = req.user._id;
      updateData.verifiedAt = new Date();
    } else if (status === 'Approved') {
      updateData.approvedBy = req.user._id;
      updateData.approvedAt = new Date();
    } else if (status === 'Rejected') {
      updateData.rejectionReason = rejectionReason || '';
      updateData.approvedBy = req.user._id;
      updateData.approvedAt = new Date();
    }
    
    const requisition = await Requisition.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    )
      .populate('requestedBy', 'name email role designation')
      .populate('verifiedBy', 'name')
      .populate('approvedBy', 'name');
    
    if (!requisition) {
      return res.status(404).json({ message: 'Requisition not found' });
    }
    
    res.json(requisition);
  } catch (err) {
    console.error('Error updating requisition status:', err);
    res.status(500).json({ message: 'Failed to update requisition' });
  }
});

// Delete requisition (only own pending requisitions, or Admin/SuperAdmin)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const requisition = await Requisition.findById(req.params.id);
    
    if (!requisition) {
      return res.status(404).json({ message: 'Requisition not found' });
    }
    
    // Check permissions
    const isOwner = requisition.requestedBy.toString() === req.user._id.toString();
    const isAdmin = ['Admin', 'SuperAdmin'].includes(req.user.role);
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Not authorized to delete this requisition' });
    }
    
    // Only allow deletion of pending requisitions (unless admin)
    if (!isAdmin && requisition.status !== 'Pending') {
      return res.status(400).json({ message: 'Can only delete pending requisitions' });
    }
    
    await Requisition.findByIdAndDelete(req.params.id);
    res.json({ message: 'Requisition deleted' });
  } catch (err) {
    console.error('Error deleting requisition:', err);
    res.status(500).json({ message: 'Failed to delete requisition' });
  }
});

// Get pending count for admin badge
router.get('/stats/pending', requireAuth, authorize('Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const pendingCount = await Requisition.countDocuments({ status: 'Pending' });
    res.json({ pendingCount });
  } catch (err) {
    console.error('Error fetching pending count:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

export default router;
