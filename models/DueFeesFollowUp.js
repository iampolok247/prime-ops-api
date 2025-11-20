import mongoose from 'mongoose';

const DueFeesFollowUpSchema = new mongoose.Schema(
  {
    admissionFee: { type: mongoose.Schema.Types.ObjectId, ref: 'AdmissionFee', required: true, index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    coordinator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    followUpType: {
      type: String,
      enum: ['Call', 'SMS', 'Email', 'Visit', 'WhatsApp', 'Other'],
      required: true
    },
    note: { type: String, required: true },
    previousNextPaymentDate: { type: Date },
    updatedNextPaymentDate: { type: Date },
    amountPromised: { type: Number, default: 0 },
    contactedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Index for efficient querying
DueFeesFollowUpSchema.index({ admissionFee: 1, createdAt: -1 });
DueFeesFollowUpSchema.index({ coordinator: 1, contactedAt: -1 });

export default mongoose.model('DueFeesFollowUp', DueFeesFollowUpSchema);
