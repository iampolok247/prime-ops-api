// api/models/AccountBalance.js
import mongoose from 'mongoose';

const AccountBalanceSchema = new mongoose.Schema(
  {
    // Singleton document - there should only be one
    _id: {
      type: String,
      default: 'singleton'
    },
    bankBalance: {
      type: Number,
      default: 0
    },
    pettyCash: {
      type: Number,
      default: 0
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

export default mongoose.model('AccountBalance', AccountBalanceSchema);
