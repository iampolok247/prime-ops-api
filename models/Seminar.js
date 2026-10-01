import mongoose from 'mongoose';

// Seminar notice — posted by Digital Marketing, shown on every employee's dashboard.
// A seminar is "archived" automatically once it has ended (startAt + durationMinutes);
// nothing is stored for that, it is derived from the time.
const SeminarSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    mentorName: { type: String, required: true, trim: true },
    hostName: { type: String, required: true, trim: true },
    startAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 120, min: 15, max: 720 },
    meetingLink: { type: String, required: true, trim: true },
    endAt: { type: Date, index: true }, // startAt + durationMinutes, kept in sync on save
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

SeminarSchema.pre('validate', function setEndAt(next) {
  if (this.startAt) {
    this.endAt = new Date(new Date(this.startAt).getTime() + (this.durationMinutes || 120) * 60000);
  }
  next();
});

export default mongoose.models.Seminar || mongoose.model('Seminar', SeminarSchema);
