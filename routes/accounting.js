// api/routes/accounting.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import AdmissionFee from '../models/AdmissionFee.js';
import Income from '../models/Income.js';
import Expense from '../models/Expense.js';
import DueCollection from '../models/DueCollection.js';
import RecruitmentIncome from '../models/RecruitmentIncome.js';
import { logActivity } from './activities.js';

const router = express.Router();
const onlyAcc = [ 'Accountant' ];
const accOrAdmin = [ 'Accountant', 'Admin', 'SuperAdmin', 'ITAdmin' ];

// ---------- Fees Approval ----------

// List fees: Accountant sees all; Admin/SA can view-only
router.get('/fees', requireAuth, authorize(accOrAdmin), async (req, res) => {
  const { status } = req.query;
  const q = {};
  if (status) q.status = status;
  const rows = await AdmissionFee
    .find(q)
    .sort({ createdAt: -1 })
    .populate('lead', 'leadId name phone email status')
    .populate('submittedBy', 'name email');
  res.json({ fees: rows });
});

// Approve a fee -> create Income if not already created
router.patch('/fees/:id/approve', requireAuth, authorize(onlyAcc), async (req, res) => {
  const fee = await AdmissionFee.findById(req.params.id);
  if (!fee) return res.status(404).json({ code:'NOT_FOUND', message:'Fee not found' });

  fee.status = 'Approved';
  await fee.save();

  // if there's no income linked to this fee, create one
  const exists = await Income.findOne({ refType: 'AdmissionFee', refId: fee._id });
  if (!exists) {
    await Income.create({
      date: fee.paymentDate,
      source: 'Admission Fee',
      amount: fee.amount,
      refType: 'AdmissionFee',
      refId: fee._id,
      addedBy: req.user.id,
      note: `${fee.lead?.leadId || ''} ${fee.courseName || ''}`.trim()
    });
  }

  const populated = await AdmissionFee
    .findById(fee._id)
    .populate('lead', 'leadId name phone email status')
    .populate('submittedBy', 'name email');

  res.json({ fee: populated });
});

// Reject a fee (no income created)
router.patch('/fees/:id/reject', requireAuth, authorize(onlyAcc), async (req, res) => {
  const fee = await AdmissionFee.findById(req.params.id);
  if (!fee) return res.status(404).json({ code:'NOT_FOUND', message:'Fee not found' });
  fee.status = 'Rejected';
  await fee.save();

  const populated = await AdmissionFee
    .findById(fee._id)
    .populate('lead', 'leadId name phone email status')
    .populate('submittedBy', 'name email');

  res.json({ fee: populated });
});

// Cancel an approved fee (change to Rejected with cancellation note)
router.patch('/fees/:id/cancel', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'Cancellation reason is required' });
  }

  const fee = await AdmissionFee.findById(req.params.id);
  if (!fee) return res.status(404).json({ code:'NOT_FOUND', message:'Fee not found' });
  
  if (fee.status !== 'Approved') {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'Can only cancel approved fees' });
  }

  const previousNote = fee.note || '';
  const cancelNote = `\n\n[CANCELLED by ${req.user.name} on ${new Date().toLocaleString()}]\nReason: ${reason.trim()}`;
  
  fee.status = 'Rejected';
  fee.note = previousNote + cancelNote;
  await fee.save();

  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'CANCEL',
    'Admission Fee',
    fee.lead?.name || fee.lead?.toString() || 'Unknown',
    `Cancelled approved fee (${fee.totalAmount} BDT). Reason: ${reason}`
  );

  const populated = await AdmissionFee
    .findById(fee._id)
    .populate('lead', 'leadId name phone email status')
    .populate('submittedBy', 'name email');

  res.json({ fee: populated });
});

// ---------- Due Collections Approval ----------

// List all due collections (pending/approved/rejected)
router.get('/due-collections', requireAuth, authorize(accOrAdmin), async (req, res) => {
  const { status } = req.query;
  const q = {};
  if (status) q.status = status;
  
  const collections = await DueCollection
    .find(q)
    .sort({ submittedAt: -1 })
    .populate('lead', 'leadId name phone email')
    .populate('coordinator', 'name email')
    .populate('reviewedBy', 'name email');
  
  res.json({ dueCollections: collections });
});

