import express          from 'express';
import mongoose         from 'mongoose';
import { timingSafeEqual, createHmac } from 'crypto';

import MetaLead         from '../models/MetaLead.js';
import User             from '../models/User.js';
import { requireAuth }  from '../middleware/auth.js';
import { authorize }    from '../middleware/authorize.js';
import { scoreLeadAsync } from '../utils/aiScoring.js';
import { sendMetaCapiEvent } from '../utils/metaCapi.js';
import CapiEventLog from '../models/CapiEventLog.js';
import { runRoundRobinAssignment } from '../jobs/roundRobin.js';

const router = express.Router();

// ── Routing log — in-memory, last 50 auto-assignments ────────────────────────
const routingLog = [];
function logRouting(entry) {
  routingLog.unshift({ ...entry, at: new Date() });
  if (routingLog.length > 50) routingLog.pop();
}

// ── SSE clients — push instant updates to open browser tabs ─────────────────
// Map<userId, Set<res>> — one user may have multiple tabs open
const sseClients = new Map();

function addClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
}

function removeClient(userId, res) {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(userId);
}

// Push to ALL connected users (admin broadcast)
function pushLeadEvent(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(set => {
    set.forEach(res => { try { res.write(msg); } catch { /* dead connection */ } });
  });
}

// Push only to a specific user (counsellor notification)
function pushToUser(userId, payload) {
  const set = sseClients.get(String(userId));
  if (!set) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  set.forEach(res => { try { res.write(msg); } catch { /* dead connection */ } });
}

// GET /api/meta-leads/events — browser connects here, stays open
// EventSource can't set headers so accept token via query param as fallback
router.get('/events', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');

  const userId = String(req.user.id);
  addClient(userId, res);

  // Keepalive every 25s — prevents proxies/routers from closing idle connections
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(keepAlive); removeClient(userId, res); }
  }, 25000);

  req.on('close', () => { removeClient(userId, res); clearInterval(keepAlive); });
});

// ── Roles ────────────────────────────────────────────────────────────────────
const DM_ROLES      = ['DigitalMarketing'];
const MANAGE_ROLES  = ['DigitalMarketing', 'Admin', 'SuperAdmin', 'ITAdmin'];
const VIEW_ROLES    = ['DigitalMarketing', 'Admin', 'SuperAdmin', 'ITAdmin', 'Admission', 'HeadOfCreative'];
const ADMIN_ROLES   = ['Admin', 'SuperAdmin', 'ITAdmin'];

// ── Score field stripping (Admission must NEVER see score) ───────────────────
// aiReasoning is intentionally NOT in this list — counsellors see the
// qualitative "why" so they can prep for the call, but never the raw
// score or Hot/Warm/Cold label (avoids biasing how hard they try).
const SCORE_FIELDS = ['aiScore', 'aiScoredAt', 'leadTemperature'];

function sanitize(leadDoc, role) {
  const obj = leadDoc.toObject ? leadDoc.toObject({ flattenMaps: true }) : { ...leadDoc };
  if (role === 'Admission') {
    SCORE_FIELDS.forEach(f => delete obj[f]);
  }
  return obj;
}

function sanitizeMany(leads, role) {
  return leads.map(l => sanitize(l, role));
}

// ── Counter for ML-YYYY-NNNNN IDs ────────────────────────────────────────────
const CounterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } }
);
const Counter = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

async function genMetaLeadId() {
  const year = new Date().getFullYear();
  const key  = `meta-lead-${year}`;
  const ctr  = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `ML-${year}-${String(ctr.seq).padStart(5, '0')}`;
}

// ── Duplicate detection ───────────────────────────────────────────────────────
async function isDuplicate(phone, email, interestedCourse) {
  const since = new Date();
  since.setDate(since.getDate() - 180);

  const orClause = [];
  if (phone) orClause.push({ phone });
  if (email) orClause.push({ email: email.toLowerCase() });
  if (!orClause.length) return false;

  const dup = await MetaLead.findOne({
    $and: [
      { createdAt: { $gte: since } },
      { interestedCourse: interestedCourse || '' },
      { $or: orClause },
      { isDeleted: false }
    ]
  });
  return !!dup;
}

