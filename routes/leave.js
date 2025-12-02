import express from 'express';
import LeaveApplication from '../models/LeaveApplication.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// Helper function to create notification
async function createNotification(data) {
  try {
    console.log('🔔 Creating notification:', { 
      recipient: data.recipient, 
      sender: data.sender,
      type: data.type, 
      title: data.title,
      message: data.message,
      link: data.link
    });
    
    // Verify recipient exists
    const recipientUser = await User.findById(data.recipient);
    if (!recipientUser) {
      console.error('❌ Recipient user not found:', data.recipient);
      throw new Error(`Recipient user not found: ${data.recipient}`);
    }
    console.log('✅ Recipient verified:', recipientUser.name, recipientUser.email);
    
    const notif = await Notification.create(data);
    console.log('✅ Notification saved to DB with ID:', notif._id);
    console.log('   - Recipient:', notif.recipient);
    console.log('   - Type:', notif.type);
    console.log('   - isRead:', notif.isRead);
    return notif;
  } catch (error) {
    console.error('❌ Error creating notification:', error.message);
    console.error('   Full error:', error);
    throw error;
  }
}

// Employee: Submit leave application (all roles except SuperAdmin)
router.post('/', requireAuth, authorize(['Admin', 'Accountant', 'Admission', 'Recruitment', 'DigitalMarketing', 'MotionGraphics', 'Coordinator']), async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason, handoverTo } = req.body;

    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'All fields are required' });
    }

    // Validate handoverTo if provided
    if (handoverTo) {
      const handoverEmployee = await User.findById(handoverTo);
      if (!handoverEmployee) {
        return res.status(400).json({ code: 'INVALID_HANDOVER', message: 'Handover employee not found' });
      }
      if (handoverEmployee.role === 'SuperAdmin') {
        return res.status(400).json({ code: 'INVALID_HANDOVER', message: 'Cannot handover to SuperAdmin' });
      }
      if (handoverTo === req.user.id) {
        return res.status(400).json({ code: 'INVALID_HANDOVER', message: 'Cannot handover to yourself' });
      }
    }

    // Calculate total days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days

    if (totalDays <= 0) {
      return res.status(400).json({ code: 'INVALID_DATES', message: 'End date must be after start date' });
    }

    const application = await LeaveApplication.create({
      employee: req.user.id,
      leaveType,
      startDate: start,
      endDate: end,
      totalDays,
      reason,
      handoverTo: handoverTo || null,
      handoverStatus: handoverTo ? 'Pending' : null,
      status: 'Pending'
    });

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role');

    // Send notification to handover employee if specified
    if (handoverTo) {
      try {
        console.log('📢 Creating handover notification for user ID:', handoverTo);
        const handoverNotif = await createNotification({
          recipient: handoverTo,
          sender: req.user.id,
          type: 'LEAVE_HANDOVER_REQUEST',
          title: 'Responsibility Handover Request',
          message: `${req.user.name} has requested you to handle their responsibilities during their leave from ${start.toLocaleDateString()} to ${end.toLocaleDateString()}`,
          link: `/my-applications`,
          relatedModel: 'LeaveApplication',
          relatedId: application._id
        });
        console.log('✅ Handover notification created with ID:', handoverNotif._id);
      } catch (notifError) {
        console.error('❌ Failed to create handover notification:', notifError);
      }
    }

    // Send notification to all admins about new leave application
    try {
      const admins = await User.find({ role: { $in: ['Admin', 'SuperAdmin'] }, isActive: true });
      console.log('📢 Found', admins.length, 'admins to notify:', admins.map(a => `${a.name} (${a._id})`).join(', '));
      
      for (const admin of admins) {
        try {
          const adminNotif = await createNotification({
            recipient: admin._id,
            sender: req.user.id,
            type: 'LEAVE_SUBMITTED',
            title: 'New Leave Application',
            message: `${req.user.name} has submitted a ${leaveType} application for ${totalDays} days`,
            link: `/admin/approvals`,
            relatedModel: 'LeaveApplication',
            relatedId: application._id
          });
          console.log('✅ Admin notification created for:', admin.name, 'with ID:', adminNotif._id);
        } catch (adminNotifError) {
          console.error('❌ Failed to create admin notification for', admin.name, ':', adminNotifError);
        }
      }
    } catch (adminsError) {
      console.error('❌ Failed to fetch admins:', adminsError);
    }

    return res.status(201).json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Get own leave applications
