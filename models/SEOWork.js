import mongoose from 'mongoose';

const SEOWorkSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    typeOfWork: { type: String, enum: ['Blogpost', 'Backlink', 'Social Bookmarking', 'Keyword Research', 'Others'], required: true },
    challenge: { type: String, default: '' },
    details: { type: String, default: '' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('SEOWork', SEOWorkSchema);
