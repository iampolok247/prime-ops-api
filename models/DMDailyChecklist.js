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
        // Hour 1 – Lead Download & OPS Assignment
        { task: '⏰ Hour 1: Download new leads from Lead Center', category: 'Lead Management', order: 1 },
        { task: '⏰ Hour 1: Clean duplicate/invalid numbers and categorize by course interest', category: 'Lead Management', order: 2 },
        { task: '⏰ Hour 1: Update master lead sheet and assign leads to Admission Team in OPS', category: 'Lead Management', order: 3 },
        { task: '⏰ Hour 1: Notify team about hot leads', category: 'Lead Management', order: 4 },
        
        // Hour 2 – Lead Status Monitoring & Coordination
        { task: '⏰ Hour 2: Review yesterday\'s lead status and follow up with admission team', category: 'Lead Management', order: 5 },
        { task: '⏰ Hour 2: Update lead sheet (Contacted/Pending/Converted) and identify follow-up gaps', category: 'Lead Management', order: 6 },
        { task: '⏰ Hour 2: Shortlist leads for retargeting', category: 'Lead Management', order: 7 },
        
        // Hour 3-4 – Content Creation & Publishing
        { task: '⏰ Hour 3-4: Script & produce 1 Reel', category: 'Content Creation', order: 8 },
        { task: '⏰ Hour 3-4: Create 1-2 static/carousel posts with optimized captions (CTA included)', category: 'Content Creation', order: 9 },
        { task: '⏰ Hour 3-4: Schedule content and engage within first 30 minutes of posting', category: 'Social Media', order: 10 },
        { task: '⏰ Hour 3-4: Prepare next day content draft', category: 'Content Creation', order: 11 },
        
        // Hour 5 – Organic Lead Generation & Outreach
        { task: '⏰ Hour 5: Collect 15-30 organic leads (Groups/Inbox/Directory)', category: 'Lead Management', order: 12 },
        { task: '⏰ Hour 5: Business page outreach and corporate training prospect research', category: 'Lead Management', order: 13 },
        { task: '⏰ Hour 5: Update CRM with new organic leads', category: 'Lead Management', order: 14 },
        
        // Hour 6 – Paid Campaign Monitoring & Optimization
        { task: '⏰ Hour 6: Check Ads Manager (CPL, CTR, CPC) and monitor budget & ad fatigue', category: 'Paid Campaigns', order: 15 },
        { task: '⏰ Hour 6: Suggest creative or audience testing and plan A/B test idea', category: 'Paid Campaigns', order: 16 },
        
        // Hour 7 – Competitor & Market Analysis
        { task: '⏰ Hour 7: Monitor 3-5 competitor ads and document offer strategy', category: 'Market Research', order: 17 },
        { task: '⏰ Hour 7: Identify trending hooks and research new campaign angles', category: 'Market Research', order: 18 },
        
        // Hour 8 – Funnel, Website & Reporting
        { task: '⏰ Hour 8: Test landing page & forms, review pixel tracking', category: 'Analytics & Reporting', order: 19 },
        { task: '⏰ Hour 8: Analyze daily performance data and prepare daily summary report', category: 'Analytics & Reporting', order: 20 },
        { task: '⏰ Hour 8: Plan tomorrow\'s priority tasks', category: 'General', order: 21 }
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
