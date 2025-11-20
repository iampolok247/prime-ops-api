// api/models/RecruitmentExpense.js
import mongoose from 'mongoose';

const RecruitmentExpenseSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  purpose: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 }
}, { timestamps: true });

const RecruitmentExpense = mongoose.models.RecruitmentExpense
  || mongoose.model('RecruitmentExpense', RecruitmentExpenseSchema);

export default RecruitmentExpense;
