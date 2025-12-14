import mongoose from 'mongoose';

const ActivityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    userRole: { type: String, required: true },
    action: {
      type: String,
      required: true,
      enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT']
    },
    resourceType: { type: String, required: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId },
    resourceName: { type: String },
    description: { type: String },
    ipAddress: { type: String },
    endpoint: { type: String },
    method: { type: String },
  },
  { timestamps: true }
);

ActivityLogSchema.index({ user: 1, createdAt: -1 });
ActivityLogSchema.index({ action: 1, createdAt: -1 });
ActivityLogSchema.index({ resourceType: 1, createdAt: -1 });
ActivityLogSchema.index({ createdAt: -1 });

export default mongoose.model('ActivityLog', ActivityLogSchema);
