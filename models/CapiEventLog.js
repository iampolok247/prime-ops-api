import mongoose from 'mongoose';

// Queue of Meta CAPI (CRM) events. Stage changes on Meta CRM leads create a
// 'pending' entry here instead of auto-firing to Meta. DM reviews the queue and
// sends selected/all events in one click — never auto-fires, so accidental
// status flips never inflate conversion counts.
//
// Entries without `pipeline: 'crm'` belong to the retired MetaLead module; they
// are kept in the DB but hidden from the UI.
const CapiEventLogSchema = new mongoose.Schema(
  {
    pipeline:      { type: String, default: '', index: true }, // 'crm' = Meta CRM pipeline (MetaCrmLead)
    lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'MetaCrmLead', required: true, index: true },
    leadDisplayId: { type: String, required: true },        // META-2026-00012
    leadName:      { type: String, default: '' },
    leadStatus:    { type: String, required: true },        // pipeline status that triggered it (or 'Lead')
    event:         { type: String, required: true },        // CRM stage: Lead / Counseling / Admitted
    eventTime:     { type: Date },                          // when the lead entered the stage (sent as event_time)
    queuedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sendStatus:    { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    sentAt:        { type: Date },
    sentBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // which DM clicked send
    errorMessage:  { type: String, default: '' },
    attempts:      { type: Number, default: 0 },             // send attempts (failed sends stay pending and retry)
    lastAttemptAt: { type: Date },
    eventsReceived:{ type: Number, default: 0 }
  },
  { timestamps: true } // createdAt = when it was queued
);

CapiEventLogSchema.index({ createdAt: -1 });
CapiEventLogSchema.index({ sendStatus: 1, createdAt: -1 });

export default mongoose.model('CapiEventLog', CapiEventLogSchema);
