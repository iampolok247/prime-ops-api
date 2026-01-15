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

export default router;

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
    } else if (req.user.role === 'Admin' || req.user.role === 'SuperAdmin' || req.user.role === 'HeadOfCreative') {
      // Admins/HeadOfCreative can request for specific user or all (no userId)
      targetUserId = userId || null;
    } else {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
    }

    const LeadActivity = (await import('../models/LeadActivity.js')).default;
    const mongoose = (await import('mongoose')).default;

    // Convert targetUserId to ObjectId if present
    const targetUserObjectId = targetUserId ? mongoose.Types.ObjectId.createFromHexString(targetUserId) : null;

    const baseMatch = { actionDate: { $gte: start, $lt: end } };
    if (targetUserObjectId) baseMatch.advisor = targetUserObjectId;

    console.log('[METRICS-V2] Date range:', { start: start.toISOString(), end: end.toISOString() });
    console.log('[METRICS-V2] targetUserId:', targetUserObjectId);

    // Query each activity type separately, grouped by advisor
    const counselingAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: 'counseling' } },
      { $group: { _id: '$advisor', count: { $sum: 1 } } }
    ]);

    const followUpAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: 'follow_up' } },
      { $group: { _id: '$advisor', count: { $sum: 1 } } }
    ]);

    const admittedAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: 'admitted' } },
      { $group: { _id: '$advisor', count: { $sum: 1 } } }
    ]);

    const notAdmittedAgg = await LeadActivity.aggregate([
      { $match: { ...baseMatch, activityType: { $in: ['not_admitted','not_interested'] } } },
      { $group: { _id: '$advisor', count: { $sum: 1 } } }
    ]);

    console.log('[METRICS-V2] Aggregation results:', { 
      counseling: counselingAgg.length, 
      followUp: followUpAgg.length, 
      admitted: admittedAgg.length, 
      notAdmitted: notAdmittedAgg.length 
    });

    // Build result map per user id
    const map = new Map();
    
    // Initialize all advisors from counseling agg
    counselingAgg.forEach(r => map.set(String(r._id || 'unassigned'), { 
      counselingCount: r.count, 
      followUpCount: 0, 
      admittedCount: 0, 
      notAdmittedCount: 0 
    }));
    
    // Add follow-up counts
    followUpAgg.forEach(r => {
      const key = String(r._id || 'unassigned');
      const existing = map.get(key) || { counselingCount: 0, followUpCount: 0, admittedCount: 0, notAdmittedCount: 0 };
      existing.followUpCount = r.count;
      map.set(key, existing);
    });
    
    // Add admitted counts
    admittedAgg.forEach(r => {
      const key = String(r._id || 'unassigned');
      const existing = map.get(key) || { counselingCount: 0, followUpCount: 0, admittedCount: 0, notAdmittedCount: 0 };
      existing.admittedCount = r.count;
      map.set(key, existing);
    });
    
    // Add not admitted counts
    notAdmittedAgg.forEach(r => {
      const key = String(r._id || 'unassigned');
      const existing = map.get(key) || { counselingCount: 0, followUpCount: 0, admittedCount: 0, notAdmittedCount: 0 };
      existing.notAdmittedCount = r.count;
      map.set(key, existing);
    });

    // If targetUserId specified, return single object
    if (targetUserId) {
      const key = String(targetUserId);
      const data = map.get(key) || { counselingCount: 0, followUpCount: 0, admittedCount: 0, notAdmittedCount: 0 };
      // Calculate total calls = new calls + follow-up calls
      data.totalCalls = (data.counselingCount || 0) + (data.followUpCount || 0);
      
      if (format === 'csv' && (req.user.role === 'Admin' || req.user.role === 'SuperAdmin')) {
        // return CSV single row
        const rows = [
          'userId,newCalls,followUpCalls,totalCalls,admitted,notAdmitted',
          `${key},${data.counselingCount},${data.followUpCount},${data.totalCalls},${data.admittedCount},${data.notAdmittedCount}`
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
        admittedCount: val.admittedCount,
        notAdmittedCount: val.notAdmittedCount
      });
    }

    if (format === 'csv') {
      // generate CSV
      const header = ['userId,userName,newCalls,followUpCalls,totalCalls,admitted,notAdmitted'];
      const rows = results.map(r => `${r.userId},"${(r.userName||'').replace(/"/g,'""')}",${r.counselingCount},${r.followUpCount},${r.totalCalls},${r.admittedCount},${r.notAdmittedCount}`);
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
