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
    const RequisitionModel = mongoose.model('Requisition');
    const year = new Date().getFullYear();
    const prefix = `REQ-${year}-`;

    // Find latest requisition number for the current year and increment safely.
    // Using countDocuments can create duplicates after deletions.
    const latest = await RequisitionModel
      .findOne({ requisitionNo: { $regex: `^${prefix}` } })
      .sort({ createdAt: -1 })
      .select('requisitionNo')
      .lean();

    let nextSeq = 1;
    if (latest?.requisitionNo) {
      const parts = latest.requisitionNo.split('-');
      const last = Number(parts[parts.length - 1]);
      if (!Number.isNaN(last)) nextSeq = last + 1;
    }

    this.requisitionNo = `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('Requisition', requisitionSchema);
