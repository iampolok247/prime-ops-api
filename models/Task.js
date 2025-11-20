import mongoose from 'mongoose';

const ChecklistItemSchema = new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const CommentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const AttachmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  type: { type: String, enum: ['file', 'image', 'doc', 'link'], default: 'file' },
  size: { type: Number },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now }
});

const TaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    
    // Status Management
    status: { 
      type: String, 
      enum: ['To Do', 'In Progress', 'In Review', 'Completed'], 
      default: 'To Do' 
    },
    
    // Priority Management
    priority: { 
      type: String, 
      enum: ['Low', 'Medium', 'High', 'Critical'], 
      default: 'Medium' 
    },
    
    // Assignment
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Multiple users
    
    // Dates
    dueDate: { type: Date }, // Optional - not all tasks need deadlines
    completedAt: { type: Date },
    
    // Tags/Labels
    tags: [{ 
      type: String, 
      enum: ['Admission', 'Accounting', 'Recruitment', 'Digital Marketing', 'Motion Graphics', 'SEO', 'Social Media', 'Content Creation', 'Administration', 'Management'] 
    }],
    
    // Attachments
    attachments: [AttachmentSchema],
    
    // Comments with mentions
    comments: [CommentSchema],
    
    // Checklist (subtasks)
    checklist: [ChecklistItemSchema],
    
    // Kanban position
    boardColumn: { 
      type: String, 
      enum: ['Backlog', 'To Do', 'In Progress', 'In Review', 'Completed'], 
      default: 'To Do' 
    },
    boardPosition: { type: Number, default: 0 },
    
    // Tracking
    isOverdue: { type: Boolean, default: false },
    notificationsSent: {
      assigned: { type: Boolean, default: false },
      dueSoon: { type: Boolean, default: false },
      overdue: { type: Boolean, default: false },
      completed: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

// Index for efficient queries
TaskSchema.index({ assignedTo: 1, status: 1 });
TaskSchema.index({ assignedBy: 1 });
TaskSchema.index({ dueDate: 1 });
TaskSchema.index({ boardColumn: 1, boardPosition: 1 });

// Virtual to check if overdue
TaskSchema.virtual('overdue').get(function() {
  return this.status !== 'Completed' && this.dueDate < new Date();
});

export default mongoose.model('Task', TaskSchema);
