import express from 'express';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Course from '../models/Course.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logActivity } from './activities.js';

const router = express.Router();

// Atomic counter collection for generating unique IDs
import mongoose from 'mongoose';

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', CounterSchema);

// Get first 3 letters of course name (uppercase)
const getCourseInitials = (courseName) => {
  if (!courseName) return 'GEN';
  return courseName.substring(0, 3).toUpperCase();
};

// Initialize counter based on existing leads in database for a specific course
const initializeCounter = async (year, courseInitials) => {
  const counterKey = `lead-${year}-${courseInitials}`;
  
  try {
    // Check if counter already exists
    const existingCounter = await Counter.findById(counterKey);
    if (existingCounter) {
      return; // Already initialized
    }

    // Find the highest leadId in the database for this year and course
    const highestLead = await Lead.findOne(
      { leadId: new RegExp(`^LEAD-${year}-${courseInitials}-`) },
      { leadId: 1 }
    ).sort({ leadId: -1 });

    let maxSeq = 0;
    if (highestLead) {
      // Extract sequence number from leadId (e.g., "LEAD-2025-PCC-0654" → 654)
      const parts = highestLead.leadId.split('-');
      const seqStr = parts[parts.length - 1];
      maxSeq = parseInt(seqStr) || 0;
    }

    // Create counter with the next sequence number
    await Counter.create({
      _id: counterKey,
      seq: maxSeq
    });

    console.log(`✅ Counter initialized for ${year}-${courseInitials}: starting at ${maxSeq + 1}`);
  } catch (e) {
    console.error(`⚠️ Error initializing counter for ${year}-${courseInitials}:`, e.message);
  }
};

const genLeadId = async (courseName = 'General') => {
  const y = new Date().getFullYear();
  const courseInitials = getCourseInitials(courseName);
  const counterKey = `lead-${y}-${courseInitials}`;
  
  try {
    // Initialize counter if needed
    await initializeCounter(y, courseInitials);

    // Atomic increment using findByIdAndUpdate
    const counter = await Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const n = counter.seq.toString().padStart(5, '0');
    return `LEAD-${y}-${courseInitials}-${n}`;
  } catch (e) {
    console.error('Error generating lead ID:', e);
    // Fallback: use timestamp + random for safety
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `LEAD-${y}-${courseInitials}-${timestamp}${random}`.slice(0, 20);
  }
};

// Create single lead (DM only)
router.post('/', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  const { name, phone, email, interestedCourse, source, customFields } = req.body || {};
  if (!name) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Name required' });

  // Validate course name if provided
  if (interestedCourse) {
    const course = await Course.findOne({ name: { $regex: `^${interestedCourse}$`, $options: 'i' } });
    if (!course) {
      return res.status(400).json({ code: 'INVALID_COURSE', message: `Course "${interestedCourse}" does not exist` });
    }
  }

  // simple dedupe guard: same phone OR email within last 180 days
  const since = new Date(); since.setDate(since.getDate() - 180);
  const dup = await Lead.findOne({
    $and: [
      { createdAt: { $gte: since } },
      { $or: [{ phone: phone || null }, { email: email?.toLowerCase() || null }] }
    ]
  });
  if (dup) return res.status(409).json({ code: 'DUPLICATE', message: 'Duplicate phone/email in recent leads' });

  const lead = await Lead.create({
    leadId: await genLeadId(interestedCourse),
    name, phone, email, interestedCourse, source,
    status: 'Assigned',
    assignedBy: req.user.id,
    customFields: customFields || {}
  });

  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'CREATE',
    'Lead',
    name,
    `Created lead: ${name} (${lead.leadId})`
  );

  return res.status(201).json({ lead });
});

