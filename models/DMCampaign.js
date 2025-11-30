import mongoose from 'mongoose';

const DMCampaignSchema = new mongoose.Schema(
  {
    campaignName: { type: String, required: true, trim: true },
    platform: { 
      type: String, 
      enum: ['Meta Ads', 'LinkedIn Ads'], 
      required: true 
    },
    boostType: { 
      type: String, 
      enum: ['Leads', 'Engagements', 'ThruPlays'], 
      required: true 
    },
    cost: { type: Number, required: true }, // Cost in currency (₹)
    leads: { type: Number, default: 0 },
    postEngagements: { type: Number, default: 0 },
    thruPlays: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    
    // Derived metrics
    costPerLead: { type: Number }, // Auto-calculated
    costPerEngagement: { type: Number }, // Auto-calculated
    ctr: { type: Number }, // Click-through rate (if applicable)
    
    // Metadata
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    campaignDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

// Calculate derived metrics before saving
DMCampaignSchema.pre('save', function() {
  if (this.leads > 0) {
    this.costPerLead = (this.cost / this.leads).toFixed(2);
  }
  if (this.postEngagements > 0) {
    this.costPerEngagement = (this.cost / this.postEngagements).toFixed(2);
  }
});

export default mongoose.model('DMCampaign', DMCampaignSchema);
