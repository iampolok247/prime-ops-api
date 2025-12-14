// api/models/BankTransaction.js
import mongoose from 'mongoose';

const BankTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['deposit', 'withdraw'],
      required: true
    },
    date: {
      type: Date,
      required: true,
      default: Date.now
    },
    // For deposits
    depositFrom: {
      type: String,
      trim: true,
      required: function() { return this.type === 'deposit'; }
    },
    depositFromOther: {
      type: String,
      trim: true
    },
    // For withdrawals
    withdrawPurpose: {
      type: String,
      trim: true,
      required: function() { return this.type === 'withdraw'; }
    },
    withdrawPurposeOther: {
      type: String,
      trim: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    // Track balance after this transaction
    balanceAfter: {
      type: Number,
      required: true
    },
    // Track petty cash balance after this transaction if affected
    pettyCashAfter: {
      type: Number
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

// Index for efficient queries
BankTransactionSchema.index({ date: -1 });
BankTransactionSchema.index({ type: 1 });

export default mongoose.model('BankTransaction', BankTransactionSchema);
