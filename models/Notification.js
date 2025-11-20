import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: [
        'LEAVE_SUBMITTED',
        'LEAVE_APPROVED',
        'LEAVE_REJECTED',
        'LEAVE_HANDOVER_REQUEST',
        'LEAVE_HANDOVER_ACCEPTED',
        'LEAVE_HANDOVER_DENIED',
        'TADA_SUBMITTED',
        'TADA_APPROVED',
        'TADA_REJECTED',
        'TADA_PAID',
        'TASK_ASSIGNED',
        'TASK_COMPLETED',
        'MESSAGE_RECEIVED'
      ],
      required: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    link: {
      type: String
    },
    relatedModel: {
      type: String,
      enum: ['LeaveApplication', 'TADAApplication', 'Task', 'Message', null]
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date
    }
  },
  { timestamps: true }
);

// Compound indexes for efficient queries
NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });

export default mongoose.model('Notification', NotificationSchema);
