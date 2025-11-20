import mongoose from 'mongoose';

const DueCollectionSchema = new mongoose.Schema(
  {
    admissionFee: { type: mongoose.Schema.Types.ObjectId, ref: 'AdmissionFee', required: true, index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    coordinator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    
    // Payment details
    amount: { type: Number, required: true },
    paymentMethod: { 
      type: String, 
      enum: ['Cash', 'Bank Transfer', 'Mobile Banking (bKash)', 'Mobile Banking (Nagad)', 'Mobile Banking (Rocket)', 'Check', 'Other'],
      default: 'Cash'
    },
    paymentDate: { type: Date, required: true },
    nextPaymentDate: { type: Date },
    note: { type: String },
    
    // Approval workflow
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
      index: true
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String },
    
    // Tracking
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Indexes for efficient querying
DueCollectionSchema.index({ status: 1, submittedAt: -1 });
DueCollectionSchema.index({ coordinator: 1, status: 1 });
DueCollectionSchema.index({ admissionFee: 1, createdAt: -1 });

export default mongoose.model('DueCollection', DueCollectionSchema);
