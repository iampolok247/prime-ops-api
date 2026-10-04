import mongoose from 'mongoose';

// Meta CRM auto-assignment: one Admission counsellor per course.
// When a Meta lead arrives (webhook) whose interestedCourse matches courseName
// (case-insensitive), it is assigned to this counsellor straight away.
// Managed by DM/Admin from Meta Leads Center → Auto-Assign.
const MetaCourseAssignmentSchema = new mongoose.Schema(
  {
    courseName: { type: String, required: true, trim: true },
    courseKey: { type: String, required: true, unique: true }, // lower-cased courseName for matching
    counsellor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export const courseKeyOf = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

export default mongoose.models.MetaCourseAssignment || mongoose.model('MetaCourseAssignment', MetaCourseAssignmentSchema);
