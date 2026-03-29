import mongoose from 'mongoose';

const requisitionItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  estimatedCost: { type: Number, required: true, min: 0 },
  remarks: { type: String, default: '' }
});

const requisitionSchema = new mongoose.Schema({
  requisitionNo: {
    type: String,
    unique: true
  },
  subject: {
    type: String,
    default: '',
    trim: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  department: {
    type: String,
    required: true
  },
  items: [requisitionItemSchema],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  amountInWords: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Pending', 'Verified', 'Approved', 'Rejected', 'Paid'],
    default: 'Pending'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectionReason: String,
  // Payment fields (for Accountant)
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  paidAt: Date,
  paidAmount: {
    type: Number,
    default: 0
  },
  paymentNote: String,
  declaration: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Auto-generate requisition number before save
requisitionSchema.pre('save', async function(next) {
  if (!this.requisitionNo) {
    const count = await mongoose.model('Requisition').countDocuments();
    const year = new Date().getFullYear();
    this.requisitionNo = `REQ-${year}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('Requisition', requisitionSchema);
