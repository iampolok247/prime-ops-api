import mongoose from 'mongoose';

const FollowUpSchema = new mongoose.Schema(
  {
    note:  { type: String, default: '' },
    at:    { type: Date, default: Date.now },
    by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { _id: false }
);

const CapiEventSchema = new mongoose.Schema(
  {
    event:   { type: String },
    at:      { type: Date, default: Date.now },
    success: { type: Boolean, default: false }
  },
  { _id: false }
);

const MetaLeadSchema = new mongoose.Schema(
  {
    // ── Col 1: Lead ID ───────────────────────────────────────────────────────
    leadId: { type: String, required: true, unique: true, index: true }, // ML-2026-00001

    // ── Col 2: Created Time → managed by { timestamps: true } → createdAt ───

    // ── Col 3: Ad Name ───────────────────────────────────────────────────────
    metaAdName: { type: String, default: '' },

    // ── Col 4: Campaign Name ─────────────────────────────────────────────────
    metaCampaignName: { type: String, default: '' },
    metaCampaignId:   { type: String, default: '' }, // keep ID for CAPI

    // ── Meta identifiers (internal, not shown as column) ────────────────────
    metaLeadId: { type: String, sparse: true, index: true },
    metaFormId: { type: String, default: '' },

    // ── Col 5: Full Name ─────────────────────────────────────────────────────
    name: { type: String, required: true, trim: true },

    // ── Col 6: Email ─────────────────────────────────────────────────────────
    email: { type: String, trim: true, lowercase: true, index: true },

    // ── Col 7: Phone ─────────────────────────────────────────────────────────
    phone: { type: String, trim: true, index: true },

    // ── Col 8: Raw Question Data ──────────────────────────────────────────────
    // Stores the raw form Q&A exactly as received from Make.com / Meta
    rawQuestionData: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Col 9: Lead Score — NEVER exposed to Admission (stripped server-side) ─
    // aiScore is the AI-computed score; manualScore is DM's manual override
    aiScore:     { type: Number, min: 0, max: 100 },
    aiReasoning:     { type: String, default: '' },
    aiScoredAt:      { type: Date },
    // Hot / Warm / Cold — set by AI based on form answers, never by DM manually
    leadTemperature: {
      type: String,
      enum: ['Hot', 'Warm', 'Cold', null],
      default: null,
      index: true
    },

    // ── Col 10: Lead Status ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['Pending', 'Assigned', 'Counseling', 'In Follow Up', 'Admitted', 'Not Admitted', 'Not Interested', 'Archived'],
      default: 'Pending',
      index: true
    },

    // ── Col 11: Reason ────────────────────────────────────────────────────────
    // General reason field: why not interested, why rejected, any context note
    reason: { type: String, default: '' },

    // ── Col 12: Counsellor Feedback ───────────────────────────────────────────
    counsellorFeedback: { type: String, default: '' },

    // ── Col 13: Sent to CAPI ─────────────────────────────────────────────────
    sentToCapi:  { type: Boolean, default: false },
    capiEvents:  [CapiEventSchema], // full audit trail

    // ── Col 14: Platform ─────────────────────────────────────────────────────
    platform: {
      type: String,
      enum: ['Facebook', 'Instagram', 'WhatsApp', 'Messenger', 'Other', ''],
      default: ''
    },

    // ── Col 15: Is Organic ────────────────────────────────────────────────────
    isOrganic: { type: Boolean, default: false },

    // ── Col 16: Lead Faced By ─────────────────────────────────────────────────
    // The team member who first engaged / faced this lead (if known)
    leadFacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Supporting data ───────────────────────────────────────────────────────
    interestedCourse: { type: String, default: '' },
    source: {
      type: String,
      enum: ['Meta Lead', 'LinkedIn Lead', 'Manually Generated Lead', 'Others'],
      default: 'Meta Lead'
    },

    // ── Validation gate (DM / Admin reviews before assignment) ───────────────
    validationStatus: {
      type: String,
      enum: ['pending', 'validated', 'rejected'],
      default: 'pending',
      index: true
    },
    validatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    validatedAt:     { type: Date },
    rejectionReason: { type: String, default: '' },

    // ── Assignment ────────────────────────────────────────────────────────────
    assignedTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAt:   { type: Date },
    autoAssigned: { type: Boolean, default: false },

    // ── Counsellor workflow ───────────────────────────────────────────────────
    notes:            { type: String, default: '' },
    nextFollowUpDate: { type: Date },
    followUps:        [FollowUpSchema],
    // Auto-flagged by cron when a follow-up lead is stale (60+ days, 6+ touches, no conversion)
    flaggedStale:      { type: Boolean, default: false },
    flaggedStaleAt:    { type: Date },

    // ── Outcome ───────────────────────────────────────────────────────────────
    admittedToCourse: { type: String, default: '' },
    admittedToBatch:  { type: String, default: '' },
    admittedAt:       { type: Date },
    counselingAt:     { type: Date },

    // ── Flexible extra fields from Meta ad forms ──────────────────────────────
    customFields: { type: Map, of: String, default: {} },

    // ── Soft delete ───────────────────────────────────────────────────────────
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true } // createdAt = Col 2 "Created Time"
);

// Dedup indexes
MetaLeadSchema.index({ phone: 1, interestedCourse: 1 });
MetaLeadSchema.index({ email: 1, interestedCourse: 1 });
// Query patterns
MetaLeadSchema.index({ validationStatus: 1, assignedTo: 1, isDeleted: 1 });
MetaLeadSchema.index({ createdAt: -1 });

export default mongoose.model('MetaLead', MetaLeadSchema);