// Approve a due collection -> update AdmissionFee and create Income
router.patch('/due-collections/:id/approve', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { reviewNote } = req.body || {};
  
  const collection = await DueCollection.findById(req.params.id)
    .populate('lead', 'leadId name phone email');
  
  if (!collection) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Due collection not found' });
  }
  
  if (collection.status !== 'Pending') {
    return res.status(400).json({ code: 'INVALID_STATUS', message: 'Can only approve pending collections' });
  }

  // Update the admission fee
  const admissionFee = await AdmissionFee.findById(collection.admissionFee);
  if (!admissionFee) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Admission fee not found' });
  }

  admissionFee.amount = (admissionFee.amount || 0) + collection.amount;
  admissionFee.dueAmount = (admissionFee.dueAmount || 0) - collection.amount;
  
  if (collection.nextPaymentDate) {
    admissionFee.nextPaymentDate = collection.nextPaymentDate;
  }
  
  const collectionNote = `Due collected: ৳${collection.amount} on ${new Date(collection.paymentDate).toLocaleDateString('en-GB')}${collection.note ? ` - ${collection.note}` : ''}`;
  admissionFee.note = admissionFee.note ? `${admissionFee.note}\n${collectionNote}` : collectionNote;
  
  await admissionFee.save();

  // Create Income record
  await Income.create({
    date: collection.paymentDate,
    source: 'Due Collection',
    amount: collection.amount,
    refType: 'DueCollection',
    refId: collection._id,
    addedBy: req.user.id,
    note: `${collection.lead?.leadId || ''} - Due payment collected by coordinator`
  });

  // Update collection status
  collection.status = 'Approved';
  collection.reviewedBy = req.user.id;
  collection.reviewedAt = new Date();
  collection.reviewNote = reviewNote || '';
  await collection.save();

  const populated = await DueCollection.findById(collection._id)
    .populate('lead', 'leadId name phone email')
    .populate('coordinator', 'name email')
    .populate('reviewedBy', 'name email');

  res.json({ dueCollection: populated, message: 'Due collection approved' });
});

// Reject a due collection
router.patch('/due-collections/:id/reject', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { reviewNote } = req.body || {};
  
  const collection = await DueCollection.findById(req.params.id);
  if (!collection) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Due collection not found' });
  }
  
  if (collection.status !== 'Pending') {
    return res.status(400).json({ code: 'INVALID_STATUS', message: 'Can only reject pending collections' });
  }

  collection.status = 'Rejected';
  collection.reviewedBy = req.user.id;
  collection.reviewedAt = new Date();
  collection.reviewNote = reviewNote || '';
  await collection.save();

  const populated = await DueCollection.findById(collection._id)
    .populate('lead', 'leadId name phone email')
    .populate('coordinator', 'name email')
    .populate('reviewedBy', 'name email');

  res.json({ dueCollection: populated, message: 'Due collection rejected' });
});

// ---------- Income ----------

router.get('/income', requireAuth, authorize(accOrAdmin), async (req, res) => {
  const list = await Income.find().sort({ date: -1 });
  res.json({ income: list });
});

router.post('/income', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { date, source, amount, note } = req.body || {};
  if (!date || !source || amount === undefined) {
    return res.status(400).json({ code:'VALIDATION_ERROR', message:'date, source, amount required' });
  }
  const row = await Income.create({
    date: new Date(date),
    source,
    amount: Number(amount),
    refType: 'Manual',
    refId: null,
    addedBy: req.user.id,
    note: note || ''
  });
  
  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'CREATE',
    'Income',
    source,
    `Added income: ৳${amount} from ${source}`
  );
  
  res.status(201).json({ income: row });
});

router.put('/income/:id', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { date, source, amount, note } = req.body || {};
  if (!date || !source || amount === undefined) {
    return res.status(400).json({ code:'VALIDATION_ERROR', message:'date, source, amount required' });
  }
  const row = await Income.findById(req.params.id);
  if (!row) return res.status(404).json({ code:'NOT_FOUND', message:'Income not found' });
  
  row.date = new Date(date);
  row.source = source;
  row.amount = Number(amount);
  row.note = note || '';
  await row.save();
  res.json({ income: row });
});

router.delete('/income/:id', requireAuth, authorize(onlyAcc), async (req, res) => {
  const row = await Income.findById(req.params.id);
  if (!row) return res.status(404).json({ code:'NOT_FOUND', message:'Income not found' });
  
  // Log activity before deletion
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'DELETE',
    'Income',
    `Income - ${row.source}`,
    `Deleted income record: ${row.source} - Amount: ${row.amount} BDT`
  );
  
  await row.deleteOne();
  res.json({ ok: true });
});

// ---------- Expense ----------

router.get('/expense', requireAuth, authorize(accOrAdmin), async (req, res) => {
  const list = await Expense.find().sort({ date: -1 });
  res.json({ expenses: list });
});

