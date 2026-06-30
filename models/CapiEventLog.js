import mongoose from 'mongoose';

// Dedicated, queryable log of every Meta CAPI send attempt — separate from
// the lightweight capiEvents[] embedded on MetaLead so it can be filtered,
// paginated, and audited without loading full lead documents.
const CapiEventLogSchema = new mongoose.Schema(
  {
    lead:         { type: mongoose.Schema.Types.ObjectId, ref: 'MetaLead', required: true, index: true },
    leadDisplayId:{ type: String, required: true },        // ML-2026-00012
    leadName:     { type: String, default: '' },
    status:       { type: String, required: true },        // Counseling / In Follow Up / Admitted
    event:        { type: String, required: true },        // Lead / ViewContent / CompleteRegistration
    success:      { type: Boolean, required: true, index: true },
    errorMessage: { type: String, default: '' },
    eventsReceived: { type: Number, default: 0 }
  },
  { timestamps: true } // createdAt = when this attempt happened
);

CapiEventLogSchema.index({ createdAt: -1 });
CapiEventLogSchema.index({ success: 1, createdAt: -1 });

export default mongoose.model('CapiEventLog', CapiEventLogSchema);
