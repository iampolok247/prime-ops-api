import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  date: { type: Date, default: Date.now },
  method: { 
    type: String, 
    enum: ['Cash', 'Bank Transfer', 'bKash', 'Nagad', 'Rocket', 'Card', 'Other'],
    default: 'Cash'
  },
  note: { type: String, default: '' },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});

const recruitmentDueSchema = new mongoose.Schema({
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RecruitmentCandidate',
    required: true
  },
  employer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RecruitmentEmployer'
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RecruitmentJob'
  },
  description: {
    type: String,
    default: ''
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  payments: [paymentSchema],
  status: {
    type: String,
    enum: ['Pending', 'Partial', 'Paid'],
    default: 'Pending'
  },
  dueDate: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Virtual for due amount
recruitmentDueSchema.virtual('dueAmount').get(function() {
  return this.totalAmount - this.paidAmount;
});

// Update status based on paid amount
recruitmentDueSchema.pre('save', function(next) {
  if (this.paidAmount >= this.totalAmount) {
    this.status = 'Paid';
  } else if (this.paidAmount > 0) {
    this.status = 'Partial';
  } else {
    this.status = 'Pending';
  }
  next();
});

// Include virtuals in JSON
recruitmentDueSchema.set('toJSON', { virtuals: true });
recruitmentDueSchema.set('toObject', { virtuals: true });

export default mongoose.model('RecruitmentDue', recruitmentDueSchema);
