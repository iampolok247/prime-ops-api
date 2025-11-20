import mongoose from 'mongoose';

const TargetSchema = new mongoose.Schema(
  {
    // Type of target: Admission Student, Admission Revenue, Recruitment Candidate, Recruitment Revenue
    targetType: {
      type: String,
      enum: ['AdmissionStudent', 'AdmissionRevenue', 'RecruitmentCandidate', 'RecruitmentRevenue'],
      required: true
    },
    
    // For Admission Student targets
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    
    // Month in YYYY-MM format
    month: { type: String, required: true },
    
    // Target value (count for students/candidates, amount for revenue)
    targetValue: { type: Number, required: true, default: 0 },
    
    // Optional: Assign target to specific team member (for individual performance tracking)
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    // Who set this target
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Description or notes
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

// Index for efficient queries
TargetSchema.index({ targetType: 1, month: 1 });
TargetSchema.index({ targetType: 1, month: 1, course: 1 });
TargetSchema.index({ targetType: 1, month: 1, assignedTo: 1 });

// Unique constraint: prevent duplicate targets
// For AdmissionStudent: unique per (targetType, course, month, assignedTo)
// For others: unique per (targetType, month, assignedTo)
TargetSchema.index(
  { targetType: 1, course: 1, month: 1, assignedTo: 1 },
  { 
    unique: true,
    partialFilterExpression: { course: { $exists: true } }
  }
);

TargetSchema.index(
  { targetType: 1, month: 1, assignedTo: 1 },
  { 
    unique: true,
    partialFilterExpression: { course: { $exists: false } }
  }
);

export default mongoose.model('Target', TargetSchema);
