import mongoose from 'mongoose';

// Meta CRM lead — a Meta (Facebook/Instagram) ad lead that runs through its own
// pipeline, mirroring the Admission Pipeline (same statuses, follow-ups, fees,
// batches). Kept in its own collection; admission fees / batches / dues /
// LeadActivity reference it via their `leadModel: 'MetaCrmLead'` field.
//
// The legacy `MetaLead` collection is left untouched in the DB and is no
// longer used by the app.
const MetaCrmLeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, required: true, unique: true, index: true }, // META-2026-00001
    entryDate: { type: Date, default: Date.now },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    interestedCourse: { type: String, default: '' },
    source: {
      type: String,
      enum: ['Meta Lead', 'LinkedIn Lead', 'Manually Generated Lead', 'Others'],
      default: 'Meta Lead'
    },

    // Same pipeline statuses as Lead. A lead with no assignedTo is "Unassigned".
    status: {
      type: String,
      enum: ['Assigned', 'Counseling', 'In Follow Up', 'Admitted', 'Not Admitted', 'Not Interested', 'Archived'],
      default: 'Assigned',
      index: true
    },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // Admission member
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },              // DM user
    admittedToCourse: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    admittedToBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    notes: { type: String, default: '' },
    nextFollowUpDate: { type: Date },
    priority: {
      type: String,
      enum: ['Very Interested', 'Interested', 'Few Interested', 'Not Interested'],
      default: 'Interested'
    },
    specialFilter: { type: String, default: '', trim: true },
    // stage timestamps
    assignedAt: { type: Date },
    counselingAt: { type: Date },
    admittedAt: { type: Date },
    followUps: [
      {
        note: { type: String, default: '' },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      }
    ],
    adminComments: [
      {
        text: { type: String, required: true, trim: true },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      }
    ],
    customFields: { type: Map, of: String, default: {} },

    // ── Meta identifiers ─────────────────────────────────────────────────────
    metaLeadId: { type: String, sparse: true, index: true }, // Meta leadgen ID — required for CRM CAPI matching
    metaFormId: { type: String, default: '' },
    metaAdName: { type: String, default: '' },
    metaCampaignName: { type: String, default: '' },
    metaCampaignId: { type: String, default: '' },
    platform: {
      type: String,
      enum: ['Facebook', 'Instagram', 'WhatsApp', 'Messenger', 'Other', ''],
      default: ''
    },
    isOrganic: { type: Boolean, default: false },
    rawQuestionData: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── AI score — DM/Admin only, stripped from responses for Admission ─────
    aiScore: { type: Number, min: 0, max: 100 },
    aiReasoning: { type: String, default: '' },
    aiScoredAt: { type: Date },
    leadTemperature: { type: String, enum: ['Hot', 'Warm', 'Cold', null], default: null, index: true },

    // ── Validation gate: DM validates before a lead can be assigned ─────────
    validationStatus: {
      type: String,
      enum: ['pending', 'validated', 'rejected'],
      default: 'pending',
      index: true
    },
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    validatedAt: { type: Date },
    rejectionReason: { type: String, default: '' },

    // ── Structured lead-quality feedback (see utils/leadQuality.js) ──────────
    // Bad  = junk lead (sent to Meta as "Disqualified")
    // Lost = genuine lead that did not convert (sent as "Not Interested")
    leadQuality: { type: String, enum: ['Bad', 'Lost', null], default: null, index: true },
    qualityReason: { type: String, default: '' },
    qualityNote: { type: String, default: '' },
    qualityMarkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    qualityMarkedAt: { type: Date },

    // ── Meta CAPI audit trail ────────────────────────────────────────────────
    sentToCapi: { type: Boolean, default: false },
    capiEvents: [
      {
        event: { type: String },
        at: { type: Date, default: Date.now },
        success: { type: Boolean, default: false },
        _id: false
      }
    ],

    // ── Soft delete ──────────────────────────────────────────────────────────
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

MetaCrmLeadSchema.index({ phone: 1, interestedCourse: 1 });
MetaCrmLeadSchema.index({ email: 1, interestedCourse: 1 });
MetaCrmLeadSchema.index({ validationStatus: 1, assignedTo: 1, isDeleted: 1 });
MetaCrmLeadSchema.index({ createdAt: -1 });

export default mongoose.models.MetaCrmLead || mongoose.model('MetaCrmLead', MetaCrmLeadSchema);