// Bulk upload CSV (string body) — DM only
// CSV headers: Name,Phone,Email,InterestedCourse,Source
router.post('/bulk', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  try {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'csv string required' });
    }
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return res.status(400).json({ code: 'NO_ROWS', message: 'No data rows' });

    const header = lines[0].split(',').map(h => h.trim());
    const idx = {
      Name: header.indexOf('Name'),
      Phone: header.indexOf('Phone'),
      Email: header.indexOf('Email'),
      InterestedCourse: header.indexOf('InterestedCourse'),
      Source: header.indexOf('Source')
    };
    if (Object.values(idx).some(v => v < 0)) {
      return res.status(400).json({ code: 'HEADER_MISSING', message: 'Headers must be Name,Phone,Email,InterestedCourse,Source' });
    }
    
    // Find custom field columns (any column not in standard fields)
    const standardFields = ['Name', 'Phone', 'Email', 'InterestedCourse', 'Source'];
    const customFieldColumns = header
      .map((h, index) => ({ name: h, index }))
      .filter(col => !standardFields.includes(col.name) && col.name.length > 0);

    // Get all valid courses for validation
    const allCourses = await Course.find({});
    const validCourseNames = allCourses.map(c => c.name.trim().toLowerCase());

    const since = new Date(); since.setDate(since.getDate() - 180);
    let created = 0, skipped = 0;
    const errors = [];
    
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(x => x.trim());
      if (!parts.length || parts.join('') === '') continue;

      const name = parts[idx.Name];
      const phone = parts[idx.Phone] || null;
      const email = (parts[idx.Email] || '').toLowerCase() || null;
      const interestedCourse = parts[idx.InterestedCourse] || '';
      const source = parts[idx.Source] || 'Others';

      if (!name) { 
        skipped++; 
        errors.push(`Row ${i + 1}: Name is required`);
        continue; 
      }

      // Validate course name matches exactly
      if (interestedCourse && !validCourseNames.includes(interestedCourse.trim().toLowerCase())) {
        skipped++;
        errors.push(`Row ${i + 1}: Course "${interestedCourse}" does not exist`);
        continue;
      }

      const dup = await Lead.findOne({
        $and: [
          { createdAt: { $gte: since } },
          { $or: [{ phone }, { email }] }
        ]
      });

      if (dup) { 
        skipped++; 
        errors.push(`Row ${i + 1}: Duplicate phone/email`);
        continue; 
      }

      // Extract custom fields from this row
      const customFields = {};
      customFieldColumns.forEach(col => {
        const value = parts[col.index]?.trim();
        if (value) {
          customFields[col.name] = value;
        }
      });

      await Lead.create({
        leadId: await genLeadId(interestedCourse),
        name, phone, email, interestedCourse, source,
        status: 'Assigned',
        assignedBy: req.user.id,
        customFields
      });
      created++;
    }

    return res.json({ ok: true, created, skipped, errors: errors.slice(0, 10) }); // Return first 10 errors
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Get today's assigned leads grouped by admission member and course (DM only)
router.get('/today-assignments', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get leads assigned today
    const leads = await Lead.find({
      assignedAt: { $gte: today, $lt: tomorrow },
      assignedTo: { $ne: null }
    })
      .populate('assignedTo', 'name email role')
      .sort({ assignedTo: 1, interestedCourse: 1 });

    // Group by admission member and course
    const grouped = {};
    leads.forEach(lead => {
      const memberName = lead.assignedTo?.name || 'Unknown';
      const course = lead.interestedCourse || 'No Course Specified';
      
      if (!grouped[memberName]) {
        grouped[memberName] = {};
      }
      
      if (!grouped[memberName][course]) {
        grouped[memberName][course] = 0;
      }
      
      grouped[memberName][course]++;
    });

    return res.json({ grouped, total: leads.length });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// List leads (DM full view; Admin/SuperAdmin view-only)
router.get('/', requireAuth, authorize(['DigitalMarketing', 'Admin', 'SuperAdmin']), async (req, res) => {
  const { status } = req.query;
  const q = {};
  if (status) q.status = status;
  const leads = await Lead.find(q)
    .sort({ createdAt: -1 })
    .populate('assignedTo', 'name email role')
    .populate('assignedBy', 'name email role');
  // populate follow-up user references if any
  await Lead.populate(leads, { path: 'followUps.by', select: 'name email' });
  return res.json({ leads });
});

// Assign to Admission member (DM only) — support both POST and PATCH for compatibility
const assignHandler = async (req, res) => {
  const { assignedTo } = req.body || {};
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

  const user = await User.findById(assignedTo);
  if (!user || user.role !== 'Admission') {
    return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be Admission member' });
  }

  lead.assignedTo = user._id;
  lead.status = 'Assigned';
  lead.assignedAt = new Date();
  await lead.save();

  const populated = await Lead.findById(lead._id)
    .populate('assignedTo', 'name email role')
    .populate('assignedBy', 'name email role');
  await Lead.populate(populated, { path: 'followUps.by', select: 'name email' });

  return res.json({ lead: populated });
};

router.post('/:id/assign', requireAuth, authorize(['DigitalMarketing']), assignHandler);
router.patch('/:id/assign', requireAuth, authorize(['DigitalMarketing']), assignHandler); // <-- added

// Bulk assign multiple leads to an Admission member (DM only)
router.post('/bulk-assign', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  try {
    const { leadIds, assignedTo } = req.body || {};
    
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'leadIds array required' });
    }
    
    if (!assignedTo) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'assignedTo required' });
    }

    const user = await User.findById(assignedTo);
    if (!user || user.role !== 'Admission') {
      return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be Admission member' });
    }

    // Update all leads in one operation
    const result = await Lead.updateMany(
      { _id: { $in: leadIds } },
      { 
        $set: { 
          assignedTo: user._id,
          status: 'Assigned',
          assignedAt: new Date()
        }
      }
    );

    return res.json({ 
      ok: true, 
      assigned: result.modifiedCount,
      message: `${result.modifiedCount} lead(s) assigned successfully` 
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Single-lead history (populated followUps.by).
// Accessible to Admin, SuperAdmin, DigitalMarketing. Admission may view only if assignedTo === self.
router.get('/:id/history', requireAuth, async (req, res) => {
  const lead = await Lead.findById(req.params.id)
    .populate('assignedTo', 'name email role')
    .populate('assignedBy', 'name email role')
    .populate('admittedToCourse', 'name')
    .populate('admittedToBatch', 'name');
  if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

  const role = req.user?.role;
  if (role === 'Admission') {
    if (!lead.assignedTo || String(lead.assignedTo._id) !== String(req.user.id)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot view history for unassigned lead' });
    }
  } else if (!(role === 'Admin' || role === 'SuperAdmin' || role === 'DigitalMarketing')) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  // populate follow-up authors
  await Lead.populate(lead, { path: 'followUps.by', select: 'name email' });
  return res.json({ lead });
});


// Update status (DM only for now; Phase 4: Admission will change from their side)
router.patch('/:id/status', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  const { status, notes } = req.body || {};
  const allowed = ['Assigned', 'Counseling', 'In Follow Up', 'Admitted', 'Not Admitted', 'Not Interested'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ code: 'INVALID_STATUS', message: 'Invalid status' });
  }
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
  lead.status = status;
  if (notes !== undefined) lead.notes = notes;
  // record timestamps per stage
  if (status === 'Counseling') lead.counselingAt = new Date();
  if (status === 'In Follow Up') {
    // push a follow-up entry with optional note
    const fu = { note: notes || '', at: new Date(), by: req.user.id };
    lead.followUps = lead.followUps || [];
    lead.followUps.push(fu);
  }
  if (status === 'Admitted') lead.admittedAt = new Date();
  await lead.save();
  const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email role').populate('assignedBy', 'name email role');
  return res.json({ lead: populated });
});

