import mongoose from 'mongoose';

const CourseSchema = new mongoose.Schema(
  {
    courseId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: '' },
    duration: { type: String, default: '' }, // e.g., "4 Months"
    regularFee: { type: Number, default: 0 },
    discountFee: { type: Number, default: 0 },
    teacher: { type: String, default: '' },
    details: { type: String, default: '' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
  },
  { timestamps: true }
);

export default mongoose.model('Course', CourseSchema);
