import mongoose from 'mongoose';

const AdmissionTargetSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    month: { type: String, required: true }, // Format: "YYYY-MM" (e.g., "2025-11")
    target: { type: Number, required: true, default: 0 },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Unique index to prevent duplicate targets for same course + month
AdmissionTargetSchema.index({ course: 1, month: 1 }, { unique: true });

export default mongoose.model('AdmissionTarget', AdmissionTargetSchema);
