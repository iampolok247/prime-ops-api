// api/models/RecruitmentEmployer.js
import mongoose from 'mongoose';

const RecruitmentEmployerSchema = new mongoose.Schema({
  empId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true },
  jobLocation: { type: String, trim: true },
  mouDate: { type: Date }
}, { timestamps: true });

const RecruitmentEmployer = mongoose.models.RecruitmentEmployer
  || mongoose.model('RecruitmentEmployer', RecruitmentEmployerSchema);

export default RecruitmentEmployer;
