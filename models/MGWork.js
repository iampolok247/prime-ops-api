// api/models/MGWork.js
import mongoose from 'mongoose';

const MGWorkSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },                      // production date
    title: { type: String, required: true },                   // e.g., "Reel for Course X"
    type: {
      type: String,
      enum: ['Reel', 'Short', 'Explainer', 'Ad', 'Banner', 'Other'],
      default: 'Other'
    },
    platform: {
      type: String,
      enum: ['Facebook', 'Instagram', 'YouTube', 'TikTok', 'X', 'Other'],
      default: 'Other'
    },
    durationSec: { type: Number, default: 0 },                 // video length in seconds
    assignedTo: { type: String, default: '' },                 // optional assignee name
    status: {
      type: String,
      enum: ['Queued', 'InProgress', 'Review', 'Done', 'Hold'],
      default: 'Queued'
    },
    assetLink: { type: String, default: '' },                  // Drive/YouTube link
    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export default mongoose.model('MGWork', MGWorkSchema);
