import mongoose from 'mongoose';

const LeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, required: true, unique: true, index: true }, // e.g., LEAD-2025-0001
    entryDate: { type: Date, default: Date.now },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    interestedCourse: { type: String, default: '' }, // (Phase 5+ can ref Course)
    source: {
      type: String,
      enum: ['Meta Lead', 'LinkedIn Lead', 'Manually Generated Lead', 'Others'],
      default: 'Manually Generated Lead'
    },

    status: {
      type: String,
      enum: ['Assigned', 'Counseling', 'In Follow Up', 'Admitted', 'Not Admitted', 'Not Interested'],
      default: 'Assigned'
    },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admission member
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // DM user
    admittedToCourse: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }, // Course they were admitted to
    admittedToBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }, // Batch they were admitted to
    notes: { type: String, default: '' },
    nextFollowUpDate: { type: Date }, // Next scheduled follow-up date
    priority: { 
      type: String, 
      enum: ['Very Interested', 'Interested', 'Few Interested', 'Not Interested'],
      default: 'Interested'
    },
    specialFilter: { type: String, default: '', trim: true }, // Custom filter field for boost campaigns
    // stage timestamps
    assignedAt: { type: Date },
    counselingAt: { type: Date },
    admittedAt: { type: Date },
    // follow-ups history
    followUps: [
      {
        note: { type: String, default: '' },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      }
    ],
    // Custom fields from boost/ads forms (flexible key-value pairs)
    customFields: {
      type: Map,
      of: String,
      default: {}
    }
  },
  { timestamps: true }
);

export default mongoose.model('Lead', LeadSchema);