// ── Instant lead routing ──────────────────────────────────────────────────────
// Finds on-duty counsellors and picks the one with fewest leads assigned today.
// Returns the chosen counsellor or null if none are on duty.
async function pickOnDutyCounsellor() {
  const onDuty = await User.find({
    role:                     'Admission',
    isActive:                 true,
    availableForInstantLeads: true,
    onLeave:                  { $ne: true }
  }).lean();

  if (onDuty.length === 0) return null;
  if (onDuty.length === 1) return onDuty[0];

  // Count leads assigned TODAY per counsellor — give next lead to whoever has fewest
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const counts = await MetaLead.aggregate([
    { $match: {
        assignedTo: { $in: onDuty.map(u => u._id) },
        assignedAt: { $gte: todayStart },
        isDeleted:  false
    }},
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
  ]);

  const countMap = {};
  counts.forEach(c => { countMap[String(c._id)] = c.count; });

  // Sort by lead count ascending, then by displayOrder for tie-breaking
  onDuty.sort((a, b) => {
    const diff = (countMap[String(a._id)] || 0) - (countMap[String(b._id)] || 0);
    return diff !== 0 ? diff : (a.displayOrder || 0) - (b.displayOrder || 0);
  });

  return onDuty[0];
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

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads/webhook
// Make.com sends Meta lead data here. No JWT — secured by WEBHOOK_SECRET header.
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/webhook', async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid webhook secret' });
  }

  try {
    const body = req.body || {};

    // ── Parse Meta's nested field_data array ──────────────────────────────────
    // Make.com sends Meta leads with field_data: [{name:"full_name", values:["John"]}, ...]
    // We flatten it into a plain object so the rest of the code works identically
    // for both raw Make.com payloads and manual test POSTs.
    const flat = {};
    let fieldDataArr = body.field_data;
    // Make.com sometimes sends field_data as a JSON string instead of a real array
    if (typeof fieldDataArr === 'string') {
      try { fieldDataArr = JSON.parse(fieldDataArr); } catch { fieldDataArr = []; }
    }
    if (Array.isArray(fieldDataArr)) {
      fieldDataArr.forEach(({ name: fieldName, values }) => {
        if (fieldName && Array.isArray(values) && values.length > 0) {
          flat[fieldName] = values[0]; // Meta always wraps values in an array
        }
      });
    }
    // Merge: flat fields from field_data take priority over top-level keys
    const merged = { ...body, ...flat };

    // ── Normalise field names (handles snake_case / camelCase / Meta names) ──
    const name  = merged.full_name || merged.name || merged.fullName || '';
    let   phone = merged.phone_number || merged.phone || merged.phoneNumber || '';
    let   email = (merged.email || '').toLowerCase().trim();

    // ── Fallback: scan all merged keys for anything containing 'phone' or 'email' ──
    // Catches cases where Make.com maps form fields with custom/different key names
    if (!phone || !email) {
      for (const [k, v] of Object.entries(merged)) {
        if (!v || typeof v !== 'string') continue;
        const key = k.toLowerCase();
        if (!phone && key.includes('phone')) phone = v;
        if (!email && key.includes('email')) email = v.toLowerCase().trim();
      }
    }

    // ── Also scan inside field_data if it was sent as a flat JSON object string ──
    // Make.com sometimes serialises field_data as a key:value object instead of array
    if ((!phone || !email) && typeof body.field_data === 'string') {
      try {
        const fd = JSON.parse(body.field_data);
        if (fd && typeof fd === 'object' && !Array.isArray(fd)) {
          for (const [k, v] of Object.entries(fd)) {
            if (!v || typeof v !== 'string') continue;
            const key = k.toLowerCase();
            if (!phone && key.includes('phone')) phone = v;
            if (!email && key.includes('email')) email = v.toLowerCase().trim();
          }
        }
      } catch {}
    }
    const course           = merged.interestedCourse || merged.interested_course || merged.course || '';
    const metaLeadId       = merged.id || merged.lead_id || merged.leadId || '';
    const metaFormId       = merged.form_id || merged.formId || '';
    const metaAdName       = merged.ad_name || merged.adName || '';
    const metaCampaignName = merged.campaign_name || merged.campaignName || '';
    const metaCampaignId   = merged.campaign_id || merged.campaignId || '';
    const PLATFORM_MAP = { fb: 'Facebook', ig: 'Instagram', wa: 'WhatsApp', messenger: 'Messenger' };
    const rawPlatform      = merged.platform || '';
    const platform         = PLATFORM_MAP[rawPlatform.toLowerCase()] || rawPlatform || '';
    const isOrganic        = merged.is_organic === true || merged.isOrganic === true;

    if (!name && !phone && !email) {
      return res.status(400).json({ code: 'EMPTY_LEAD', message: 'Lead must have at least name, phone, or email' });
    }

    // ── CAMPAIGN FILTER (currently disabled — uncomment the block below to activate) ──────────────
    // PURPOSE: Only capture leads from campaigns whose name contains the word "course"
    //          (case-insensitive: matches "Course", "COURSE", "course", etc.).
    //          Any lead coming from a campaign that does NOT contain "course" in its name
    //          will be silently skipped (returns 200 SKIPPED, nothing saved to DB).
    //
    // EXAMPLES:
    //   ✅ Captured  → "IELTS Course 2026", "Python COURSE Leads", "course registration"
    //   ⛔ Skipped   → "Awareness Campaign Q3", "Hiring 2026", "Brand Promotion"
    //   ✅ Captured  → leads with no campaign name (safe fallback, not filtered out)
    //
    // HOW TO ACTIVATE: Remove the /* and */ comment wrappers below.
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    /*
    if (metaCampaignName && !/course/i.test(metaCampaignName)) {
      return res.status(200).json({ code: 'SKIPPED', message: 'Lead skipped: campaign is not course-related' });
    }
    */

    // Dedup by Meta lead ID (fastest check)
    if (metaLeadId) {
      const existing = await MetaLead.findOne({ metaLeadId, isDeleted: false });
      if (existing) {
        return res.status(200).json({ code: 'DUPLICATE', message: 'Lead already imported', leadId: existing.leadId });
      }
    }

    // Dedup by phone/email within same course
    if (await isDuplicate(phone, email, course)) {
      return res.status(200).json({ code: 'DUPLICATE', message: 'Duplicate phone/email for this course' });
    }

    // Col 8: store original raw body (including field_data array) for full audit trail
    const rawQuestionData = body;

    // Collect extra Q&A from Meta form as customFields (any key not in our known set)
    const knownKeys = new Set(['full_name','name','fullName','phone_number','phone','phoneNumber',
      'email','interestedCourse','interested_course','course','id','lead_id','leadId',
      'form_id','formId','ad_name','adName','campaign_id','campaignId',
      'campaign_name','campaignName','platform','is_organic','isOrganic','field_data',
      'created_time','ad_id']);
    const customFields = {};
    // Pull from flattened fields first (covers Meta custom questions)
    for (const [k, v] of Object.entries(merged)) {
      if (!knownKeys.has(k) && v != null && typeof v !== 'object') {
        customFields[k] = String(v);
      }
    }

    const lead = await MetaLead.create({
      leadId:           await genMetaLeadId(),
      name:             name || 'Unknown',
      phone:            phone || undefined,
      email:            email || undefined,
      interestedCourse: course,
      source:           'Meta Lead',
      metaLeadId,
      metaFormId,
      metaAdName,
      metaCampaignName,
      metaCampaignId,
      platform,
      isOrganic,
      rawQuestionData,
      customFields,
      validationStatus: 'validated',
      status:           'Pending'
    });

    // Fire AI scoring asynchronously — non-blocking
    scoreLeadAsync(MetaLead, lead._id, lead);

    // ── Instant routing — assign to on-duty counsellor if available ───────────
    const counsellor = await pickOnDutyCounsellor();
    if (counsellor) {
      await MetaLead.findByIdAndUpdate(lead._id, {
        assignedTo:   counsellor._id,
        assignedAt:   new Date(),
        autoAssigned: true,
        status:       'Assigned'
      });
      // Log for admin routing log panel
      logRouting({ leadId: lead.leadId, name: lead.name, counsellor: counsellor.name, phone: lead.phone || '' });

      // Broadcast NEW_LEAD to all admin/DM tabs to refresh the list
      pushLeadEvent({
        type:         'NEW_LEAD',
        leadId:       lead.leadId,
        name:         lead.name,
        assignedTo:   String(counsellor._id),
        counsellor:   counsellor.name,
        autoAssigned: true
      });
      // Push targeted LEAD_ASSIGNED directly to the counsellor's browser
      pushToUser(String(counsellor._id), {
        type:    'LEAD_ASSIGNED',
        leadId:  lead.leadId,
        name:    lead.name,
        phone:   lead.phone || '',
        email:   lead.email || '',
        course:  lead.interestedCourse || '',
        link:    '/meta-leads/queue'
      });
    } else {
      // No one on duty — push to admin tabs as unassigned
      pushLeadEvent({ type: 'NEW_LEAD', leadId: lead.leadId, name: lead.name, autoAssigned: false });
    }

    return res.status(201).json({
      ok:          true,
      leadId:      lead.leadId,
      autoAssigned: !!counsellor,
      assignedTo:   counsellor ? counsellor.name : null
    });
  } catch (e) {
    console.error('[Webhook] Error:', e.message);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads
// Manual lead creation by DM/Admin. Auto-validated (no pending gate needed).
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { name, phone, email, interestedCourse, source, manualScore, customFields } = req.body || {};

    if (!name) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Name is required' });

    if (await isDuplicate(phone, email, interestedCourse)) {
      return res.status(409).json({ code: 'DUPLICATE', message: 'Duplicate phone/email for this course' });
    }

    const lead = await MetaLead.create({
      leadId:           await genMetaLeadId(),
      name,
      phone:            phone || undefined,
      email:            email?.toLowerCase() || undefined,
      interestedCourse: interestedCourse || '',
      source:           source || 'Manually Generated Lead',
      manualScore:      manualScore || null,
      customFields:     customFields || {},
      validationStatus: 'validated',
      validatedBy:      req.user.id,
      validatedAt:      new Date(),
      status:           'Pending',
      assignedBy:       req.user.id
    });

    scoreLeadAsync(MetaLead, lead._id, lead);

    return res.status(201).json({ ok: true, lead: sanitize(lead, req.user.role) });
  } catch (e) {
    console.error('[MetaLeads] Create error:', e.message);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads/stats
// Count by status and validation state. Admission sees only their own counts.
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/stats', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const baseQ = { isDeleted: false };
    if (req.user.role === 'Admission') baseQ.assignedTo = req.user.id;

    const [
      pending, validated, rejected,
      statusCounts, tempCounts,
      followUpOverdue, followUpStuck
    ] = await Promise.all([
      MetaLead.countDocuments({ ...baseQ, validationStatus: 'pending' }),
      MetaLead.countDocuments({ ...baseQ, validationStatus: 'validated', assignedTo: null }),
      MetaLead.countDocuments({ ...baseQ, validationStatus: 'rejected' }),
      MetaLead.aggregate([
        { $match: { ...baseQ } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      MetaLead.aggregate([
        { $match: { ...baseQ, leadTemperature: { $in: ['Hot', 'Warm', 'Cold'] } } },
        { $group: { _id: '$leadTemperature', count: { $sum: 1 } } }
      ]),
      // #2: overdue follow-ups (next date already passed)
      MetaLead.countDocuments({ ...baseQ, status: 'In Follow Up', nextFollowUpDate: { $lt: new Date() } }),
      // #1: "stuck" — 5+ touches, still in follow-up, never converted
      MetaLead.countDocuments({ ...baseQ, status: 'In Follow Up', $expr: { $gte: [{ $size: { $ifNull: ['$followUps', []] } }, 5] } })
    ]);

    const byStatus      = {};
    const byTemperature = {};
    statusCounts.forEach(s => { byStatus[s._id]      = s.count; });
    tempCounts.forEach(t   => { byTemperature[t._id] = t.count; });

    return res.json({
      pending, validatedUnassigned: validated, rejected, byStatus, byTemperature,
      followUpOverdue, followUpStuck
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads
// DM/Admin: all leads. Admission: only their assigned leads. Score stripped for Admission.
// Query params: validationStatus, status, temperature, minScore, platform, from, to, q, page, limit
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const {
      validationStatus, status, temperature, minScore,
      platform, from, to,
      page = 1, limit = 50, q, unassignedOnly, assignedTo,
      overdueOnly, stuckOnly
    } = req.query;

    const query = { isDeleted: false };

    // Admission sees only their own leads
    if (req.user.role === 'Admission') query.assignedTo = req.user.id;
    // Admin/DM can filter by a specific counsellor
    else if (assignedTo) query.assignedTo = assignedTo;

    if (validationStatus) query.validationStatus = validationStatus;
    if (status)           query.status           = status;
    if (temperature)      query.leadTemperature  = temperature;         // Hot / Warm / Cold
    if (platform)         query.platform         = platform;
    if (unassignedOnly === 'true') query.assignedTo = null;
    if (overdueOnly === 'true') {
      query.status = 'In Follow Up';
      query.nextFollowUpDate = { $lt: new Date() };
    }
    if (stuckOnly === 'true') {
      query.status = 'In Follow Up';
      query.$expr = { $gte: [{ $size: { $ifNull: ['$followUps', []] } }, 5] };
    }

    // Score filter: only leads with aiScore >= minScore
    if (minScore) query.aiScore = { $gte: Number(minScore) };

    // Date range on createdAt
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)   query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    // Search across name / phone / email / leadId
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: re }, { phone: re }, { email: re }, { leadId: re }];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await MetaLead.countDocuments(query);

    const leads = await MetaLead.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('assignedTo', 'name email role')
      .populate('assignedBy', 'name email role')
      .populate('validatedBy', 'name email');

    return res.json({
      leads: sanitizeMany(leads, req.user.role),
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit))
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meta-leads/:id
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const lead = await MetaLead.findOne({ _id: req.params.id, isDeleted: false })
      .populate('assignedTo',  'name email role')
      .populate('assignedBy',  'name email role')
      .populate('validatedBy', 'name email')
      .populate('followUps.by', 'name email');

    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    // Admission can only view their own leads
    if (req.user.role === 'Admission') {
      if (!lead.assignedTo || String(lead.assignedTo._id) !== String(req.user.id)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Access denied' });
      }
    }

    return res.json({ lead: sanitize(lead, req.user.role) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/meta-leads/:id/validate
// DM / Admin approves or rejects a pending lead. Scoring is 100% AI — no manual score.
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/:id/validate', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { action, assignedTo, rejectionReason } = req.body || {};

    if (!['validate', 'reject'].includes(action)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'action must be "validate" or "reject"' });
    }

    const lead = await MetaLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    if (action === 'reject') {
      lead.validationStatus = 'rejected';
      lead.rejectionReason  = rejectionReason || '';
      lead.validatedBy      = req.user.id;
      lead.validatedAt      = new Date();
      lead.status           = 'Archived';
    } else {
      lead.validationStatus = 'validated';
      lead.validatedBy      = req.user.id;
      lead.validatedAt      = new Date();

      // Optional immediate assignment after validation
      if (assignedTo) {
        const counsellor = await User.findById(assignedTo);
        if (!counsellor || counsellor.role !== 'Admission') {
          return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'assignedTo must be an Admission user' });
        }
        lead.assignedTo  = counsellor._id;
        lead.assignedBy  = req.user.id;
        lead.assignedAt  = new Date();
        lead.autoAssigned = false;
        lead.status      = 'Assigned';
      }
    }

    await lead.save();

    const populated = await MetaLead.findById(lead._id)
      .populate('assignedTo',  'name email role')
      .populate('validatedBy', 'name email');

    return res.json({ ok: true, lead: sanitize(populated, req.user.role) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/meta-leads/:id/assign
// Manually assign a validated lead to an Admission counsellor.
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/:id/assign', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { assignedTo } = req.body || {};

    const lead = await MetaLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    if (lead.validationStatus !== 'validated') {
      return res.status(400).json({ code: 'NOT_VALIDATED', message: 'Lead must be validated before assignment' });
    }

    const counsellor = await User.findById(assignedTo);
    if (!counsellor || counsellor.role !== 'Admission') {
      return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'assignedTo must be an Admission user' });
    }

    lead.assignedTo   = counsellor._id;
    lead.assignedBy   = req.user.id;
    lead.assignedAt   = new Date();
    lead.autoAssigned = false;
    lead.status       = 'Assigned';
    await lead.save();

    const populated = await MetaLead.findById(lead._id)
      .populate('assignedTo',  'name email role')
      .populate('assignedBy',  'name email role');

    return res.json({ ok: true, lead: sanitize(populated, req.user.role) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads/bulk-assign
// Assign multiple validated leads to a single counsellor.
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/bulk-assign', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { leadIds, assignedTo } = req.body || {};

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'leadIds array required' });
    }

    const counsellor = await User.findById(assignedTo);
    if (!counsellor || counsellor.role !== 'Admission') {
      return res.status(400).json({ code: 'INVALID_ASSIGNEE', message: 'assignedTo must be an Admission user' });
    }

    const result = await MetaLead.updateMany(
      { _id: { $in: leadIds }, validationStatus: 'validated', isDeleted: false },
      {
        $set: {
          assignedTo:   counsellor._id,
          assignedBy:   req.user.id,
          assignedAt:   new Date(),
          autoAssigned: false,
          status:       'Assigned'
        }
      }
    );

    return res.json({ ok: true, assigned: result.modifiedCount });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/meta-leads/bulk-reschedule  — #3 push multiple follow-ups to a new date
