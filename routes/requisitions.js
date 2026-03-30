import express from 'express';
import Requisition from '../models/Requisition.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { notifyAccountants, notifyAdmins } from '../utils/notifications.js';

const router = express.Router();

// ========== STATIC ROUTES FIRST (before /:id) ==========

// Get approved requisitions for Accountant (pending payment)
router.get('/approved', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const requisitions = await Requisition.find({ status: 'Approved' })
      .populate('requestedBy', 'name email role designation')
      .populate('verifiedBy', 'name')
      .populate('approvedBy', 'name')
      .sort({ approvedAt: -1 });
    
    res.json({ requisitions });
  } catch (err) {
    console.error('Error fetching approved requisitions:', err);
    res.status(500).json({ message: 'Failed to fetch approved requisitions' });
  }
});

// Get paid requisitions history
router.get('/paid', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const requisitions = await Requisition.find({ status: 'Paid' })
      .populate('requestedBy', 'name email role designation')
      .populate('approvedBy', 'name')
      .populate('paidBy', 'name')
      .sort({ paidAt: -1 });
    
    res.json({ requisitions });
  } catch (err) {
    console.error('Error fetching paid requisitions:', err);
    res.status(500).json({ message: 'Failed to fetch paid requisitions' });
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

// Get approved count for accountant badge
router.get('/stats/approved', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const approvedCount = await Requisition.countDocuments({ status: 'Approved' });
    res.json({ approvedCount });
  } catch (err) {
    console.error('Error fetching approved count:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// ========== MAIN ROUTES ==========

// Get all requisitions (Admin/SuperAdmin see all, others see their own)
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = {};
    
    // If not Admin/SuperAdmin/Accountant, only show user's own requisitions
    if (!['Admin', 'SuperAdmin', 'Accountant'].includes(req.user.role)) {
      query.requestedBy = req.user._id;
    }
    
    const requisitions = await Requisition.find(query)
      .populate('requestedBy', 'name email role designation')
      .populate('verifiedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('paidBy', 'name')
      .sort({ createdAt: -1 });
    
    res.json({ requisitions });
  } catch (err) {
    console.error('Error fetching requisitions:', err);
    res.status(500).json({ message: 'Failed to fetch requisitions' });
  }
});

// Create new requisition
router.post('/', requireAuth, async (req, res) => {
  try {
    const { subject, department, items, totalAmount, amountInWords } = req.body;
    
    if (!department || !items || items.length === 0) {
      return res.status(400).json({ message: 'Department and at least one item are required' });
    }

    const requisition = await Requisition.create({
      subject: subject || '',
      requestedBy: req.user._id,
      department,
      items,
      totalAmount: Number(totalAmount) || items.reduce((sum, item) => sum + (item.estimatedCost || 0), 0),
      amountInWords,
      declaration: true
    });

    const populated = await Requisition.findById(requisition._id)
      .populate('requestedBy', 'name email role designation');

    // Notify Admins about new requisition for approval (don't let notification failure break the request)
    try {
      await notifyAdmins({
        sender: req.user._id,
        type: 'REQUISITION_SUBMITTED',
        title: 'New Requisition - Approval Needed',
        message: `${req.user.name} has submitted a requisition for ৳${requisition.totalAmount} (${department}). Please review and approve.`,
        link: '/requisition',
        relatedModel: 'Requisition',
        relatedId: requisition._id
      });
    } catch (notifErr) {
      console.error('Notification error (non-blocking):', notifErr.message);
    }
    
    res.status(201).json(populated);
  } catch (err) {
    console.error('Error creating requisition:', err);
    console.error('Error details:', err.message);
    if (err.errors) {
      console.error('Validation errors:', JSON.stringify(err.errors, null, 2));
    }
    res.status(500).json({ message: 'Failed to create requisition', error: err.message });
  }
});

// ========== DYNAMIC ROUTES (/:id) LAST ==========

// Get single requisition
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const requisition = await Requisition.findById(req.params.id)
      .populate('requestedBy', 'name email role designation')
      .populate('verifiedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('paidBy', 'name');
    
    if (!requisition) {
      return res.status(404).json({ message: 'Requisition not found' });
    }
    
    // Check if user can view this requisition
    if (!['Admin', 'SuperAdmin', 'Accountant'].includes(req.user.role) && 
        requisition.requestedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this requisition' });
    }
    
    res.json(requisition);
  } catch (err) {
    console.error('Error fetching requisition:', err);
    res.status(500).json({ message: 'Failed to fetch requisition' });
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

    // If approved, notify Accountants for payment
    if (status === 'Approved') {
      await notifyAccountants({
        sender: req.user._id,
        type: 'REQUISITION_SUBMITTED',
        title: 'Requisition Approved - Payment Needed',
        message: `Requisition by ${requisition.requestedBy?.name || 'Employee'} for ৳${requisition.totalAmount} has been approved. Please process the payment.`,
        link: '/accounting/requisition-request',
        relatedModel: 'Requisition',
        relatedId: requisition._id
      });
    }
    
    res.json(requisition);
  } catch (err) {
    console.error('Error updating requisition status:', err);
    res.status(500).json({ message: 'Failed to update requisition' });
  }
});

// Mark requisition as Paid (Accountant only)
router.patch('/:id/pay', requireAuth, authorize('Accountant', 'Admin', 'SuperAdmin'), async (req, res) => {
  try {
    const { paidAmount, paymentNote } = req.body;
    
    const requisition = await Requisition.findById(req.params.id);
    
    if (!requisition) {
      return res.status(404).json({ message: 'Requisition not found' });
    }
    
    if (requisition.status !== 'Approved') {
      return res.status(400).json({ message: 'Only approved requisitions can be marked as paid' });
    }
    
    const updated = await Requisition.findByIdAndUpdate(
      req.params.id,
      {
        status: 'Paid',
        paidBy: req.user._id,
        paidAt: new Date(),
        paidAmount: paidAmount || requisition.totalAmount,
        paymentNote: paymentNote || ''
      },
      { new: true }
    )
      .populate('requestedBy', 'name email role designation')
      .populate('approvedBy', 'name')
      .populate('paidBy', 'name');
    
    res.json(updated);
  } catch (err) {
    console.error('Error marking requisition as paid:', err);
    res.status(500).json({ message: 'Failed to mark as paid' });
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

export default router;
