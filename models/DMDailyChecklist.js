// api/models/DMDailyChecklist.js
import mongoose from 'mongoose';

const checklistItemSchema = new mongoose.Schema({
  task: { type: String, required: true },
  category: { type: String, default: 'General' },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  comment: { type: String, default: '' },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const dmDailyChecklistSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  date: { 
    type: String, // Format: YYYY-MM-DD
    required: true 
  },
  items: [checklistItemSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Compound index to ensure one checklist per user per day
dmDailyChecklistSchema.index({ userId: 1, date: 1 }, { unique: true });

// Static method to get or create today's checklist
dmDailyChecklistSchema.statics.getOrCreateToday = async function(userId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  
  let checklist = await this.findOne({ userId, date: today });
  
  if (!checklist) {
    checklist = await this.create({
      userId,
      date: today,
      items: [] // Start with empty checklist - user will add tasks manually
    });
  }
  
  return checklist;
};

// Instance method to mark a task as complete with comment
dmDailyChecklistSchema.methods.completeTask = async function(taskIndex, comment = '') {
  if (taskIndex < 0 || taskIndex >= this.items.length) {
    throw new Error('Invalid task index');
  }
  
  this.items[taskIndex].completed = true;
  this.items[taskIndex].completedAt = new Date();
  this.items[taskIndex].comment = comment;
  this.updatedAt = new Date();
  
  await this.save();
  return this;
};

// Instance method to uncomplete a task
dmDailyChecklistSchema.methods.uncompleteTask = async function(taskIndex) {
  if (taskIndex < 0 || taskIndex >= this.items.length) {
    throw new Error('Invalid task index');
  }
  
  this.items[taskIndex].completed = false;
  this.items[taskIndex].completedAt = null;
  this.updatedAt = new Date();
  
  await this.save();
  return this;
};

// Get completion percentage
dmDailyChecklistSchema.methods.getCompletionPercentage = function() {
  if (this.items.length === 0) return 0;
  const completedCount = this.items.filter(item => item.completed).length;
  return Math.round((completedCount / this.items.length) * 100);
};

export default mongoose.model('DMDailyChecklist', dmDailyChecklistSchema);
