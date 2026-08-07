// api/routes/reports.js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

import Income from '../models/Income.js';
import Expense from '../models/Expense.js';
import AdmissionFee from '../models/AdmissionFee.js';
import RecruitmentIncome from '../models/RecruitmentIncome.js';
import RecruitmentExpense from '../models/RecruitmentExpense.js';
import DMExpense from '../models/DMExpense.js';

const router = Router();

// helpers
function parseRange(from, to) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today
  
  // If both from and to are provided, use them
  if (from && to) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    // Convert end to exclusive (next day at 00:00)
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    endExclusive.setHours(0, 0, 0, 0);
    return { start, end: endExclusive };
  }
  
  // If only from is provided, use from to today (inclusive)
  if (from) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const endExclusive = new Date(today);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return { start, end: endExclusive };
  }
  
  // If only to is provided, use to to today (inclusive)
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    endExclusive.setHours(0, 0, 0, 0);
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start, end: endExclusive };
  }
  
  // Default: month to date (first day of current month to today inclusive)
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const endExclusive = new Date(today);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { start, end: endExclusive };
}

// generic sum helper
async function sum(model, field, dateField, start, end, extra = {}) {
  const mDate = dateField || 'date';
  const [row] = await model.aggregate([
    { $match: { ...extra, [mDate]: { $gte: start, $lt: end } } },
    { $group: { _id: null, total: { $sum: `$${field}` } } }
  ]);
  return row?.total || 0;
}

/**
 * GET /api/reports/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Roles: SuperAdmin, Admin (read-only consolidated view)
 */
router.get('/overview', requireAuth, authorize(['SuperAdmin', 'Admin']), async (req, res, next) => {
  try {
    const { start, end } = parseRange(req.query.from, req.query.to);

    // Accounting (global)
    const accountingIncome = await sum(Income, 'amount', 'date', start, end);
    const accountingExpense = await sum(Expense, 'amount', 'date', start, end);
    const accountingNet = accountingIncome - accountingExpense;

    // Admission Fees (collected)
    const admissionCollected = await sum(AdmissionFee, 'amount', 'date', start, end);

    // Recruitment
    const recIncome = await sum(RecruitmentIncome, 'amount', 'date', start, end);
    const recExpense = await sum(RecruitmentExpense, 'amount', 'date', start, end);
    const recNet = recIncome - recExpense;

    // Digital Marketing — costs only (paid ads etc.)
    const dmCost = await sum(DMExpense, 'amount', 'date', start, end);

    // Combined snapshot
    const combinedExpense = accountingExpense + recExpense + dmCost;
    const combinedIncome = accountingIncome + admissionCollected + recIncome;
    const combinedNet = combinedIncome - combinedExpense;

    res.json({
      range: { from: req.query.from || null, to: req.query.to || null },
      accounting: { income: accountingIncome, expense: accountingExpense, net: accountingNet },
      admission: { collected: admissionCollected },
      recruitment: { income: recIncome, expense: recExpense, net: recNet },
      dm: { cost: dmCost },
      combined: { income: combinedIncome, expense: combinedExpense, net: combinedNet }
    });
  } catch (e) { next(e); }
});


/**
 * GET /api/reports/admission-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...&format=csv
 * Roles: Admission (own only), Admin, SuperAdmin
 * Returns counts: counselingCount, followUpCount, admittedCount, notAdmittedCount
 * 
 * USES LeadActivity COLLECTION - counts actions taken by specific advisor
 * Metrics:
 * - New Calls = counseling activity
 * - Follow-up Calls = follow_up activity
 * - Admitted = admitted activity
 * - Not Admitted = not_admitted activity
 * - Total Calls = New Calls + Follow-up Calls
 */