// Delete lead (DM only - can delete any of their own leads, even if assigned)
router.delete('/:id', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    
    // Only allow deletion if the lead was created by the current user (assignedBy check)
    if (String(lead.assignedBy) !== String(req.user.id)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Can only delete leads you created' });
    }
    
    await Lead.deleteOne({ _id: req.params.id });
    return res.json({ ok: true, message: 'Lead deleted successfully' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Update lead (DM only - can update any of their own leads, even if assigned)
router.patch('/:id', requireAuth, authorize(['DigitalMarketing']), async (req, res) => {
  try {
    const { name, phone, email, interestedCourse, source } = req.body || {};
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    
    // Only allow update if the lead was created by the current user (assignedBy check)
    if (String(lead.assignedBy) !== String(req.user.id)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Can only update leads you created' });
    }
    
    // Update allowed fields
    if (name) lead.name = name;
    if (phone !== undefined) lead.phone = phone;
    if (email !== undefined) lead.email = email?.toLowerCase();
    if (interestedCourse !== undefined) lead.interestedCourse = interestedCourse;
    if (source !== undefined) lead.source = source;
    
    await lead.save();
    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email role').populate('assignedBy', 'name email role');
    
    // Log activity
    await logActivity(
      req.user.id,
      req.user.name,
      req.user.email,
      req.user.role,
      'UPDATE',
      'Lead',
      lead.name,
      `Updated lead: ${lead.name} (${lead.leadId})`
    );
    
    return res.json({ lead: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
