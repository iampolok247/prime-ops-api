import mongoose from 'mongoose';

const DMExpenseSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    purpose: {
      type: String,
      enum: ['Meta Ads', 'LinkedIn Ads', 'Software Purchase', 'Subscription', 'Others'],
      required: true
    },
    amount: { type: Number, required: true, min: 0 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('DMExpense', DMExpenseSchema);
