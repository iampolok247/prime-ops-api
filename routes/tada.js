import express from 'express';
import TADAApplication from '../models/TADAApplication.js';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// Employee: Submit TA/DA application (all roles except SuperAdmin)
router.post('/', requireAuth, authorize(['Admin', 'Accountant', 'Admission', 'Recruitment', 'DigitalMarketing', 'MotionGraphics']), async (req, res) => {
  try {
    const { applicationType, purpose, travelDate, destination, amount, description } = req.body;

    if (!applicationType || !purpose || !travelDate || !destination || !amount) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'All required fields must be filled' });
    }

    if (amount <= 0) {
      return res.status(400).json({ code: 'INVALID_AMOUNT', message: 'Amount must be greater than 0' });
    }

    const application = await TADAApplication.create({
      employee: req.user.id,
      applicationType,
      purpose,
      travelDate: new Date(travelDate),
      destination,
      amount: Number(amount),
      description,
      adminStatus: 'Pending',
      paymentStatus: 'Pending'
    });

    const populated = await TADAApplication.findById(application._id)
      .populate('employee', 'name email role');

    return res.status(201).json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Get own TA/DA applications
router.get('/my-applications', requireAuth, async (req, res) => {
  try {
    const applications = await TADAApplication.find({ employee: req.user.id })
      .sort({ createdAt: -1 })
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role')
      .populate('detailsRequestedBy', 'name email role');

    return res.json({ applications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Get all TA/DA applications for approval (with optional status filter)
router.get('/admin', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { adminStatus } = req.query;
    const query = {};
    if (adminStatus) query.adminStatus = adminStatus;

    const applications = await TADAApplication.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role')
      .populate('detailsRequestedBy', 'name email role');

    return res.json({ applications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Accountant: Get approved TA/DA applications for payment
router.get('/accountant', requireAuth, authorize(['Accountant', 'Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { paymentStatus } = req.query;
    
    // Accountant sees only approved applications
    const query = { adminStatus: 'Approved' };
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const applications = await TADAApplication.find(query)
      .sort({ adminReviewedAt: -1 })
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role');

    return res.json({ applications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Approve TA/DA application
router.patch('/:id/approve', requireAuth, authorize(['Admin']), async (req, res) => {
  try {
    const { adminReviewNote } = req.body;
    const application = await TADAApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.adminStatus !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: 'Application already reviewed' });
    }

    application.adminStatus = 'Approved';
    application.adminReviewedBy = req.user.id;
    application.adminReviewedAt = new Date();
    if (adminReviewNote) application.adminReviewNote = adminReviewNote;

    await application.save();

    const populated = await TADAApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role');

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Reject TA/DA application
router.patch('/:id/reject', requireAuth, authorize(['Admin']), async (req, res) => {
  try {
    const { adminReviewNote } = req.body;
    const application = await TADAApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.adminStatus !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: 'Application already reviewed' });
    }

    if (!adminReviewNote) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Rejection reason is required' });
    }

    application.adminStatus = 'Rejected';
    application.adminReviewedBy = req.user.id;
    application.adminReviewedAt = new Date();
    application.adminReviewNote = adminReviewNote;

    await application.save();

    const populated = await TADAApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role');

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Request more details for TA/DA application
router.patch('/:id/request-details', requireAuth, authorize(['Admin']), async (req, res) => {
  try {
    const { detailsRequested } = req.body;
    const application = await TADAApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.adminStatus !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: 'Application already reviewed' });
    }

    if (!detailsRequested) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Details request message is required' });
    }

    application.detailsRequested = detailsRequested;
    application.detailsRequestedAt = new Date();
    application.detailsRequestedBy = req.user.id;

    await application.save();

    const populated = await TADAApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role')
      .populate('detailsRequestedBy', 'name email role');

    // Create notification for the employee
    try {
      await Notification.create({
        recipient: application.employee,
        sender: req.user.id,
        type: 'TADA_DETAILS_REQUESTED',
        title: 'More Details Needed for TA/DA Application',
        message: `${req.user.name} has requested more information: ${detailsRequested}`,
        link: `/my-applications`,
        relatedModel: 'TADAApplication',
        relatedId: application._id
      });
    } catch (notifError) {
      console.error('❌ Failed to create notification:', notifError);
    }

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Accountant: Mark TA/DA as paid
router.patch('/:id/pay', requireAuth, authorize(['Accountant']), async (req, res) => {
  try {
    const { paymentNote } = req.body;
    const application = await TADAApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.adminStatus !== 'Approved') {
      return res.status(400).json({ code: 'NOT_APPROVED', message: 'Application must be approved by admin first' });
    }

    if (application.paymentStatus === 'Paid') {
      return res.status(400).json({ code: 'ALREADY_PAID', message: 'Payment already processed' });
    }

    application.paymentStatus = 'Paid';
    application.paidBy = req.user.id;
    application.paidAt = new Date();
    if (paymentNote) application.paymentNote = paymentNote;

    await application.save();

    const populated = await TADAApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role');

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Update own TADA application (only if pending)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { applicationType, purpose, travelDate, destination, amount, description } = req.body;
    
    const application = await TADAApplication.findOne({
      _id: req.params.id,
      employee: req.user.id
    });

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.adminStatus !== 'Pending') {
      return res.status(400).json({ code: 'CANNOT_EDIT', message: 'Cannot edit application that has been reviewed' });
    }

    // Update application
    application.applicationType = applicationType;
    application.purpose = purpose;
    application.travelDate = new Date(travelDate);
    application.destination = destination;
    application.amount = parseFloat(amount);
    application.description = description || '';

    await application.save();

    const populated = await TADAApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('adminReviewedBy', 'name email role')
      .populate('paidBy', 'name email role');

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Delete own TADA application (only if pending)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const application = await TADAApplication.findOne({
      _id: req.params.id,
      employee: req.user.id
    });

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.adminStatus !== 'Pending') {
      return res.status(400).json({ code: 'CANNOT_DELETE', message: 'Cannot delete application that has been reviewed' });
    }

    await TADAApplication.findByIdAndDelete(req.params.id);

    return res.json({ message: 'Application deleted successfully' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
