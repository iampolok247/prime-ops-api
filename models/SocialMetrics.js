import mongoose from 'mongoose';

const SocialMetricsSchema = new mongoose.Schema(
  {
    // Keep latest document per month or overwrite; we'll upsert by _id=singleton
    metrics: {
      facebookFollowers: { type: Number, default: 0 },
      instagramFollowers: { type: Number, default: 0 },
      facebookGroupMembers: { type: Number, default: 0 },
      youtubeSubscribers: { type: Number, default: 0 },
      linkedInFollowers: { type: Number, default: 0 },
      xFollowers: { type: Number, default: 0 },
      pinterestView: { type: Number, default: 0 },
      bloggerImpression: { type: Number, default: 0 },
      totalReach: { type: Number, default: 0 }
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export default mongoose.model('SocialMetrics', SocialMetricsSchema);
