// api/models/RecruitmentIncome.js
import mongoose from 'mongoose';

const RecruitmentIncomeSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  source: { type: String, required: true, trim: true }, // Commission, Training Fee, Placement Fee, etc.
  amount: { type: Number, required: true, min: 0 },
  description: { type: String, trim: true },
  
  // Approval workflow
  status: { 
    type: String, 
    enum: ['Pending', 'Approved', 'Rejected'], 
    default: 'Pending' 
  },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Recruitment person who submitted
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Accountant who approved/rejected
  approvedAt: { type: Date },
  rejectionReason: { type: String, trim: true }
}, { timestamps: true });

const RecruitmentIncome = mongoose.models.RecruitmentIncome
  || mongoose.model('RecruitmentIncome', RecruitmentIncomeSchema);

export default RecruitmentIncome;
