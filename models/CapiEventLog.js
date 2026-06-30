import mongoose from 'mongoose';

// Queue of Meta CAPI events. Status changes (Counseling/In Follow Up/Admitted)
// create a 'pending' entry here instead of auto-firing to Meta. DM reviews
// the queue and sends selected/all events in one click — never auto-fires,
// so reschedules and accidental status flips never inflate conversion counts.
const CapiEventLogSchema = new mongoose.Schema(
  {
    lead:          { type: mongoose.Schema.Types.ObjectId, ref: 'MetaLead', required: true, index: true },
    leadDisplayId: { type: String, required: true },        // ML-2026-00012
    leadName:      { type: String, default: '' },
    leadStatus:    { type: String, required: true },        // Counseling / In Follow Up / Admitted (lead's status at queue time)
    event:         { type: String, required: true },        // Lead / ViewContent / CompleteRegistration
    sendStatus:    { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    sentAt:        { type: Date },
    sentBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // which DM clicked send
    errorMessage:  { type: String, default: '' },
    eventsReceived:{ type: Number, default: 0 }
  },
  { timestamps: true } // createdAt = when it was queued
);

CapiEventLogSchema.index({ createdAt: -1 });
CapiEventLogSchema.index({ sendStatus: 1, createdAt: -1 });

export default mongoose.model('CapiEventLog', CapiEventLogSchema);
