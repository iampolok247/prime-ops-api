// Meta CRM — DM side (Meta Leads Center) + Make.com webhook + Meta CAPI queue.
//
// Flow mirrors Leads Center → Admission Pipeline:
//   Make.com webhook → MetaCrmLead (validationStatus: pending)
//   DM validates / rejects → DM assigns to an Admission member
//   Admission works the lead in the Meta Pipeline (routes/admission.js mounted
//   at /api/meta-crm/admission) — counseling, follow-ups, fees, admission.
//
// The webhook URL (/api/meta-leads/webhook) is unchanged so Make.com needs no edits.
import express          from 'express';
import mongoose         from 'mongoose';
import { timingSafeEqual } from 'crypto';

import MetaCrmLead      from '../models/MetaCrmLead.js';
import User             from '../models/User.js';
import Course           from '../models/Course.js';
import CapiEventLog     from '../models/CapiEventLog.js';
import { requireAuth }  from '../middleware/auth.js';
import { authorize }    from '../middleware/authorize.js';
import { scoreLeadAsync } from '../utils/aiScoring.js';
import { sendPendingCapiEvents, queueCapiStageEvent, LEAD_RECEIVED_EVENT } from '../utils/metaCapi.js';
import { logActivity }  from './activities.js';
import { BAD_LEAD_REASONS, LOST_LEAD_REASONS, DISQUALIFIED_EVENT } from '../utils/leadQuality.js';

const router = express.Router();

// ── Roles ────────────────────────────────────────────────────────────────────
const MANAGE_ROLES = ['DigitalMarketing', 'Admin', 'SuperAdmin'];                 // validate / assign / edit
const VIEW_ROLES   = ['DigitalMarketing', 'Admin', 'SuperAdmin', 'ITAdmin', 'HeadOfCreative'];
const ADMIN_ROLES  = ['Admin', 'SuperAdmin'];

const POPULATE_USER = 'name email role';

// ── Counter for META-YYYY-NNNNN IDs ──────────────────────────────────────────
const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

async function genMetaCrmLeadId() {
  const year = new Date().getFullYear();
  const ctr  = await Counter.findByIdAndUpdate(
    `meta-crm-${year}`,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `META-${year}-${String(ctr.seq).padStart(5, '0')}`;
}

// ── Duplicate detection: same phone/email for the same course within 180 days
async function isDuplicate(phone, email, interestedCourse) {
  const since = new Date();
  since.setDate(since.getDate() - 180);

  const orClause = [];
  if (phone) orClause.push({ phone });
  if (email) orClause.push({ email: email.toLowerCase() });
  if (!orClause.length) return false;

  const dup = await MetaCrmLead.findOne({
    createdAt: { $gte: since },
    interestedCourse: interestedCourse || '',
    $or: orClause,
    isDeleted: false
  });
  return !!dup;
}

// ── Webhook auth ──────────────────────────────────────────────────────────────
function verifyWebhookSecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured → open (dev only)

  const incoming = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!incoming) return false;

  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(incoming));
  } catch {
    return false;
  }
}

