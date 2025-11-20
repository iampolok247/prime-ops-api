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
