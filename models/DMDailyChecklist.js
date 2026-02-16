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
    // Get yesterday's checklist to copy tasks
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const yesterdayChecklist = await this.findOne({ userId, date: yesterdayStr });
    
    let tasks = [];
    
    if (yesterdayChecklist && yesterdayChecklist.items.length > 0) {
      // Copy tasks from yesterday but reset completion status
      tasks = yesterdayChecklist.items.map(item => ({
        task: item.task,
        category: item.category,
        completed: false,
        completedAt: null,
        comment: '',
        order: item.order,
        createdAt: new Date()
      }));
    } else {
      // First time - create default tasks for Digital Marketing
      tasks = [
        { task: 'Download leads from Lead Center and assign to Admission Team in OPS', category: 'Lead Management', order: 1 },
        { task: 'Review and update lead conversion status with Admission Team', category: 'Lead Management', order: 2 },
        { task: 'Create and publish daily content across Facebook, Instagram, and LinkedIn', category: 'Content Creation', order: 3 },
        { task: 'Create and publish at least one Reel (Facebook/Instagram)', category: 'Content Creation', order: 4 },
        { task: 'Create and manage paid advertising campaigns across Meta (Facebook/Instagram) and LinkedIn when required', category: 'Paid Campaigns', order: 5 },
        { task: 'Check and optimise Facebook and Google Ads performance', category: 'Analytics & Reporting', order: 6 },
        { task: 'Manage online directory listings and update institutional profiles', category: 'General', order: 7 },
        { task: 'Conduct Facebook & Instagram group marketing and engagement', category: 'Social Media', order: 8 },
        { task: 'Research and collect big potential corporate/company leads', category: 'Lead Management', order: 9 },
        { task: 'Perform competitor analysis and monitor market strategies', category: 'Market Research', order: 10 },
        { task: 'Monitor and optimise Meta Pixel, landing pages, and conversion funnel', category: 'Analytics & Reporting', order: 11 },
        { task: 'Monitor website traffic and analytics', category: 'Analytics & Reporting', order: 12 },
        { task: 'Prepare daily performance report and next-day action plan', category: 'Analytics & Reporting', order: 13 },
        { task: 'Write and publish blog posts (SEO-optimised if required)', category: 'Content Creation', order: 14 },
        { task: 'BULK Message Through Whatsapp/Email/SMS', category: 'General', order: 15 }
      ];
    }
    
    checklist = await this.create({
      userId,
      date: today,
      items: tasks
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
