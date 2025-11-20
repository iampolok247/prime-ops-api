import mongoose from 'mongoose';

const BatchSchema = new mongoose.Schema(
  {
    batchId: { 
      type: String, 
      required: true, 
      unique: true 
    },
    batchName: { 
      type: String, 
      required: true,
      trim: true 
    },
    category: { 
      type: String, 
      required: true,
      trim: true 
    },
    targetedStudent: { 
      type: Number, 
      required: true,
      min: 1 
    },
    admittedStudents: [{
      lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
      admittedAt: { type: Date, default: Date.now }
    }],
    status: {
      type: String,
      enum: ['Active', 'Completed', 'Inactive'],
      default: 'Active'
    },
    createdBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: true 
    }
  },
  { timestamps: true }
);

// Index for efficient queries
BatchSchema.index({ category: 1, status: 1 });
BatchSchema.index({ batchId: 1 });

export default mongoose.model('Batch', BatchSchema);
