import mongoose from 'mongoose';

const LeaveApplicationSchema = new mongoose.Schema(
  {
    employee: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true,
      index: true 
    },
    leaveType: {
      type: String,
      enum: ['Sick Leave', 'Casual Leave', 'Annual Leave', 'Emergency Leave', 'Unpaid Leave', 'Other'],
      required: true
    },
    startDate: { 
      type: Date, 
      required: true 
    },
    endDate: { 
      type: Date, 
      required: true 
    },
    totalDays: { 
      type: Number, 
      required: true 
    },
    reason: { 
      type: String, 
      required: true 
    },
    // Responsibility Handover
    handoverTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    handoverStatus: {
      type: String,
      enum: ['Pending', 'Accepted', 'Denied'],
      default: 'Pending'
    },
    handoverRespondedAt: {
      type: Date
    },
    handoverNote: {
      type: String
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
      index: true
    },
    reviewedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    reviewedAt: { 
      type: Date 
    },
    reviewNote: { 
      type: String 
    },
    detailsRequested: {
      type: String
    },
    detailsRequestedAt: {
      type: Date
    },
    detailsRequestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

// Index for efficient queries
LeaveApplicationSchema.index({ employee: 1, status: 1 });
LeaveApplicationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('LeaveApplication', LeaveApplicationSchema);