router.get('/admission-metrics', requireAuth, async (req, res) => {
  try {
    const { from, to, userId, format } = req.query;
    const { start, end } = parseRange(from, to);

    // Determine target user(s)
    let targetUserId = null;
    if (req.user.role === 'Admission') {
      // Admission users can only request their own metrics
      targetUserId = req.user.id;
    } else if (req.user.role === 'Admin' || req.user.role === 'SuperAdmin' || req.user.role === 'HeadOfCreative' || req.user.role === 'Accountant') {
      // Admins/HeadOfCreative/Accountant can request for specific user or all (no userId)
      targetUserId = userId || null;
    } else {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
    }

    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    const Lead = (await import('../models/Lead.js')).default;
    const mongoose = (await import('mongoose')).default;

    // Convert targetUserId to ObjectId if present
    const targetUserObjectId = targetUserId ? mongoose.Types.ObjectId.createFromHexString(targetUserId) : null;

    const baseMatch = { actionDate: { $gte: start, $lt: end } };
    if (targetUserObjectId) baseMatch.advisor = targetUserObjectId;

    // Calls made in the period: New (counseling) and Follow-up, grouped by advisor
    const counselingAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: 'counseling' } },
      { $group: { _id: '$advisor', count: { $sum: 1 } } }
    ]);
    const followUpAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: 'follow_up' } },
      { $group: { _id: '$advisor', count: { $sum: 1 } } }
    ]);

    const map = new Map();
    counselingAgg.forEach(r => map.set(String(r._id || 'unassigned'), { counselingCount: r.count, followUpCount: 0 }));
    followUpAgg.forEach(r => {
      const key = String(r._id || 'unassigned');
      const existing = map.get(key) || { counselingCount: 0, followUpCount: 0 };
      existing.followUpCount = r.count;
      map.set(key, existing);
    });

    // Outcome breakdown: for every DISTINCT lead called (counseling or follow-up) in this
    // period, classify it by its CURRENT status/priority into exactly one bucket —
    // Admitted, Interested, or Not Interested. This is a partition of the leads behind
    // the call counts above, not a separate independent activity count.
    const calledLeadsAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: { $in: ['counseling', 'follow_up'] } } },
      { $group: { _id: { advisor: '$advisor', lead: '$lead' } } }
    ]);
    const leadIds = [...new Set(calledLeadsAgg.map(r => String(r._id.lead)))];
    const calledLeads = await Lead.find({ _id: { $in: leadIds } }).select('status priority');
    const leadById = new Map(calledLeads.map(l => [String(l._id), l]));

    const outcomeByAdvisor = new Map();
    for (const r of calledLeadsAgg) {
      const advisorKey = String(r._id.advisor || 'unassigned');
      const lead = leadById.get(String(r._id.lead));
      if (!lead) continue;
      const bucket = outcomeByAdvisor.get(advisorKey) || { admittedCount: 0, interestedCount: 0, notAdmittedCount: 0 };
      if (lead.status === 'Admitted') bucket.admittedCount++;
      else if (lead.priority === 'Not Interested' || lead.status === 'Not Interested' || lead.status === 'Not Admitted') bucket.notAdmittedCount++;
      else bucket.interestedCount++;
      outcomeByAdvisor.set(advisorKey, bucket);
    }

    for (const [key, val] of map.entries()) {
      const o = outcomeByAdvisor.get(key) || { admittedCount: 0, interestedCount: 0, notAdmittedCount: 0 };
      Object.assign(val, o);
    }
    // Advisors who only have outcome data (shouldn't normally happen, but stay safe)
    for (const [key, o] of outcomeByAdvisor.entries()) {
      if (!map.has(key)) map.set(key, { counselingCount: 0, followUpCount: 0, ...o });
    }

    // If targetUserId specified, return single object
    if (targetUserId) {
      const key = String(targetUserId);
      const data = map.get(key) || { counselingCount: 0, followUpCount: 0, admittedCount: 0, interestedCount: 0, notAdmittedCount: 0 };
      // Total calls = New Calls + Follow-up Calls only (Admitted/Interested/Not Interested
      // are outcomes of those same calls, not additional call types)
      data.totalCalls = (data.counselingCount || 0) + (data.followUpCount || 0);

      if (format === 'csv' && (req.user.role === 'Admin' || req.user.role === 'SuperAdmin')) {
        // return CSV single row
        const rows = [
          'userId,newCalls,followUpCalls,totalCalls,admitted,interested,notInterested',
          `${key},${data.counselingCount},${data.followUpCount},${data.totalCalls},${data.admittedCount},${data.interestedCount},${data.notAdmittedCount}`
        ];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="admission-metrics-${key}.csv"`);
        return res.send(rows.join('\n'));
      }
      return res.json({
        userId: key,
        counselingCount: data.counselingCount,
        followUpCount: data.followUpCount,
        totalCalls: data.totalCalls,
        admittedCount: data.admittedCount,
        interestedCount: data.interestedCount,
        notAdmittedCount: data.notAdmittedCount,
        range: { from: from || null, to: to || null }
      });
    }

    // For admin: return array of user metrics. Need to populate user names
    const userIds = Array.from(map.keys()).filter(k => k !== 'unassigned');
    const users = await (await import('../models/User.js')).default.find({ _id: { $in: userIds } }).select('name role');
    const usersById = {};
    users.forEach(u => { usersById[String(u._id)] = u; });

    const results = [];
    for (const [key, val] of map.entries()) {
      if (key === 'unassigned') continue;
      const totalCalls = (val.counselingCount || 0) + (val.followUpCount || 0);
      results.push({
        userId: key,
        userName: usersById[key]?.name || null,
        counselingCount: val.counselingCount,
        followUpCount: val.followUpCount,
        totalCalls: totalCalls,
        admittedCount: val.admittedCount || 0,
        interestedCount: val.interestedCount || 0,
        notAdmittedCount: val.notAdmittedCount || 0
      });
    }

    if (format === 'csv') {
      // generate CSV
      const header = ['userId,userName,newCalls,followUpCalls,totalCalls,admitted,interested,notInterested'];
      const rows = results.map(r => `${r.userId},"${(r.userName||'').replace(/"/g,'""')}",${r.counselingCount},${r.followUpCount},${r.totalCalls},${r.admittedCount},${r.interestedCount},${r.notAdmittedCount}`);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="admission-metrics-${from||'all'}-${to||'all'}.csv"`);
      return res.send([header.join(','), ...rows].join('\n'));
    }

    return res.json({
      range: { from: from || null, to: to || null },
      metrics: results
    });
  } catch (e) {
    console.error('Admission metrics error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * DEBUG ENDPOINT: GET /api/reports/admission-metrics-debug?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns raw matched leads for inspection (counselingAt and followUps in range)
 * Helps diagnose why aggregation returns zeros
 */
router.get('/admission-metrics-debug', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    
    const Lead = (await import('../models/Lead.js')).default;

    // Find leads with counselingAt in range
    const counselingLeads = await Lead.find({
      assignedTo: req.user.id,
      counselingAt: { $gte: start, $lt: end }
    }).select('_id leadId name status counselingAt assignedTo');

    // Find leads with followUps in range
    const followUpLeads = await Lead.find({
      assignedTo: req.user.id,
      followUps: { $exists: true, $ne: [] }
    }).select('_id leadId name status followUps');

    const followUpLeadsInRange = followUpLeads.filter(lead => 
      lead.followUps.some(fu => fu.at >= start && fu.at < end)
    );

    console.log(`[DEBUG] parseRange(${from}, ${to}) = [${start}, ${end})`);
    console.log(`[DEBUG] Counseling leads found: ${counselingLeads.length}`);
    console.log(`[DEBUG] Follow-up leads in range: ${followUpLeadsInRange.length}`);

    return res.json({
      range: { from: from || null, to: to || null, start: start.toISOString(), end: end.toISOString() },
      counselingLeads: counselingLeads.map(l => ({
        leadId: l.leadId,
        status: l.status,
        counselingAt: l.counselingAt
      })),
      followUpLeadsInRange: followUpLeadsInRange.map(l => ({
        leadId: l.leadId,
        status: l.status,
        followUps: l.followUps.filter(fu => fu.at >= start && fu.at < end)
      })),
      summary: {
        totalCounselingLeads: counselingLeads.length,
        totalFollowUpLeads: followUpLeadsInRange.length,
        parsedStart: start.toISOString(),
        parsedEnd: end.toISOString()
      }
    });
  } catch (e) {
    console.error('Debug metrics error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * GET /api/reports/admission-team-stats?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...
 * Returns:
 * - totalAssignedLeads / remainingNewLeads: pipeline snapshot from the Lead collection
 *   (leads assigned to the user, created within the period; remaining = still "Assigned")
 * - firstTimeCalls / followUpCalls: call counts from LeadActivity (actionDate within period)
 * - admitted / interested / notInterested: outcome breakdown of the DISTINCT leads called
 *   in the period, classified by current status/priority — same source and definition used
 *   by /admission-metrics, so a team member's own "My Metrics" numbers match what an Admin
 *   sees here for that same member and period.
 */
router.get('/admission-team-stats', requireAuth, authorize(['SuperAdmin', 'Admin', 'Accountant', 'HeadOfCreative', 'Admission']), async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    const { start, end } = parseRange(from, to);

    const Lead = (await import('../models/Lead.js')).default;
    const User = (await import('../models/User.js')).default;
    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    const mongoose = (await import('mongoose')).default;

    // Determine target user(s)
    let targetUserId = null;
    if (req.user.role === 'Admission') {
      targetUserId = req.user.id;
    } else if (['Admin', 'SuperAdmin', 'HeadOfCreative', 'Accountant'].includes(req.user.role)) {
      targetUserId = userId || null;
    } else {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
    }

    // --- Pipeline snapshot (Lead collection) ---
    const leadMatch = { createdAt: { $gte: start, $lt: end } };
    if (targetUserId) {
      leadMatch.assignedTo = mongoose.Types.ObjectId.createFromHexString(targetUserId);
    } else {
      const admissionUsers = await User.find({ role: 'Admission' }).select('_id');
      leadMatch.assignedTo = { $in: admissionUsers.map(u => u._id) };
    }
    const leads = await Lead.find(leadMatch).select('status assignedTo');

    const totalAssignedLeads = leads.length;
    const remainingNewLeads = leads.filter(l => l.status === 'Assigned').length;

    // --- Call-activity metrics (LeadActivity collection), same source as /admission-metrics ---
    const activityMatch = { actionDate: { $gte: start, $lt: end } };
    if (targetUserId) {
      activityMatch.advisor = mongoose.Types.ObjectId.createFromHexString(targetUserId);
    }

    const [counselingAgg, followUpAgg] = await Promise.all([
      LeadActivity.aggregate([{ $match: { ...activityMatch, activityType: 'counseling' } }, { $group: { _id: '$advisor', count: { $sum: 1 } } }]),
      LeadActivity.aggregate([{ $match: { ...activityMatch, activityType: 'follow_up' } }, { $group: { _id: '$advisor', count: { $sum: 1 } } }]),
    ]);

    const activityMap = new Map();
    const bump = (agg, field) => agg.forEach(r => {
      const key = String(r._id || 'unassigned');
      const existing = activityMap.get(key) || { firstTimeCalls: 0, followUpCalls: 0, admitted: 0, interested: 0, notInterested: 0 };
      existing[field] = r.count;
      activityMap.set(key, existing);
    });
    bump(counselingAgg, 'firstTimeCalls');
    bump(followUpAgg, 'followUpCalls');

    // Outcome breakdown: for every DISTINCT lead called (counseling or follow-up) in this
    // period, classify it by its CURRENT status/priority — same logic as /admission-metrics —
    // so the two pages agree for the same person and period.
    const calledLeadsAgg = await LeadActivity.aggregate([
      { $match: { ...activityMatch, activityType: { $in: ['counseling', 'follow_up'] } } },
      { $group: { _id: { advisor: '$advisor', lead: '$lead' } } }
    ]);
    const calledLeadIds = [...new Set(calledLeadsAgg.map(r => String(r._id.lead)))];
    const calledLeads = await Lead.find({ _id: { $in: calledLeadIds } }).select('status priority');
    const calledLeadById = new Map(calledLeads.map(l => [String(l._id), l]));

    for (const r of calledLeadsAgg) {
      const advisorKey = String(r._id.advisor || 'unassigned');
      const lead = calledLeadById.get(String(r._id.lead));
      if (!lead) continue;
      const bucket = activityMap.get(advisorKey) || { firstTimeCalls: 0, followUpCalls: 0, admitted: 0, interested: 0, notInterested: 0 };
      if (lead.status === 'Admitted') bucket.admitted++;
      else if (lead.priority === 'Not Interested' || lead.status === 'Not Interested' || lead.status === 'Not Admitted') bucket.notInterested++;
      else bucket.interested++;
      activityMap.set(advisorKey, bucket);
    }

    if (targetUserId) {
      const a = activityMap.get(String(targetUserId)) || { firstTimeCalls: 0, followUpCalls: 0, admitted: 0, interested: 0, notInterested: 0 };
      return res.json({
        range: { from: from || null, to: to || null },
        totalAssignedLeads,
        remainingNewLeads,
        firstTimeCalls: a.firstTimeCalls,
        followUpCalls: a.followUpCalls,
        admitted: a.admitted,
        interested: a.interested,
        notInterested: a.notInterested,
        perUserStats: null
      });
    }

    // Team-wide totals = sum across all advisors' activity in the period
    let firstTimeCalls = 0, followUpCalls = 0, admitted = 0, interested = 0, notInterested = 0;
    for (const a of activityMap.values()) {
      firstTimeCalls += a.firstTimeCalls;
      followUpCalls += a.followUpCalls;
      admitted += a.admitted;
      interested += a.interested;
      notInterested += a.notInterested;
    }

    // Per-user breakdown: merge lead-based pipeline counts with activity-based call counts
    const leadStatsByUser = new Map();
    leads.forEach(lead => {
      const key = String(lead.assignedTo);
      const s = leadStatsByUser.get(key) || { totalAssignedLeads: 0, remainingNewLeads: 0 };
      s.totalAssignedLeads++;
      if (lead.status === 'Assigned') s.remainingNewLeads++;
      leadStatsByUser.set(key, s);
    });

    const allUserIds = new Set([...leadStatsByUser.keys(), ...activityMap.keys()]);
    allUserIds.delete('unassigned');
    const users = await User.find({ _id: { $in: Array.from(allUserIds) } }).select('name');
    const usersById = {};
    users.forEach(u => { usersById[String(u._id)] = u.name; });

    const perUserStats = [];
    for (const key of allUserIds) {
      const leadStats = leadStatsByUser.get(key) || { totalAssignedLeads: 0, remainingNewLeads: 0 };
      const activityStats = activityMap.get(key) || { firstTimeCalls: 0, followUpCalls: 0, admitted: 0, interested: 0, notInterested: 0 };
      perUserStats.push({
        userId: key,
        userName: usersById[key] || 'Unknown',
        totalAssignedLeads: leadStats.totalAssignedLeads,
        remainingNewLeads: leadStats.remainingNewLeads,
        firstTimeCalls: activityStats.firstTimeCalls,
        followUpCalls: activityStats.followUpCalls,
        admitted: activityStats.admitted,
        interested: activityStats.interested,
        notInterested: activityStats.notInterested
      });
    }

    return res.json({
      range: { from: from || null, to: to || null },
      totalAssignedLeads,
      remainingNewLeads,
      firstTimeCalls,
      followUpCalls,
      admitted,
      interested,
      notInterested,
      perUserStats
    });
  } catch (e) {
    console.error('Admission team stats error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * GET /api/reports/meta-lead-team-stats?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...
 * Same shape as admission-team-stats but for MetaLead (the Meta/Facebook lead CRM).
 * Returns: totalAssigned, hot/warm/cold counts, admitted, notInterested,
 * conversionRate, perUserStats (when no specific userId given).
 */
router.get('/meta-lead-team-stats', requireAuth, authorize(['SuperAdmin', 'Admin', 'DigitalMarketing', 'ITAdmin', 'Admission']), async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    const { start, end } = parseRange(from, to);

    const MetaLead = (await import('../models/MetaLead.js')).default;
    const User     = (await import('../models/User.js')).default;
    const mongoose  = (await import('mongoose')).default;

    let targetUserId = null;
    if (req.user.role === 'Admission') {
      targetUserId = req.user.id;
    } else {
      targetUserId = userId || null;
    }

    const matchQuery = {
      isDeleted: false,
      assignedAt: { $gte: start, $lt: end }
    };

    if (targetUserId) {
      matchQuery.assignedTo = mongoose.Types.ObjectId.createFromHexString(targetUserId);
    } else {
      const admissionUsers = await User.find({ role: 'Admission' }).select('_id');
      matchQuery.assignedTo = { $in: admissionUsers.map(u => u._id) };
    }

    const leads = await MetaLead.find(matchQuery)
      .select('status leadTemperature assignedTo aiScore');

    const totalAssigned   = leads.length;
    const hot              = leads.filter(l => l.leadTemperature === 'Hot').length;
    const warm             = leads.filter(l => l.leadTemperature === 'Warm').length;
    const cold              = leads.filter(l => l.leadTemperature === 'Cold').length;
    const inFollowUp        = leads.filter(l => l.status === 'In Follow Up').length;
    const counseling        = leads.filter(l => l.status === 'Counseling').length;
    const admitted          = leads.filter(l => l.status === 'Admitted').length;
    const notInterested     = leads.filter(l => ['Not Interested', 'Not Admitted'].includes(l.status)).length;
    const conversionRate    = totalAssigned > 0 ? Math.round((admitted / totalAssigned) * 1000) / 10 : 0;

    let perUserStats = null;
    if (!targetUserId) {
      const userMap = new Map();
      leads.forEach(lead => {
        const key = String(lead.assignedTo);
        if (!userMap.has(key)) {
          userMap.set(key, { totalAssigned: 0, hot: 0, warm: 0, cold: 0, admitted: 0, notInterested: 0 });
        }
        const s = userMap.get(key);
        s.totalAssigned++;
        if (lead.leadTemperature === 'Hot') s.hot++;
        if (lead.leadTemperature === 'Warm') s.warm++;
        if (lead.leadTemperature === 'Cold') s.cold++;
        if (lead.status === 'Admitted') s.admitted++;
        if (['Not Interested', 'Not Admitted'].includes(lead.status)) s.notInterested++;
      });

      const userIds = Array.from(userMap.keys());
      const users = await User.find({ _id: { $in: userIds } }).select('name');
      const usersById = {};
      users.forEach(u => { usersById[String(u._id)] = u.name; });

      perUserStats = Array.from(userMap.entries()).map(([key, stats]) => ({
        userId: key,
        userName: usersById[key] || 'Unknown',
        conversionRate: stats.totalAssigned > 0 ? Math.round((stats.admitted / stats.totalAssigned) * 1000) / 10 : 0,
        ...stats
      })).sort((a, b) => b.totalAssigned - a.totalAssigned);
    }

    return res.json({
      range: { from: from || null, to: to || null },
      totalAssigned, hot, warm, cold, inFollowUp, counseling,
      admitted, notInterested, conversionRate,
      perUserStats
    });
  } catch (e) {
    console.error('Meta lead team stats error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
