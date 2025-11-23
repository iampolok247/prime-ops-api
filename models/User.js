import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      required: true,
      enum: [
        'SuperAdmin',
        'Admin',
        'Accountant',
        'Admission',
        'Recruitment',
        'DigitalMarketing',
        'MotionGraphics',
        'Coordinator'
      ]
    },
    department: { type: String },
    designation: { type: String },
    phone: { type: String, default: '' }, // <-- NEW
    avatar: {
      type: String,
      default: 'https://ui-avatars.com/api/?name=Prime+Academy&background=253985&color=fff'
    },
    displayOrder: { type: Number, default: 0 }, // For custom employee ordering
    isActive: { type: Boolean, default: true },
    joinDate: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export default mongoose.model('User', UserSchema);