// Body: { leadIds: [...], nextFollowUpDate } OR { leadIds: [...], pushDays: N }
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/bulk-reschedule', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const { leadIds, nextFollowUpDate, pushDays } = req.body || {};
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'leadIds array required' });
    }
    if (!nextFollowUpDate && !pushDays) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'nextFollowUpDate or pushDays required' });
    }

    const matchQuery = { _id: { $in: leadIds }, isDeleted: false };
    // Counsellors can only reschedule their own leads
    if (req.user.role === 'Admission') matchQuery.assignedTo = req.user.id;

    let result;
    if (nextFollowUpDate) {
      // Set all selected leads to the same fixed date
      result = await MetaLead.updateMany(matchQuery, { $set: { nextFollowUpDate: new Date(nextFollowUpDate) } });
    } else {
      // Push each lead's existing date forward by N days (or from today if none set)
      const leads = await MetaLead.find(matchQuery).select('nextFollowUpDate');
      const ops = leads.map(lead => {
        const base = lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate) : new Date();
        base.setDate(base.getDate() + Number(pushDays));
        return { updateOne: { filter: { _id: lead._id }, update: { $set: { nextFollowUpDate: base } } } };
      });
      if (ops.length) await MetaLead.bulkWrite(ops);
      result = { modifiedCount: ops.length };
    }

    return res.json({ ok: true, rescheduled: result.modifiedCount });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/meta-leads/:id/log-touch  — #6 "Mark as called" — logs a touchpoint
