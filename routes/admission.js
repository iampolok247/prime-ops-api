// api/routes/admission.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import Lead from '../models/Lead.js';
import AdmissionFee from '../models/AdmissionFee.js';
import { logActivity } from './activities.js';

const router = express.Router();

const isAdmission = (u) => u?.role === 'Admission';
const isAdmin = (u) => u?.role === 'Admin';
const isSA = (u) => u?.role === 'SuperAdmin';
const isAccountant = (u) => u?.role === 'Accountant';
const isCoordinator = (u) => u?.role === 'Coordinator';
const isITAdmin = (u) => u?.role === 'ITAdmin';

// ---------- Leads (Admission pipeline) ----------

// List leads for Admission (own) or Admin/SA/Coordinator (all)
router.get('/leads', requireAuth, async (req, res) => {
  const { status } = req.query;
  const q = {};
  if (status) q.status = status;

  if (isAdmission(req.user)) {
    q.assignedTo = req.user.id;
  } else if (!(isAdmin(req.user) || isSA(req.user) || isCoordinator(req.user) || isITAdmin(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  const leads = await Lead.find(q).sort({ createdAt: -1 }).populate('assignedTo', 'name email');
  return res.json({ leads });
});

// Allowed transitions
// Assigned -> Counseling
// Counseling -> Admitted | In Follow Up | Not Interested
// In Follow Up -> Admitted | Not Interested
// Some environments/proxies block PATCH, so provide a POST alias to the same handler
async function updateLeadStatusHandler(req, res) {
  console.log('=== UPDATE LEAD STATUS HANDLER ===');
  console.log('Lead ID:', req.params.id);
  console.log('Request body:', req.body);
  console.log('User:', req.user?.name, req.user?.role);
  
  const { status, notes, courseId, batchId, nextFollowUpDate } = req.body || {};
  const allowed = ['Counseling', 'Admitted', 'In Follow Up', 'Not Interested'];
  if (!allowed.includes(status)) {
    console.log('ERROR: Invalid status:', status);
    return res.status(400).json({ code: 'INVALID_STATUS', message: 'Invalid target status' });
  }

  const lead = await Lead.findById(req.params.id);
  if (!lead) {
    console.log('ERROR: Lead not found:', req.params.id);
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
  }
  console.log('Lead found:', lead.leadId, 'Current status:', lead.status);

  // Admission can only move own leads; Admin/SA can move any
  if (isAdmission(req.user) && String(lead.assignedTo) !== String(req.user.id)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot update unassigned lead' });
  }
  if (!(isAdmission(req.user) || isAdmin(req.user) || isSA(req.user) || isITAdmin(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  const from = lead.status;
  let ok =
    (from === 'Assigned' && status === 'Counseling') ||
    (from === 'Counseling' && ['Admitted', 'In Follow Up', 'Not Interested'].includes(status)) ||
    (from === 'In Follow Up' && ['Admitted', 'Not Interested'].includes(status));

  // Special case: allow adding an additional follow-up (notes) while already in 'In Follow Up'
  // without requiring a status change. This enables the frontend "Follow-Up Again" flow.
  if (!ok) {
    if (status === 'In Follow Up' && notes && String(notes).trim().length > 0) {
      ok = true;
    }
  }

  if (!ok) {
    return res.status(400).json({ code: 'BAD_TRANSITION', message: `Cannot move ${from} -> ${status}` });
  }

  // Update timestamps / follow-ups appropriately
  if (status === 'Counseling') {
    // mark counseling time - UPDATE it every time (don't use || to preserve old value)
    lead.counselingAt = new Date();
    
    // Log this counseling action for metrics tracking
    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    await LeadActivity.create({
      lead: lead._id,
      advisor: req.user.id,
      activityType: 'counseling',
      actionDate: new Date(),
      note: notes || ''
    });
  }

  if (status === 'Admitted') {
    lead.admittedAt = lead.admittedAt || new Date();
    // Store the course they were admitted to
    if (courseId) {
      lead.admittedToCourse = courseId;
      // Also update interestedCourse with the actual course name for display
      const Course = (await import('../models/Course.js')).default;
      const course = await Course.findById(courseId);
      if (course) {
        lead.interestedCourse = course.name;
      }
    }
    
    // Store the batch they were admitted to
    if (batchId) {
      lead.admittedToBatch = batchId;
      // Also add student to batch's admittedStudents array
      const Batch = (await import('../models/Batch.js')).default;
      const batch = await Batch.findById(batchId);
      if (batch) {
        const alreadyInBatch = batch.admittedStudents.some(
          s => s.lead.toString() === lead._id.toString()
        );
        if (!alreadyInBatch) {
          batch.admittedStudents.push({
            lead: lead._id,
            admittedAt: new Date()
          });
          await batch.save();
        }
      }
    }
    
    // Log this admitted action for metrics tracking
    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    await LeadActivity.create({
      lead: lead._id,
      advisor: req.user.id,
      activityType: 'admitted',
      actionDate: new Date(),
      note: notes || ''
    });
  }

  if (status === 'In Follow Up') {
    // if notes provided, append a follow-up entry
    if (notes && String(notes).trim().length > 0) {
      lead.followUps = lead.followUps || [];
      lead.followUps.push({ note: String(notes).trim(), at: new Date(), by: req.user.id });
      
      // Log follow-up activity
      await logActivity(
        req.user.id,
        req.user.name,
        req.user.email,
        req.user.role,
        'UPDATE',
        'Lead',
        `${lead.name} (${lead.leadId})`,
        `Added follow-up note: "${String(notes).trim().substring(0, 100)}${String(notes).trim().length > 100 ? '...' : ''}"`
      );
    }
    
    // Update nextFollowUpDate if provided
    if (nextFollowUpDate) {
      lead.nextFollowUpDate = new Date(nextFollowUpDate);
    }
  }

  if (status === 'Not Interested') {
    // if a reason/notes provided when marking Not Admitted, store it as a follow-up entry
    if (notes && String(notes).trim().length > 0) {
      lead.followUps = lead.followUps || [];
      lead.followUps.push({ note: `Not Interested: ${String(notes).trim()}`, at: new Date(), by: req.user.id });
    }
    
    // Log this not admitted action for metrics tracking
    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    await LeadActivity.create({
      lead: lead._id,
      advisor: req.user.id,
      activityType: 'not_interested',
      actionDate: new Date(),
      note: notes || ''
    });
  }

  lead.status = status;
  await lead.save();

  // populate follow-up authors
  await Lead.populate(lead, { path: 'followUps.by', select: 'name email' });

  // Log activity with more descriptive message
  let activityDescription = `Changed lead status to ${status}: ${lead.name} (${lead.leadId})`;
  
  if (status === 'In Follow Up' && notes) {
    activityDescription = `Moved to Follow-Up: ${lead.name} (${lead.leadId})`;
  } else if (status === 'Counseling') {
    activityDescription = `Started Counseling: ${lead.name} (${lead.leadId})`;
  } else if (status === 'Admitted') {
    activityDescription = `Admitted lead: ${lead.name} (${lead.leadId})`;
  } else if (status === 'Not Interested') {
    activityDescription = `Marked as Not Interested: ${lead.name} (${lead.leadId})`;
  }
  
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'UPDATE',
    'Lead',
    lead.name,
    activityDescription
  );

  return res.json({ lead });
}

router.patch('/leads/:id/status', requireAuth, updateLeadStatusHandler);
router.post('/leads/:id/status', requireAuth, updateLeadStatusHandler);

// Add follow-up note (Admission only)
router.post('/leads/:id/follow-up', requireAuth, async (req, res) => {
  const { note, nextFollowUpDate, priority } = req.body || {};
  
  if (!isAdmission(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Only Admission can add follow-ups' });
  }

  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

  if (String(lead.assignedTo) !== String(req.user.id)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot add follow-up for unassigned lead' });
  }

  // Don't allow follow-ups on admitted or not admitted leads
  if (lead.status === 'Admitted' || lead.status === 'Not Admitted') {
    return res.status(400).json({ code: 'INVALID_STATE', message: 'Cannot add follow-up to admitted or rejected lead' });
  }

  // Check if this is the first follow-up or a subsequent one
  const isFirstFollowUp = lead.status !== 'In Follow Up' && (!lead.followUps || lead.followUps.length === 0);

  // Add follow-up entry
  lead.followUps = lead.followUps || [];
  lead.followUps.push({ 
    note: note ? String(note).trim() : '', 
    at: new Date(), 
    by: req.user.id 
  });

  // Log this follow-up action for metrics tracking ONLY if it's a subsequent follow-up (Follow-Up Again)
  // Don't log the first follow-up as it's just moving from Counseling to In Follow Up
  if (!isFirstFollowUp) {
    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    await LeadActivity.create({
      lead: lead._id,
      advisor: req.user.id,
      activityType: 'follow_up',
      actionDate: new Date(),
      note: note ? String(note).trim() : ''
    });
  }

  // Update nextFollowUpDate if provided
  if (nextFollowUpDate) {
    lead.nextFollowUpDate = new Date(nextFollowUpDate);
  }

  // Update priority if provided
  if (priority) {
    lead.priority = priority;
  }

  // If not already in "In Follow Up" status, update it
  if (lead.status !== 'In Follow Up') {
    lead.status = 'In Follow Up';
  }

  await lead.save();

  const populated = await Lead.findById(lead._id)
    .populate('assignedTo', 'name email role')
    .populate('assignedBy', 'name email role')
    .populate('admittedToCourse', 'name')
    .populate('admittedToBatch', 'name');
  
  await Lead.populate(populated, { path: 'followUps.by', select: 'name email' });

  return res.json({ lead: populated });
});

// ---------- Fees Collection (Admission submit; Accountant approve in Phase 5) ----------

// List fees: Admission sees own, Admin/SA/Accountant/Coordinator see all
router.get('/fees', requireAuth, async (req, res) => {
  const q = {};
  if (isAdmission(req.user)) q.submittedBy = req.user.id;
  else if (!(isAdmin(req.user) || isSA(req.user) || isAccountant(req.user) || isCoordinator(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }
  const rows = await AdmissionFee.find(q)
    .sort({ createdAt: -1 })
    .populate('lead', 'leadId name phone email status');
  return res.json({ fees: rows });
});

// Check if admission fee is collected/approved for a lead
router.get('/fees/status/:leadId', requireAuth, async (req, res) => {
  try {
    const { leadId } = req.params;
    
    // Find approved admission fee for this lead
    const fee = await AdmissionFee.findOne({
      lead: leadId,
      status: 'Approved' // Only check for approved fees
    }).populate('lead', 'leadId name phone email status');

    if (!fee) {
      return res.json({ 
        hasApprovedFee: false, 
        message: 'Admission fees not collected or not approved' 
      });
    }

    return res.json({ 
      hasApprovedFee: true, 
      fee: fee,
      message: 'Admission fees collected and approved' 
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Create fee (Admission only)
router.post('/fees', requireAuth, async (req, res) => {
  if (!isAdmission(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Admission only' });
  }
  const { leadId, courseName, totalAmount, amount, dueAmount, method, paymentDate, nextPaymentDate, note } = req.body || {};
  if (!leadId || !courseName || amount === undefined || !method || !paymentDate) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Missing required fields' });
  }

  const lead = await Lead.findById(leadId);
  if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

  if (String(lead.assignedTo) !== String(req.user.id)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot submit fee for unassigned lead' });
  }
  // Allow fee collection for leads that are NOT yet admitted
  // Typical flow: Counseling → Interested → Pay Fees → Get Admitted
  if (lead.status === 'Admitted') {
    return res.status(400).json({ code: 'INVALID_STATE', message: 'Lead is already admitted. Use due collection for additional payments.' });
  }

  const row = await AdmissionFee.create({
    lead: lead._id,
    courseName,
    totalAmount: Number(totalAmount) || 0,
    amount: Number(amount),
    dueAmount: Number(dueAmount) || 0,
    method,
    paymentDate: new Date(paymentDate),
    nextPaymentDate: nextPaymentDate ? new Date(nextPaymentDate) : undefined,
    note: note || '',
    status: 'Pending',
    submittedBy: req.user.id
  });

  const populated = await AdmissionFee.findById(row._id).populate('lead', 'leadId name phone email status');
  
  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'CREATE',
    'AdmissionFee',
    lead.name,
    `Collected admission fee ৳${amount} from ${lead.name} (${lead.leadId})`
  );
  
  return res.status(201).json({ fee: populated });
});

// ---------- Follow-up Notifications ----------

// Get leads with upcoming/overdue follow-ups for Admission
router.get('/follow-up-notifications', requireAuth, async (req, res) => {
  if (!isAdmission(req.user) && !isAdmin(req.user) && !isSA(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const q = {
      status: { $in: ['Assigned', 'Counseling', 'In Follow Up'] } // Not admitted or rejected
    };

    // Admission sees upcoming notifications (today + next 3 days)
    // Admin/SuperAdmin only see OVERDUE notifications (before today)
    if (isAdmission(req.user)) {
      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      q.nextFollowUpDate = { $lte: threeDaysFromNow };
      q.assignedTo = req.user.id; // Only their own leads
    } else {
      // Admin/SuperAdmin: only overdue (< today)
      q.nextFollowUpDate = { $lt: today };
    }

    const leads = await Lead.find(q)
      .sort({ nextFollowUpDate: 1 })
      .populate('assignedTo', 'name email');

    const notifications = leads.map(lead => {
      const isOverdue = lead.nextFollowUpDate && new Date(lead.nextFollowUpDate) < today;
      const daysUntil = lead.nextFollowUpDate 
        ? Math.ceil((new Date(lead.nextFollowUpDate) - today) / (1000 * 60 * 60 * 24))
        : null;

      return {
        ...lead.toObject(),
        isOverdue,
        daysUntil
      };
    });

    return res.json({ notifications });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ---------- Admission Reports (Admin/SuperAdmin) ----------

// Get admission reports - overall or filtered by user
router.get('/reports', requireAuth, async (req, res) => {
  if (!isAdmin(req.user) && !isSA(req.user)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Admin/SuperAdmin only' });
  }

  try {
    const { userId, from, to } = req.query;
    
    // Build date filter if provided
    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) dateFilter.createdAt.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = toDate;
      }
    }

    // If userId provided, get individual report
    if (userId) {
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId).select('name email role');
      if (!user) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // Get all leads assigned to this user
      const userLeads = await Lead.find({ 
        assignedTo: userId,
        ...dateFilter
      }).populate('assignedTo', 'name email');

      // Calculate statistics
      const stats = {
        totalLeads: userLeads.length,
        assigned: userLeads.filter(l => l.status === 'Assigned').length,
        counseling: userLeads.filter(l => l.status === 'Counseling').length,
        inFollowUp: userLeads.filter(l => l.status === 'In Follow Up').length,
        admitted: userLeads.filter(l => l.status === 'Admitted').length,
        notAdmitted: userLeads.filter(l => l.status === 'Not Admitted').length
      };

      // Calculate conversion rates
      const conversionRate = stats.totalLeads > 0 
        ? ((stats.admitted / stats.totalLeads) * 100).toFixed(2) 
        : 0;

      return res.json({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        stats,
        conversionRate,
        leads: userLeads
      });
    }

    // Otherwise, get all admission users with their statistics
    const User = (await import('../models/User.js')).default;
    const admissionUsers = await User.find({ 
      role: 'Admission', 
      isActive: true 
    }).select('name email role');

    const reports = await Promise.all(
      admissionUsers.map(async (user) => {
        const userLeads = await Lead.find({ 
          assignedTo: user._id,
          ...dateFilter
        });

        const stats = {
          totalLeads: userLeads.length,
          assigned: userLeads.filter(l => l.status === 'Assigned').length,
          counseling: userLeads.filter(l => l.status === 'Counseling').length,
          inFollowUp: userLeads.filter(l => l.status === 'In Follow Up').length,
          admitted: userLeads.filter(l => l.status === 'Admitted').length,
          notAdmitted: userLeads.filter(l => l.status === 'Not Admitted').length
        };

        const conversionRate = stats.totalLeads > 0 
          ? ((stats.admitted / stats.totalLeads) * 100).toFixed(2) 
          : 0;

        return {
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
          },
          stats,
          conversionRate
        };
      })
    );

    // Calculate overall statistics
    const overallStats = {
      totalLeads: reports.reduce((sum, r) => sum + r.stats.totalLeads, 0),
      assigned: reports.reduce((sum, r) => sum + r.stats.assigned, 0),
      counseling: reports.reduce((sum, r) => sum + r.stats.counseling, 0),
      inFollowUp: reports.reduce((sum, r) => sum + r.stats.inFollowUp, 0),
      admitted: reports.reduce((sum, r) => sum + r.stats.admitted, 0),
      notAdmitted: reports.reduce((sum, r) => sum + r.stats.notAdmitted, 0)
    };

    const overallConversionRate = overallStats.totalLeads > 0
      ? ((overallStats.admitted / overallStats.totalLeads) * 100).toFixed(2)
      : 0;

    return res.json({
      overall: {
        stats: overallStats,
        conversionRate: overallConversionRate
      },
      reports
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ---------- Undo Admission (for Admin/SuperAdmin/ITAdmin only) ----------
router.post('/leads/:id/undo-admission', requireAuth, async (req, res) => {
  try {
    // Only Admin, SuperAdmin, and ITAdmin can undo admissions
    if (!isAdmin(req.user) && !isSA(req.user) && !isITAdmin(req.user)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only Admin/SuperAdmin/ITAdmin can undo admissions' });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    }

    if (lead.status !== 'Admitted') {
      return res.status(400).json({ code: 'NOT_ADMITTED', message: 'Lead is not in Admitted status' });
    }

    // 1. Remove from batch's admitted students
    if (lead.admittedToBatch) {
      const Batch = (await import('../models/Batch.js')).default;
      const batch = await Batch.findById(lead.admittedToBatch);
      if (batch) {
        batch.admittedStudents = batch.admittedStudents.filter(
          student => student.lead.toString() !== lead._id.toString()
        );
        await batch.save();
      }
    }

    // 2. Find and reject/delete associated admission fees
    const admissionFees = await AdmissionFee.find({ lead: lead._id, status: { $ne: 'Rejected' } });
    for (const fee of admissionFees) {
      fee.status = 'Rejected';
      fee.note = `${fee.note}\n[UNDO] Admission reversed by ${req.user.name} on ${new Date().toISOString()}`;
      await fee.save();
    }

    // 3. Reset lead status and admission fields
    const previousCourse = lead.admittedToCourse;
    const previousBatch = lead.admittedToBatch;
    
    lead.status = 'In Follow Up'; // Return to follow-up stage
    lead.admittedAt = null;
    lead.admittedToCourse = null;
    lead.admittedToBatch = null;
    lead.notes = `${lead.notes}\n[UNDO] Admission reversed by ${req.user.name} - Reason: Mistaken admission`;
    
    await lead.save();

    // 4. Log activity
    await logActivity(
      req.user.id,
      req.user.name,
      req.user.email,
      req.user.role,
      'UPDATE',
      'Lead',
      lead.name,
      `Undo admission: ${lead.name} (${lead.leadId}) - reversed from Admitted to In Follow Up`
    );

    const populated = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name email');

    return res.json({ 
      lead: populated,
      message: 'Admission successfully reversed',
      undoneActions: {
        removedFromBatch: !!previousBatch,
        rejectedFees: admissionFees.length
      }
    });
  } catch (e) {
    console.error('Undo admission error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
