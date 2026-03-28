// models/ManualDue.js
import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  method: { type: String, enum: ['Cash', 'Bank Transfer', 'bKash', 'Nagad', 'Rocket', 'Card', 'Other'], default: 'Cash' },
  collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  collectedAt: { type: Date, default: Date.now },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  rejectionNote: { type: String },
  note: { type: String }
});

const manualDueSchema = new mongoose.Schema({
  // Student info - manual entry since these are old records
  studentName: { type: String, required: true },
  studentPhone: { type: String, required: true },
  studentEmail: { type: String },
  leadId: { type: String }, // Optional lead reference like "LEAD-2025-VID-00045"
  
  // Course info
  courseName: { type: String, required: true },
  batchName: { type: String },
  
  // Due info
  totalAmount: { type: Number, required: true },
  paidAmount: { type: Number, default: 0 },
  description: { type: String }, // Why this due exists
  dueDate: { type: Date },
  
  // Payment history
  payments: [paymentSchema],
  
  // Status
  status: { type: String, enum: ['Pending', 'Partial', 'Paid'], default: 'Pending' },
  
  // Tracking
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Virtual for remaining due
manualDueSchema.virtual('dueAmount').get(function() {
  return this.totalAmount - this.paidAmount;
});

// Update status based on payments
manualDueSchema.pre('save', function(next) {
  // Only count approved payments
  const approvedPayments = this.payments.filter(p => p.status === 'Approved');
  this.paidAmount = approvedPayments.reduce((sum, p) => sum + p.amount, 0);
  
  if (this.paidAmount >= this.totalAmount) {
    this.status = 'Paid';
  } else if (this.paidAmount > 0) {
    this.status = 'Partial';
  } else {
    this.status = 'Pending';
  }
  next();
});

manualDueSchema.set('toJSON', { virtuals: true });
manualDueSchema.set('toObject', { virtuals: true });

export default mongoose.model('ManualDue', manualDueSchema);
