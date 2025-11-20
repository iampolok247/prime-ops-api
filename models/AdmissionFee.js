// api/models/AdmissionFee.js
import mongoose from 'mongoose';

const AdmissionFeeSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', index: true },
    courseName: { type: String, required: true },
    totalAmount: { type: Number, default: 0 },
    amount: { type: Number, required: true }, // Amount paid now
    dueAmount: { type: Number, default: 0 },
    method: {
      type: String,
      enum: ['Bkash', 'Nagad', 'Rocket', 'Bank Transfer', 'Cash on Hand'],
      required: true
    },
    paymentDate: { type: Date, required: true },
    nextPaymentDate: { type: Date },
    note: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('AdmissionFee', AdmissionFeeSchema);
