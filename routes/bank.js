// api/routes/bank.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import BankTransaction from '../models/BankTransaction.js';
import AccountBalance from '../models/AccountBalance.js';

const router = express.Router();

// Helper to check roles
const isAccountant = (u) => u?.role === 'Accountant';
const isAdmin = (u) => u?.role === 'Admin';
const isSA = (u) => u?.role === 'SuperAdmin';

// Get current balances
router.get('/balances', requireAuth, async (req, res) => {
  if (!(isAccountant(req.user) || isAdmin(req.user) || isSA(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  try {
    let balance = await AccountBalance.findById('singleton');
    
    // Initialize if doesn't exist
    if (!balance) {
      balance = await AccountBalance.create({
        _id: 'singleton',
        bankBalance: 0,
        pettyCash: 0
      });
    }

    return res.json({ 
      bankBalance: balance.bankBalance || 0,
      pettyCash: balance.pettyCash || 0,
      lastUpdated: balance.lastUpdated
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Get transaction history
router.get('/transactions', requireAuth, async (req, res) => {
  if (!(isAccountant(req.user) || isAdmin(req.user) || isSA(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  try {
    const { from, to, type } = req.query;
    const query = {};

    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query.date.$lte = toDate;
      }
    }

    if (type && ['deposit', 'withdraw'].includes(type)) {
      query.type = type;
    }

    const transactions = await BankTransaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .populate('recordedBy', 'name email')
      .limit(100);

    return res.json({ transactions });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Deposit into bank
router.post('/deposit', requireAuth, async (req, res) => {
  if (!(isAccountant(req.user) || isAdmin(req.user) || isSA(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  try {
    const { date, depositFrom, depositFromOther, amount, notes } = req.body;

    if (!date || !depositFrom || !amount || amount <= 0) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'Date, deposit source, and positive amount are required' 
      });
    }

    if (depositFrom === 'Others' && !depositFromOther) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'Please specify other deposit source' 
      });
    }

    // Get current balance
    let balance = await AccountBalance.findById('singleton');
    if (!balance) {
      balance = await AccountBalance.create({
        _id: 'singleton',
        bankBalance: 0,
        pettyCash: 0
      });
    }

    // If depositing from petty cash, check sufficient balance
    if (depositFrom === 'Petty Cash') {
      if (balance.pettyCash < amount) {
        return res.status(400).json({ 
          code: 'INSUFFICIENT_FUNDS', 
          message: `Insufficient petty cash. Available: ${balance.pettyCash}` 
        });
      }
      // Reduce from petty cash
      balance.pettyCash -= amount;
    }

    // Add to bank balance
    balance.bankBalance += amount;
    balance.lastUpdated = new Date();
    await balance.save();

    // Record transaction
    const transaction = await BankTransaction.create({
      type: 'deposit',
      date: new Date(date),
      depositFrom,
      depositFromOther: depositFrom === 'Others' ? depositFromOther : undefined,
      amount,
      notes: notes || '',
      balanceAfter: balance.bankBalance,
      pettyCashAfter: depositFrom === 'Petty Cash' ? balance.pettyCash : undefined,
      recordedBy: req.user.id
    });

    const populated = await BankTransaction.findById(transaction._id)
      .populate('recordedBy', 'name email');

    return res.status(201).json({ 
      transaction: populated,
      bankBalance: balance.bankBalance,
      pettyCash: balance.pettyCash
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Withdraw from bank
router.post('/withdraw', requireAuth, async (req, res) => {
  if (!(isAccountant(req.user) || isAdmin(req.user) || isSA(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Not allowed' });
  }

  try {
    const { date, withdrawPurpose, withdrawPurposeOther, amount, notes } = req.body;

    if (!date || !withdrawPurpose || !amount || amount <= 0) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'Date, withdrawal purpose, and positive amount are required' 
      });
    }

    if (withdrawPurpose === 'Others' && !withdrawPurposeOther) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'Please specify other withdrawal purpose' 
      });
    }

    // Get current balance
    let balance = await AccountBalance.findById('singleton');
    if (!balance) {
      balance = await AccountBalance.create({
        _id: 'singleton',
        bankBalance: 0,
        pettyCash: 0
      });
    }

    // Check sufficient bank balance (allow negative for overdraft scenarios)
    // But warn if it goes negative
    const newBankBalance = balance.bankBalance - amount;

    // Reduce from bank balance
    balance.bankBalance = newBankBalance;

    // If withdrawing to petty cash, add to petty cash
    if (withdrawPurpose === 'Petty Cash') {
      balance.pettyCash += amount;
    }

    balance.lastUpdated = new Date();
    await balance.save();

    // Record transaction
    const transaction = await BankTransaction.create({
      type: 'withdraw',
      date: new Date(date),
      withdrawPurpose,
      withdrawPurposeOther: withdrawPurpose === 'Others' ? withdrawPurposeOther : undefined,
      amount,
      notes: notes || '',
      balanceAfter: balance.bankBalance,
      pettyCashAfter: withdrawPurpose === 'Petty Cash' ? balance.pettyCash : undefined,
      recordedBy: req.user.id
    });

    const populated = await BankTransaction.findById(transaction._id)
      .populate('recordedBy', 'name email');

    return res.status(201).json({ 
      transaction: populated,
      bankBalance: balance.bankBalance,
      pettyCash: balance.pettyCash
    });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Delete transaction (Admin/SuperAdmin only)
router.delete('/transactions/:id', requireAuth, async (req, res) => {
  if (!(isAdmin(req.user) || isSA(req.user))) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Admin/SuperAdmin only' });
  }

  try {
    const transaction = await BankTransaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Transaction not found' });
    }

    // Note: Deleting a transaction doesn't automatically reverse the balance
    // This is intentional to maintain audit trail - admins should create compensating transactions
    await BankTransaction.deleteOne({ _id: req.params.id });

    return res.json({ ok: true, message: 'Transaction deleted' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