router.post('/expense', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { date, purpose, amount, note } = req.body || {};
  if (!date || !purpose || amount === undefined) {
    return res.status(400).json({ code:'VALIDATION_ERROR', message:'date, purpose, amount required' });
  }
  const row = await Expense.create({
    date: new Date(date),
    purpose,
    amount: Number(amount),
    addedBy: req.user.id,
    note: note || ''
  });
  
  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'CREATE',
    'Expense',
    purpose,
    `Added expense: ৳${amount} for ${purpose}`
  );
  
  res.status(201).json({ expense: row });
});

router.put('/expense/:id', requireAuth, authorize(onlyAcc), async (req, res) => {
  const { date, purpose, amount, note } = req.body || {};
  if (!date || !purpose || amount === undefined) {
    return res.status(400).json({ code:'VALIDATION_ERROR', message:'date, purpose, amount required' });
  }
  const row = await Expense.findById(req.params.id);
  if (!row) return res.status(404).json({ code:'NOT_FOUND', message:'Expense not found' });
  
  row.date = new Date(date);
  row.purpose = purpose;
  row.amount = Number(amount);
  row.note = note || '';
  await row.save();
  res.json({ expense: row });
});

router.delete('/expense/:id', requireAuth, authorize(onlyAcc), async (req, res) => {
  const row = await Expense.findById(req.params.id);
  if (!row) return res.status(404).json({ code:'NOT_FOUND', message:'Expense not found' });
  
  // Log activity before deletion
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'DELETE',
    'Expense',
    `Expense - ${row.purpose}`,
    `Deleted expense record: ${row.purpose} - Amount: ${row.amount} BDT`
  );
  
  await row.deleteOne();
  res.json({ ok: true });
});

// ---------- Summary (Dashboard) ----------

router.get('/summary', requireAuth, authorize(accOrAdmin), async (req, res) => {
  const { from, to } = req.query;
  const start = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
  const end = to ? new Date(to) : new Date();

  const [incomeRows, expenseRows, approvedFees, approvedCollections, recruitmentIncomeRows] = await Promise.all([
    Income.find({ date: { $gte: start, $lte: end } }),
    Expense.find({ date: { $gte: start, $lte: end } }),
    AdmissionFee.find({ status: 'Approved' }),
    DueCollection.find({ status: 'Approved' }),
    RecruitmentIncome.find({ 
      date: { $gte: start, $lte: end },
      status: 'Approved'
    })
  ]);

  const totalIncome = incomeRows.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0);

  // Break down income by source
  const admissionFeesIncome = incomeRows
    .filter(r => r.source === 'Admission Fee')
    .reduce((s, r) => s + r.amount, 0);
  
  // Get recruitment income from RecruitmentIncome collection
  const recruitmentIncome = recruitmentIncomeRows.reduce((s, r) => s + (r.amount || 0), 0);
  
  const dueCollectionIncome = incomeRows
    .filter(r => r.source === 'Due Collection')
    .reduce((s, r) => s + r.amount, 0);
  
  const otherIncome = totalIncome - admissionFeesIncome - dueCollectionIncome;

  // Calculate total income including recruitment
  const totalIncomeWithRecruitment = totalIncome + recruitmentIncome;

  // Calculate present dues (uncollected)
  const totalDues = approvedFees.reduce((s, f) => s + (f.dueAmount || 0), 0);
  const collectedDues = approvedCollections.reduce((s, c) => s + c.amount, 0);
  const presentDues = totalDues - collectedDues;

  // Simple time-series by date (yyyy-mm-dd)
  const bucket = (acc, d, amt) => {
    const key = new Date(d).toISOString().slice(0,10);
    acc[key] = (acc[key] || 0) + amt;
  };
  const incomeSeries = {};
  const expenseSeries = {};
  incomeRows.forEach(r => bucket(incomeSeries, r.date, r.amount));
  recruitmentIncomeRows.forEach(r => bucket(incomeSeries, r.date, r.amount)); // Add recruitment income to series
  expenseRows.forEach(r => bucket(expenseSeries, r.date, r.amount));

  res.json({
    totalIncome: totalIncomeWithRecruitment, // Use total including recruitment
    totalExpense,
    profit: totalIncomeWithRecruitment - totalExpense, // Calculate profit with recruitment included
    admissionFeesIncome,
    recruitmentIncome,
    dueCollectionIncome,
    otherIncome,
    presentDues,
    incomeSeries,
    expenseSeries
  });
});

export default router;
