// api/models/Expense.js
import mongoose from 'mongoose';

const ExpenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    purpose: { type: String, required: true },
    amount: { type: Number, required: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

export default mongoose.model('Expense', ExpenseSchema);
