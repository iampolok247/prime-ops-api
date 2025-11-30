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
  const start = from ? new Date(from) : new Date(today.getFullYear(), today.getMonth(), 1);
  const end = to ? new Date(to) : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  // ensure end is exclusive
  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
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
 * Returns counts: counselingCount, followUpCount. If format=csv and requester is Admin/SuperAdmin, returns CSV.
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
    } else if (req.user.role === 'Admin' || req.user.role === 'SuperAdmin') {
      // Admins can request for specific user or all (no userId)
      targetUserId = userId || null;
    } else {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
    }

    const Lead = (await import('../models/Lead.js')).default;

    // Counseling count: leads with counselingAt in range and assignedTo matches (if provided)
    const counselingMatch = { counselingAt: { $gte: start, $lt: end } };
    if (targetUserId) counselingMatch.assignedTo = targetUserId;

    const counselingAgg = await Lead.aggregate([
      { $match: counselingMatch },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
    ]);

    // Follow-up count: unwind followUps and count entries with at in range and lead assignedTo matches
    const followMatch = { 'followUps.at': { $gte: start, $lt: end } };
    if (targetUserId) followMatch.assignedTo = targetUserId;

    const followAgg = await Lead.aggregate([
      { $match: followMatch },
      { $unwind: '$followUps' },
      { $match: { 'followUps.at': { $gte: start, $lt: end } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } }
    ]);

    // Build result map per user id
    const map = new Map();
    counselingAgg.forEach(r => map.set(String(r._id || 'unassigned'), { counselingCount: r.count, followUpCount: 0 }));
    followAgg.forEach(r => {
      const key = String(r._id || 'unassigned');
      const existing = map.get(key) || { counselingCount: 0, followUpCount: 0 };
      existing.followUpCount = (existing.followUpCount || 0) + r.count;
      map.set(key, existing);
    });

    // If targetUserId specified, return single object
    if (targetUserId) {
      const key = String(targetUserId);
      const data = map.get(key) || { counselingCount: 0, followUpCount: 0 };
      if (format === 'csv' && (req.user.role === 'Admin' || req.user.role === 'SuperAdmin')) {
        // return CSV single row
        const rows = ['userId,counselingCount,followUpCount', `${key},${data.counselingCount},${data.followUpCount}`];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="admission-metrics-${key}.csv"`);
        return res.send(rows.join('\n'));
      }
      return res.json({ userId: key, ...data, range: { from: from || null, to: to || null } });
    }

    // For admin: return array of user metrics. Need to populate user names
    const userIds = Array.from(map.keys()).filter(k => k !== 'unassigned');
    const users = await (await import('../models/User.js')).default.find({ _id: { $in: userIds } }).select('name role');
    const usersById = {};
    users.forEach(u => { usersById[String(u._id)] = u; });

    const results = [];
    for (const [key, val] of map.entries()) {
      if (key === 'unassigned') continue;
      results.push({ userId: key, userName: usersById[key]?.name || null, ...val });
    }

    if (format === 'csv') {
      // generate CSV
      const header = ['userId,userName,counselingCount,followUpCount'];
      const rows = results.map(r => `${r.userId},"${(r.userName||'').replace(/"/g,'""')}",${r.counselingCount},${r.followUpCount}`);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="admission-metrics-${from||'all'}-${to||'all'}.csv"`);
      return res.send([header.join(','), ...rows].join('\n'));
    }

    return res.json({ range: { from: from || null, to: to || null }, metrics: results });
  } catch (e) {
    console.error('Admission metrics error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});
