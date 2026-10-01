import mongoose from 'mongoose';
import { leadRef, leadModelField } from '../utils/leadRef.js';

const LeadActivitySchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: leadRef, required: true, index: true },
    leadModel: leadModelField, // 'Lead' | 'MetaCrmLead' — missing on legacy docs → 'Lead'
    advisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    activityType: {
      type: String,
      enum: ['counseling', 'follow_up', 'not_interested', 'admitted'],
      required: true,
      index: true
    },
    actionDate: { type: Date, default: Date.now, index: true },
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

// Compound index for efficient queries: advisor + activityType + actionDate
LeadActivitySchema.index({ advisor: 1, activityType: 1, actionDate: -1 });

export default mongoose.model('LeadActivity', LeadActivitySchema);