// without changing status or follow-up date. Lightweight alternative to full
// status update when counsellor just wants to record they made contact.
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/:id/log-touch', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    const { note, outcome } = req.body || {}; // outcome: 'Called' | 'No Show' | 'No Answer'
    const lead = await MetaLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    if (req.user.role === 'Admission' && String(lead.assignedTo) !== String(req.user.id)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'You can only update your own leads' });
    }

    lead.followUps.push({
      note: note || outcome || 'Touchpoint logged',
      at:   new Date(),
      by:   req.user.id
    });
    await lead.save();

    const populated = await MetaLead.findById(lead._id).populate('followUps.by', 'name email');
    return res.json({ ok: true, lead: sanitize(populated, req.user.role) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/meta-leads/:id/status
// Counsellor or DM/Admin updates the pipeline status.
// Score fields stripped for Admission. CAPI event fired on relevant transitions.
// ═══════════════════════════════════════════════════════════════════════════════
router.patch('/:id/status', requireAuth, authorize(VIEW_ROLES), async (req, res) => {
  try {
    // Col 10–12: status, reason, counsellorFeedback
    const { status, notes, reason, counsellorFeedback, nextFollowUpDate, admittedToCourse, admittedToBatch } = req.body || {};

    const ALLOWED = ['Counseling', 'In Follow Up', 'Admitted', 'Not Admitted', 'Not Interested', 'Archived'];
    if (!ALLOWED.includes(status)) {
      return res.status(400).json({ code: 'INVALID_STATUS', message: `status must be one of: ${ALLOWED.join(', ')}` });
    }

    const lead = await MetaLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    // Admission can only update their own leads
    if (req.user.role === 'Admission') {
      if (!lead.assignedTo || String(lead.assignedTo) !== String(req.user.id)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'You can only update your own leads' });
      }
    }

    lead.status = status;
    if (notes              !== undefined) lead.notes              = notes;
    if (reason             !== undefined) lead.reason             = reason;             // Col 11
    if (counsellorFeedback !== undefined) lead.counsellorFeedback = counsellorFeedback; // Col 12

    // Stage timestamps
    if (status === 'Counseling' && !lead.counselingAt) lead.counselingAt = new Date();
    if (status === 'Admitted') {
      lead.admittedAt = new Date();
      if (admittedToCourse) lead.admittedToCourse = admittedToCourse;
      if (admittedToBatch)  lead.admittedToBatch  = admittedToBatch;
    }
    if (status === 'In Follow Up') {
      if (nextFollowUpDate) lead.nextFollowUpDate = new Date(nextFollowUpDate);
      lead.followUps.push({ note: notes || '', at: new Date(), by: req.user.id });
    }

    await lead.save();

    // Fire Meta CAPI async — never blocks response
    // sentToCapi only flips true on an actual successful delivery to Meta.
    // Every attempt (success or failure) is also written to CapiEventLog —
    // a dedicated, queryable collection separate from the embedded
    // capiEvents[] array, so DM/Admin can track sends without opening
    // each lead individually.
    sendMetaCapiEvent(lead, status)
      .then(result => {
        if (!result) return;
        MetaLead.findByIdAndUpdate(lead._id, {
          ...(result.success ? { sentToCapi: true } : {}),
          $push: { capiEvents: { event: result.event, success: result.success, at: new Date() } }
        }).catch(() => {});

        CapiEventLog.create({
          lead:          lead._id,
          leadDisplayId: lead.leadId,
          leadName:      lead.name,
          status,
          event:         result.event,
          success:       result.success,
          errorMessage:  result.errorMessage || '',
          eventsReceived: result.eventsReceived || 0
        }).catch(() => {});
      })
      .catch(() => {});

    const populated = await MetaLead.findById(lead._id)
      .populate('assignedTo', 'name email role')
      .populate('followUps.by', 'name email');

    return res.json({ ok: true, lead: sanitize(populated, req.user.role) });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads/rescore
// Re-score all leads that have no aiScore yet. DM / Admin only.
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/rescore', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const unscored = await MetaLead.find({ aiScore: null, isDeleted: false }).lean();
    if (unscored.length === 0) {
      return res.json({ ok: true, queued: 0, message: 'All leads already scored' });
    }
    unscored.forEach(lead => scoreLeadAsync(MetaLead, lead._id, lead));
    return res.json({ ok: true, queued: unscored.length, message: `Scoring ${unscored.length} lead(s) in background` });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ── GET /api/meta-leads/routing-log — recent auto-assignments (Admin/DM) ─────
router.get('/routing-log', requireAuth, authorize(MANAGE_ROLES), (req, res) => {
  res.json({ log: routingLog });
});

// ── GET /api/meta-leads/capi-log — dedicated Meta CAPI send tracking table ────
// Query params: success ('true'|'false'), event, from, to, page, limit
router.get('/capi-log', requireAuth, authorize(MANAGE_ROLES), async (req, res) => {
  try {
    const { success, event, from, to, page = 1, limit = 50 } = req.query;
    const query = {};
    if (success === 'true')  query.success = true;
    if (success === 'false') query.success = false;
    if (event) query.event = event;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)   query.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const [total, successCount, failCount, logs] = await Promise.all([
      CapiEventLog.countDocuments(query),
      CapiEventLog.countDocuments({ ...query, success: true }),
      CapiEventLog.countDocuments({ ...query, success: false }),
      CapiEventLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
    ]);

    return res.json({
      logs, total, successCount, failCount,
      page: Number(page),
      pages: Math.ceil(total / Number(limit))
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ── TEMPORARY: Force re-score ALL leads regardless of existing score ──────────
router.post('/rescore-all', requireAuth, authorize(ADMIN_ROLES), async (req, res) => {
  try {
    const all = await MetaLead.find({ isDeleted: false }).lean();
    all.forEach(lead => scoreLeadAsync(MetaLead, lead._id, lead));
    return res.json({ ok: true, queued: all.length, message: `Force re-scoring ${all.length} lead(s)` });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meta-leads/round-robin/trigger
// Admin / SuperAdmin manually triggers round-robin (useful for testing).
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/round-robin/trigger', requireAuth, authorize([...ADMIN_ROLES, 'DigitalMarketing']), async (req, res) => {
  try {
    const result = await runRoundRobinAssignment();
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/meta-leads/:id
// Soft delete — Admin / SuperAdmin only.
// ═══════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, authorize(ADMIN_ROLES), async (req, res) => {
  try {
    const lead = await MetaLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });

    lead.isDeleted = true;
    lead.deletedAt = new Date();
    lead.deletedBy = req.user.id;
    await lead.save();

    return res.json({ ok: true, message: 'Lead archived' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
