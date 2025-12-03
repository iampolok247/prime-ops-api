// api/models/RecruitmentCandidate.js
import mongoose from 'mongoose';

const RecruitedMetaSchema = new mongoose.Schema({
  employer: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentEmployer' },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentJob' },
  date: { type: Date }
}, { _id: false });

const RecruitmentCandidateSchema = new mongoose.Schema({
  canId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true },
  jobInterest: { type: String, required: true, trim: true },
  source: {
    type: String,
    enum: ['Facebook', 'LinkedIn', 'Bdjobs', 'Reference', 'Prime Academy', 'Others'],
    required: true
  },
  district: { type: String, trim: true },
  trained: { type: Boolean, default: false },
  date: { type: Date, default: Date.now },
  cvLink: { type: String, trim: true },
  recruited: { type: Boolean, default: false },
  recruitedMeta: { type: RecruitedMetaSchema, default: null }
}, { timestamps: true });

const RecruitmentCandidate = mongoose.models.RecruitmentCandidate
  || mongoose.model('RecruitmentCandidate', RecruitmentCandidateSchema);

export default RecruitmentCandidate;