router.get('/my-applications', requireAuth, async (req, res) => {
  try {
    const applications = await LeaveApplication.find({ employee: req.user.id })
      .sort({ createdAt: -1 })
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role')
      .populate('detailsRequestedBy', 'name email role');

    return res.json({ applications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Get handover requests for me
router.get('/handover-requests', requireAuth, async (req, res) => {
  try {
    const requests = await LeaveApplication.find({ 
      handoverTo: req.user.id,
      handoverStatus: 'Pending'
    })
      .sort({ createdAt: -1 })
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role');

    return res.json({ requests });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Accept handover
router.patch('/:id/handover/accept', requireAuth, async (req, res) => {
  try {
    const { handoverNote } = req.body;
    const application = await LeaveApplication.findOne({
      _id: req.params.id,
      handoverTo: req.user.id
    });

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Handover request not found' });
    }

    if (application.handoverStatus !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_RESPONDED', message: 'Handover request already responded' });
    }

    application.handoverStatus = 'Accepted';
    application.handoverRespondedAt = new Date();
    if (handoverNote) application.handoverNote = handoverNote;

    await application.save();

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role');

    // Notify the employee who requested handover
    await createNotification({
      recipient: application.employee,
      sender: req.user.id,
      type: 'LEAVE_HANDOVER_ACCEPTED',
      title: 'Handover Request Accepted',
      message: `${req.user.name} has accepted your responsibility handover request`,
      link: `/my-applications`,
      relatedModel: 'LeaveApplication',
      relatedId: application._id
    });

    // Notify admins about handover acceptance
    const admins = await User.find({ role: { $in: ['Admin', 'SuperAdmin'] }, isActive: true });
    for (const admin of admins) {
      await createNotification({
        recipient: admin._id,
        sender: req.user.id,
        type: 'LEAVE_HANDOVER_ACCEPTED',
        title: 'Handover Accepted',
        message: `${req.user.name} accepted handover for ${populated.employee.name}'s leave application`,
        link: `/admin/approvals`,
        relatedModel: 'LeaveApplication',
        relatedId: application._id
      });
    }

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Deny handover
router.patch('/:id/handover/deny', requireAuth, async (req, res) => {
  try {
    const { handoverNote } = req.body;
    const application = await LeaveApplication.findOne({
      _id: req.params.id,
      handoverTo: req.user.id
    });

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Handover request not found' });
    }

    if (application.handoverStatus !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_RESPONDED', message: 'Handover request already responded' });
    }

    if (!handoverNote) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Denial reason is required' });
    }

    application.handoverStatus = 'Denied';
    application.handoverRespondedAt = new Date();
    application.handoverNote = handoverNote;

    await application.save();

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role');

    // Notify the employee who requested handover
    await createNotification({
      recipient: application.employee,
      sender: req.user.id,
      type: 'LEAVE_HANDOVER_DENIED',
      title: 'Handover Request Denied',
      message: `${req.user.name} has denied your responsibility handover request. Reason: ${handoverNote}`,
      link: `/my-applications`,
      relatedModel: 'LeaveApplication',
      relatedId: application._id
    });

    // Notify admins about handover denial
    const admins = await User.find({ role: { $in: ['Admin', 'SuperAdmin'] }, isActive: true });
    for (const admin of admins) {
      await createNotification({
        recipient: admin._id,
        sender: req.user.id,
        type: 'LEAVE_HANDOVER_DENIED',
        title: 'Handover Denied',
        message: `${req.user.name} denied handover for ${populated.employee.name}'s leave application`,
        link: `/admin/approvals`,
        relatedModel: 'LeaveApplication',
        relatedId: application._id
      });
    }

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Get all leave applications (with optional status filter)
router.get('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const applications = await LeaveApplication.find(query)
      .sort({ createdAt: -1 })
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role')
      .populate('detailsRequestedBy', 'name email role');

    return res.json({ applications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Approve leave application
router.patch('/:id/approve', requireAuth, authorize(['Admin']), async (req, res) => {
  try {
    const { reviewNote } = req.body;
    const application = await LeaveApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.status !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: 'Application already reviewed' });
    }

    application.status = 'Approved';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    if (reviewNote) application.reviewNote = reviewNote;

    await application.save();

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role');

    // Notify the employee
    try {
      console.log('📢 Creating approval notification for employee:', populated.employee.name, application.employee);
      await createNotification({
        recipient: application.employee,
        sender: req.user.id,
        type: 'LEAVE_APPROVED',
        title: 'Leave Application Approved',
        message: `Your leave application has been approved by ${req.user.name}`,
        link: `/my-applications`,
        relatedModel: 'LeaveApplication',
        relatedId: application._id
      });
      console.log('✅ Approval notification sent successfully');
    } catch (notifError) {
      console.error('❌ Failed to send approval notification:', notifError);
    }

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Reject leave application
router.patch('/:id/reject', requireAuth, authorize(['Admin']), async (req, res) => {
  try {
    const { reviewNote } = req.body;
    const application = await LeaveApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.status !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: 'Application already reviewed' });
    }

    if (!reviewNote) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Rejection reason is required' });
    }

    application.status = 'Rejected';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    application.reviewNote = reviewNote;

    await application.save();

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role');

    // Notify the employee
    try {
      console.log('📢 Creating rejection notification for employee:', populated.employee.name, application.employee);
      await createNotification({
        recipient: application.employee,
        sender: req.user.id,
        type: 'LEAVE_REJECTED',
        title: 'Leave Application Rejected',
        message: `Your leave application has been rejected by ${req.user.name}. Reason: ${reviewNote}`,
        link: `/my-applications`,
        relatedModel: 'LeaveApplication',
        relatedId: application._id
      });
      console.log('✅ Rejection notification sent successfully');
    } catch (notifError) {
      console.error('❌ Failed to send rejection notification:', notifError);
    }

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Admin: Request more details for leave application
router.patch('/:id/request-details', requireAuth, authorize(['Admin']), async (req, res) => {
  try {
    const { detailsRequested } = req.body;
    const application = await LeaveApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.status !== 'Pending') {
      return res.status(400).json({ code: 'ALREADY_REVIEWED', message: 'Application already reviewed' });
    }

    if (!detailsRequested) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Details request message is required' });
    }

    application.detailsRequested = detailsRequested;
    application.detailsRequestedAt = new Date();
    application.detailsRequestedBy = req.user.id;

    await application.save();

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role')
      .populate('detailsRequestedBy', 'name email role');

    // Notify the employee
    try {
      console.log('📢 Creating details request notification for employee:', populated.employee.name, application.employee);
      await createNotification({
        recipient: application.employee,
        sender: req.user.id,
        type: 'LEAVE_DETAILS_REQUESTED',
        title: 'More Details Needed for Leave Application',
        message: `${req.user.name} has requested more information: ${detailsRequested}`,
        link: `/my-applications`,
        relatedModel: 'LeaveApplication',
        relatedId: application._id
      });
      console.log('✅ Details request notification sent successfully');
    } catch (notifError) {
      console.error('❌ Failed to send details request notification:', notifError);
    }

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Update own leave application (only if pending)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason, handoverTo } = req.body;
    
    const application = await LeaveApplication.findOne({
      _id: req.params.id,
      employee: req.user.id
    });

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.status !== 'Pending') {
      return res.status(400).json({ code: 'CANNOT_EDIT', message: 'Cannot edit application that has been reviewed' });
    }

    // Validate handoverTo if provided
    if (handoverTo) {
      const handoverEmployee = await User.findById(handoverTo);
      if (!handoverEmployee) {
        return res.status(400).json({ code: 'INVALID_HANDOVER', message: 'Handover employee not found' });
      }
      if (handoverEmployee.role === 'SuperAdmin') {
        return res.status(400).json({ code: 'INVALID_HANDOVER', message: 'Cannot handover to SuperAdmin' });
      }
      if (handoverTo === req.user.id) {
        return res.status(400).json({ code: 'INVALID_HANDOVER', message: 'Cannot handover to yourself' });
      }
    }

    // Calculate new total days if dates changed
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    if (totalDays <= 0) {
      return res.status(400).json({ code: 'INVALID_DATES', message: 'End date must be after start date' });
    }

    // Update application
    application.leaveType = leaveType;
    application.startDate = start;
    application.endDate = end;
    application.totalDays = totalDays;
    application.reason = reason;
    application.handoverTo = handoverTo || null;
    application.handoverStatus = handoverTo ? 'Pending' : null;

    await application.save();

    const populated = await LeaveApplication.findById(application._id)
      .populate('employee', 'name email role')
      .populate('handoverTo', 'name email role')
      .populate('reviewedBy', 'name email role');

    return res.json({ application: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Employee: Delete own leave application (only if pending)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const application = await LeaveApplication.findOne({
      _id: req.params.id,
      employee: req.user.id
    });

    if (!application) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Application not found' });
    }

    if (application.status !== 'Pending') {
      return res.status(400).json({ code: 'CANNOT_DELETE', message: 'Cannot delete application that has been reviewed' });
    }

    await LeaveApplication.findByIdAndDelete(req.params.id);

    return res.json({ message: 'Application deleted successfully' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
