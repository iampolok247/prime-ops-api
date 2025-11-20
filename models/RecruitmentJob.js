// api/models/RecruitmentJob.js
import mongoose from 'mongoose';

const RecruitmentJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  position: { type: String, required: true, trim: true },
  employer: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentEmployer', required: true },
  salaryRange: { type: String, trim: true },
  deadline: { type: Date },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' }
}, { timestamps: true });

const RecruitmentJob = mongoose.models.RecruitmentJob
  || mongoose.model('RecruitmentJob', RecruitmentJobSchema);

export default RecruitmentJob;