async function loadPopulated(id) {
  const lead = await MetaCrmLead.findById(id)
    .populate('assignedTo', POPULATE_USER)
    .populate('assignedBy', POPULATE_USER)
    .populate('validatedBy', 'name email')
    .populate('admittedToCourse', 'name')
    .populate('admittedToBatch', 'batchName');
  if (lead) {
    await MetaCrmLead.populate(lead, { path: 'followUps.by', select: 'name email' });
    await MetaCrmLead.populate(lead, { path: 'adminComments.by', select: 'name email' });
  }
  return lead;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads/webhook
// Make.com sends Meta lead data here. No JWT — secured by WEBHOOK_SECRET header.
// New leads land in "Pending Validation" for DM review.
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/webhook', async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid webhook secret' });
  }

  try {
    const body = req.body || {};

    // Make.com sends Meta leads with field_data: [{name:"full_name", values:["John"]}, ...]
    // (sometimes as a JSON string). Flatten it into a plain object.
    const flat = {};
    let fieldDataArr = body.field_data;
    if (typeof fieldDataArr === 'string') {
      try { fieldDataArr = JSON.parse(fieldDataArr); } catch { fieldDataArr = []; }
    }
    if (Array.isArray(fieldDataArr)) {
      fieldDataArr.forEach(({ name: fieldName, values }) => {
        if (fieldName && Array.isArray(values) && values.length > 0) flat[fieldName] = values[0];
      });
    } else if (fieldDataArr && typeof fieldDataArr === 'object') {
      Object.assign(flat, fieldDataArr); // field_data serialised as a key:value object
    }
    const merged = { ...body, ...flat };

    const name  = merged.full_name || merged.name || merged.fullName || '';
    let   phone = merged.phone_number || merged.phone || merged.phoneNumber || '';
    let   email = (merged.email || '').toLowerCase().trim();

    // A phone must contain real digits — guards against unmapped Make.com
    // placeholders (e.g. the literal text "2.data.phone")
    const isPhone = (v) => typeof v === 'string' && v.replace(/\D/g, '').length >= 6;
    const isEmail = (v) => typeof v === 'string' && /\S+@\S+\.\S+/.test(v);
    if (!isPhone(phone)) phone = '';
    if (!isEmail(email)) email = '';

    // Fallback: any key containing 'phone' / 'email' (custom Make.com mappings)
    if (!phone || !email) {
      for (const [k, v] of Object.entries(merged)) {
        if (!v || typeof v !== 'string') continue;
        const key = k.toLowerCase();
        if (!phone && key.includes('phone') && isPhone(v)) phone = v.trim();
        if (!email && key.includes('email') && isEmail(v)) email = v.toLowerCase().trim();
      }
    }

    const course           = merged.interestedCourse || merged.interested_course || merged.course || '';
    const metaLeadId       = String(merged.id || merged.lead_id || merged.leadId || '');
    const metaFormId       = merged.form_id || merged.formId || '';
    const metaAdName       = merged.ad_name || merged.adName || '';
    const metaCampaignName = merged.campaign_name || merged.campaignName || '';
    const metaCampaignId   = merged.campaign_id || merged.campaignId || '';
    const PLATFORM_MAP = { fb: 'Facebook', ig: 'Instagram', wa: 'WhatsApp', messenger: 'Messenger' };
    const rawPlatform      = String(merged.platform || '');
    const platformGuess    = PLATFORM_MAP[rawPlatform.toLowerCase()] || rawPlatform || '';
    const platform         = ['Facebook', 'Instagram', 'WhatsApp', 'Messenger', 'Other', ''].includes(platformGuess) ? platformGuess : 'Other';
    const isOrganic        = merged.is_organic === true || merged.isOrganic === true;

    if (!name && !phone && !email) {
      return res.status(400).json({ code: 'EMPTY_LEAD', message: 'Lead must have at least name, phone, or email' });
    }

    if (metaLeadId) {
      const existing = await MetaCrmLead.findOne({ metaLeadId, isDeleted: false });
      if (existing) {
        return res.status(200).json({ code: 'DUPLICATE', message: 'Lead already imported', leadId: existing.leadId });
      }
    }
    if (await isDuplicate(phone, email, course)) {
      return res.status(200).json({ code: 'DUPLICATE', message: 'Duplicate phone/email for this course' });
    }

    // Extra Q&A from the Meta form → customFields
    const knownKeys = new Set(['full_name','name','fullName','phone_number','phone','phoneNumber',
      'email','interestedCourse','interested_course','course','id','lead_id','leadId',
      'form_id','formId','ad_name','adName','campaign_id','campaignId',
      'campaign_name','campaignName','platform','is_organic','isOrganic','field_data',
      'created_time','ad_id']);
    const customFields = {};
    for (const [k, v] of Object.entries(merged)) {
      if (!knownKeys.has(k) && v != null && typeof v !== 'object') customFields[k] = String(v);
    }

    const lead = await MetaCrmLead.create({
      leadId:           await genMetaCrmLeadId(),
      name:             name || 'Unknown',
      phone:            phone || undefined,
      email:            email || undefined,
      interestedCourse: course,
      source:           'Meta Lead',
      metaLeadId:       metaLeadId || undefined,
      metaFormId,
      metaAdName,
      metaCampaignName,
      metaCampaignId,
      platform,
      isOrganic,
      rawQuestionData:  body,
      customFields,
      validationStatus: 'pending',
      status:           'Assigned'
    });

    scoreLeadAsync(MetaCrmLead, lead._id, lead);          // AI score (async, non-blocking)
    await queueCapiStageEvent(lead, LEAD_RECEIVED_EVENT); // raw-lead stage for Meta CRM optimisation

    return res.status(201).json({ ok: true, leadId: lead.leadId });
  } catch (e) {
    console.error('[Meta Webhook] Error:', e.message);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads — manual lead by DM (already validated)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { name, phone, email, interestedCourse, source, specialFilter, customFields } = req.body || {};
    if (!name) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Name is required' });

    if (interestedCourse) {
      const escaped = interestedCourse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const course = await Course.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } });
      if (!course) return res.status(400).json({ code: 'INVALID_COURSE', message: `Course "${interestedCourse}" does not exist` });
    }
    if (await isDuplicate(phone, email, interestedCourse)) {
      return res.status(409).json({ code: 'DUPLICATE', message: 'Duplicate phone/email for this course' });
    }

    const lead = await MetaCrmLead.create({
      leadId:           await genMetaCrmLeadId(),
      name,
      phone:            phone || undefined,
      email:            email?.toLowerCase() || undefined,
      interestedCourse: interestedCourse || '',
      source:           source || 'Meta Lead',
      specialFilter:    specialFilter || '',
      customFields:     customFields || {},
      validationStatus: 'validated',
      validatedBy:      req.user.id,
      validatedAt:      new Date(),
      status:           'Assigned',
      assignedBy:       req.user.id
    });

    scoreLeadAsync(MetaCrmLead, lead._id, lead);
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role,
      'CREATE', 'MetaCrmLead', name, `Created Meta lead: ${name} (${lead.leadId})`);

    return res.status(201).json({ lead: await loadPopulated(lead._id) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads/stats — tab counts for Meta Leads Center
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/stats', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const base = { isDeleted: false };
    const validated = { ...base, validationStatus: 'validated' };
    const [pending, unassigned, rejected, byStatusAgg] = await Promise.all([
      MetaCrmLead.countDocuments({ ...base, validationStatus: 'pending' }),
      MetaCrmLead.countDocuments({ ...validated, assignedTo: null }),
      MetaCrmLead.countDocuments({ ...base, validationStatus: 'rejected' }),
      MetaCrmLead.aggregate([
        { $match: { ...validated, assignedTo: { $ne: null } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);
    const byStatus = {};
    byStatusAgg.forEach(s => { byStatus[s._id] = s.count; });
    return res.json({ pending, unassigned, rejected, byStatus });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads/today-assignments — DM: today's assignments by member & course
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/today-assignments', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const leads = await MetaCrmLead.find({
      isDeleted: false,
      assignedAt: { $gte: today, $lt: tomorrow },
      assignedTo: { $ne: null }
    }).populate('assignedTo', POPULATE_USER);

    const grouped = {};
    leads.forEach(lead => {
      const member = lead.assignedTo?.name || 'Unknown';
      const course = lead.interestedCourse || 'No Course Specified';
      grouped[member] = grouped[member] || {};
      grouped[member][course] = (grouped[member][course] || 0) + 1;
    });
    return res.json({ grouped, total: leads.length });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads?view=pending|unassigned|rejected|<status>
// DM/Admin list for Meta Leads Center.
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const { view = 'pending' } = req.query;
    const q = { isDeleted: false };
    if (view === 'pending') q.validationStatus = 'pending';
    else if (view === 'rejected') q.validationStatus = 'rejected';
    else if (view === 'unassigned') Object.assign(q, { validationStatus: 'validated', assignedTo: null });
    else Object.assign(q, { validationStatus: 'validated', assignedTo: { $ne: null }, status: view });

    const leads = await MetaCrmLead.find(q)
      .sort({ createdAt: -1 })
      .populate('assignedTo', POPULATE_USER)
      .populate('assignedBy', POPULATE_USER)
      .populate('validatedBy', 'name email');
    await MetaCrmLead.populate(leads, { path: 'followUps.by', select: 'name email' });
    return res.json({ leads: leads.map(l => l.toObject({ flattenMaps: true })) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Validation gate — DM approves or rejects pending leads
// ═══════════════════════════════════════════════════════════════════════════════
// Rejecting = marking the lead as junk: needs a reason from the bad-lead list and
// queues a "Disqualified" stage so Meta learns from it.
async function applyValidation(lead, action, rejectionReason, user) {
  lead.validatedBy = user.id;
  lead.validatedAt = new Date();
  if (action === 'reject') {
    lead.validationStatus = 'rejected';
    lead.rejectionReason  = rejectionReason;
    lead.status           = 'Archived';
    lead.leadQuality      = 'Bad';
    lead.qualityReason    = rejectionReason;
    lead.qualityMarkedBy  = user.id;
    lead.qualityMarkedAt  = new Date();
  } else {
    lead.validationStatus = 'validated';
    lead.rejectionReason  = '';
    if (lead.status === 'Archived') lead.status = 'Assigned';
    if (lead.leadQuality === 'Bad' && !lead.assignedTo) {
      lead.leadQuality = null; lead.qualityReason = ''; lead.qualityMarkedBy = undefined; lead.qualityMarkedAt = undefined;
    }
  }
  await lead.save();
  if (action === 'reject') await queueCapiStageEvent(lead, DISQUALIFIED_EVENT, user.id);
}
const invalidRejectReason = (action, reason) =>
  action === 'reject' && !BAD_LEAD_REASONS.includes(reason);

router.patch('/:id/validate', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body || {};
    if (!['validate', 'reject'].includes(action)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'action must be "validate" or "reject"' });
    }
    if (invalidRejectReason(action, rejectionReason)) {
      return res.status(400).json({ code: 'QUALITY_REASON_REQUIRED', message: 'Select a bad-lead reason from the list' });
    }
    const lead = await MetaCrmLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    if (lead.assignedTo) {
      return res.status(400).json({ code: 'ALREADY_ASSIGNED', message: 'Assigned leads cannot be re-validated' });
    }

    await applyValidation(lead, action, rejectionReason, req.user);
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'MetaCrmLead', lead.name,
      `${action === 'reject' ? 'Rejected' : 'Validated'} Meta lead: ${lead.name} (${lead.leadId})`);
    return res.json({ lead: await loadPopulated(lead._id) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

router.post('/bulk-validate', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { leadIds, action, rejectionReason } = req.body || {};
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'leadIds array required' });
    }
    if (!['validate', 'reject'].includes(action)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'action must be "validate" or "reject"' });
    }
    if (invalidRejectReason(action, rejectionReason)) {
      return res.status(400).json({ code: 'QUALITY_REASON_REQUIRED', message: 'Select a bad-lead reason from the list' });
    }
    const leads = await MetaCrmLead.find({ _id: { $in: leadIds }, isDeleted: false, assignedTo: null });
    for (const lead of leads) await applyValidation(lead, action, rejectionReason, req.user);
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'MetaCrmLead', 'Bulk Operation',
      `Bulk ${action === 'reject' ? 'rejected' : 'validated'} ${leads.length} Meta lead(s)`);
    return res.json({ ok: true, updated: leads.length, message: `${leads.length} lead(s) ${action === 'reject' ? 'rejected' : 'validated'}` });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Assignment — DM assigns validated leads to Admission members
// ═══════════════════════════════════════════════════════════════════════════════
async function getAdmissionUser(id) {
  if (!id || !mongoose.isValidObjectId(id)) return null;
  const user = await User.findById(id);
  return user && user.role === 'Admission' ? user : null;
}

const assignHandler = async (req, res) => {
  try {
    const user = await getAdmissionUser(req.body?.assignedTo);
    if (!user) return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be Admission member' });

    const lead = await MetaCrmLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    if (lead.validationStatus !== 'validated') {
      return res.status(400).json({ code: 'NOT_VALIDATED', message: 'Lead must be validated before assignment' });
    }

    lead.assignedTo = user._id;
    lead.assignedBy = lead.assignedBy || req.user.id;
    lead.assignedAt = new Date();
    if (!lead.status || lead.status === 'Archived') lead.status = 'Assigned';
    await lead.save();

    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'MetaCrmLead', lead.name,
      `Assigned Meta lead ${lead.name} (${lead.leadId}) to ${user.name}`);
    return res.json({ lead: await loadPopulated(lead._id) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
};
router.post('/:id/assign', requireAuth, authorize(MANAGE_ROLES), assignHandler);
router.patch('/:id/assign', requireAuth, authorize(MANAGE_ROLES), assignHandler);

router.post('/bulk-assign', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { leadIds, assignedTo } = req.body || {};
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'leadIds array required' });
    }
    const user = await getAdmissionUser(assignedTo);
    if (!user) return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be Admission member' });

    // Only validated leads can be assigned; re-assigning keeps the lead's current stage
    const result = await MetaCrmLead.updateMany(
      { _id: { $in: leadIds }, isDeleted: false, validationStatus: 'validated' },
      { $set: { assignedTo: user._id, assignedAt: new Date(), assignedBy: req.user.id } }
    );
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'MetaCrmLead', 'Bulk Operation',
      `Bulk assigned ${result.modifiedCount} Meta lead(s) to ${user.name}`);

    const skipped = leadIds.length - result.matchedCount;
    return res.json({
      ok: true,
      assigned: result.modifiedCount,
      message: `${result.modifiedCount} lead(s) assigned successfully${skipped > 0 ? ` (${skipped} skipped — not validated)` : ''}`
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI re-score (DM/Admin)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/rescore', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const unscored = await MetaCrmLead.find({ aiScore: null, isDeleted: false }).lean();
    unscored.forEach(lead => scoreLeadAsync(MetaCrmLead, lead._id, lead));
    return res.json({ ok: true, queued: unscored.length, message: unscored.length ? `Scoring ${unscored.length} lead(s) in background` : 'All leads already scored' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads/quality-report?from&to — bad/lost leads by reason, campaign, ad
// Lets DM see which campaigns/ads bring junk leads.
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/quality-report', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { isDeleted: false };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to)   match.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    const byCampaignAd = await MetaCrmLead.aggregate([
      { $match: match },
      { $group: {
          _id: { campaign: '$metaCampaignName', ad: '$metaAdName' },
          total:    { $sum: 1 },
          bad:      { $sum: { $cond: [{ $eq: ['$leadQuality', 'Bad'] }, 1, 0] } },
          lost:     { $sum: { $cond: [{ $eq: ['$leadQuality', 'Lost'] }, 1, 0] } },
          admitted: { $sum: { $cond: [{ $eq: ['$status', 'Admitted'] }, 1, 0] } }
      } },
      { $sort: { total: -1 } }
    ]);
    const byReason = await MetaCrmLead.aggregate([
      { $match: { ...match, leadQuality: { $in: ['Bad', 'Lost'] } } },
      { $group: { _id: { quality: '$leadQuality', reason: '$qualityReason' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    return res.json({
      reasons: { bad: BAD_LEAD_REASONS, lost: LOST_LEAD_REASONS },
      byReason: byReason.map(r => ({ quality: r._id.quality, reason: r._id.reason, count: r.count })),
      byCampaignAd: byCampaignAd.map(r => ({
        campaign: r._id.campaign || '(none)', ad: r._id.ad || '(none)',
        total: r.total, bad: r.bad, lost: r.lost, admitted: r.admitted,
        badRate: r.total ? Math.round((r.bad / r.total) * 1000) / 10 : 0
      }))
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Meta CAPI queue — DM reviews and sends CRM stage events
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/capi-log', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { sendStatus, event, from, to, page = 1, limit = 50 } = req.query;
    const query = { pipeline: 'crm' };
    if (event) query.event = event;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)   query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    const listQuery = sendStatus ? { ...query, sendStatus } : query;

    const skip = (Number(page) - 1) * Number(limit);
    const [total, pendingCount, sentCount, failedCount, logs] = await Promise.all([
      CapiEventLog.countDocuments(listQuery),
      CapiEventLog.countDocuments({ ...query, sendStatus: 'pending' }),
      CapiEventLog.countDocuments({ ...query, sendStatus: 'sent' }),
      CapiEventLog.countDocuments({ ...query, sendStatus: 'failed' }),
      CapiEventLog.find(listQuery).sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
    ]);

    return res.json({ logs, total, pendingCount, sentCount, failedCount, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Body: { logIds: [...] } or { sendAll: true }. Events that fail for a
// temporary reason stay pending and are retried (also by the nightly job).
router.post('/capi-log/send', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { logIds, sendAll } = req.body || {};
    const result = await sendPendingCapiEvents({
      logIds: sendAll ? undefined : (Array.isArray(logIds) ? logIds : []),
      userId: req.user.id
    });
    const message = result.message || [
      `${result.sent} sent`,
      result.retrying ? `${result.retrying} will retry` : null,
      result.failed ? `${result.failed} failed` : null
    ].filter(Boolean).join(', ');
    return res.json({ ok: true, ...result, message });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Single-lead history + admin comments (same shape as /api/leads/:id/history)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id/history', requireAuth, async (req, res) => {
  try {
    const lead = await loadPopulated(req.params.id);
    if (!lead || lead.isDeleted) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    const role = req.user?.role;
    const obj = lead.toObject({ flattenMaps: true });
    if (role === 'Admission') {
      if (!lead.assignedTo || String(lead.assignedTo._id) !== String(req.user.id)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot view history for unassigned lead' });
      }
      delete obj.aiScore; delete obj.aiScoredAt; delete obj.leadTemperature;
    } else if (!['Admin', 'SuperAdmin', 'DigitalMarketing', 'ITAdmin'].includes(role)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
    }
    return res.json({ lead: obj });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

router.post('/:id/admin-comment', requireAuth, authorize(ADMIN_ROLES), async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Comment text is required' });

    const lead = await MetaCrmLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    lead.adminComments.push({ text: text.trim(), at: new Date(), by: req.user.id });
    await lead.save();
    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'MetaCrmLead', lead.name,
      `Added admin comment on Meta lead: ${lead.name} (${lead.leadId})`);

    return res.json({ lead: (await loadPopulated(lead._id)).toObject({ flattenMaps: true }) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edit / delete (DM/Admin)
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { name, phone, email, interestedCourse, specialFilter } = req.body || {};
    const lead = await MetaCrmLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    if (name) lead.name = name;
    if (phone !== undefined) lead.phone = phone;
    if (email !== undefined) lead.email = email?.toLowerCase();
    if (interestedCourse !== undefined) lead.interestedCourse = interestedCourse;
    if (specialFilter !== undefined) lead.specialFilter = specialFilter;
    await lead.save();

    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'UPDATE', 'MetaCrmLead', lead.name,
      `Updated Meta lead: ${lead.name} (${lead.leadId})`);
    return res.json({ lead: await loadPopulated(lead._id) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Soft delete — keeps fee/batch references intact
router.delete('/:id', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const lead = await MetaCrmLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    if (lead.status === 'Admitted') {
      return res.status(400).json({ code: 'INVALID_STATE', message: 'Admitted leads cannot be deleted' });
    }

    lead.isDeleted = true;
    lead.deletedAt = new Date();
    lead.deletedBy = req.user.id;
    await lead.save();

    await logActivity(req.user.id, req.user.name, req.user.email, req.user.role, 'DELETE', 'MetaCrmLead',
      `${lead.name} (${lead.leadId})`, `Deleted Meta lead: ${lead.name} - ${lead.phone || 'N/A'} - ${lead.interestedCourse || 'N/A'}`);
    return res.json({ ok: true, message: 'Lead deleted successfully' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
