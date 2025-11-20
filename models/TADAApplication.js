import mongoose from 'mongoose';

const TADAApplicationSchema = new mongoose.Schema(
  {
    employee: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true,
      index: true 
    },
    applicationType: {
      type: String,
      enum: ['TA', 'DA', 'TA/DA'],
      required: true
    },
    purpose: { 
      type: String, 
      required: true 
    },
    travelDate: { 
      type: Date, 
      required: true 
    },
    destination: { 
      type: String, 
      required: true 
    },
    amount: { 
      type: Number, 
      required: true,
      min: 0 
    },
    description: { 
      type: String 
    },
    // Admin approval stage
    adminStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
      index: true
    },
    adminReviewedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    adminReviewedAt: { 
      type: Date 
    },
    adminReviewNote: { 
      type: String 
    },
    // Accountant payment stage (only if admin approved)
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Paid'],
      default: 'Pending',
      index: true
    },
    paidBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    paidAt: { 
      type: Date 
    },
    paymentNote: { 
      type: String 
    }
  },
  { timestamps: true }
);

// Index for efficient queries
TADAApplicationSchema.index({ employee: 1, adminStatus: 1 });
TADAApplicationSchema.index({ adminStatus: 1, paymentStatus: 1 });
TADAApplicationSchema.index({ adminStatus: 1, createdAt: -1 });

export default mongoose.model('TADAApplication', TADAApplicationSchema);
