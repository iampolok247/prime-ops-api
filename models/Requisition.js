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

    // Start from count, then probe for the next available number.
    // This avoids collisions after deletions and handles legacy malformed values.
    const baseCount = await RequisitionModel.countDocuments({
      requisitionNo: { $regex: `^${prefix}` }
    });

    let seq = baseCount + 1;
    let candidate = `${prefix}${String(seq).padStart(4, '0')}`;

    // Probe forward until we find an unused requisition number.
    // (bounded loop to avoid infinite retries)
    for (let i = 0; i < 5000; i += 1) {
      const exists = await RequisitionModel.exists({ requisitionNo: candidate });
      if (!exists) break;
      seq += 1;
      candidate = `${prefix}${String(seq).padStart(4, '0')}`;
    }

    this.requisitionNo = candidate;
  }
  next();
});

export default mongoose.model('Requisition', requisitionSchema);
