const mongoose = require('mongoose');
const DMDailyChecklist = require('./models/DMDailyChecklist');

async function resetTodayChecklist() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/prime-ops-dev');
    console.log('✅ Connected to MongoDB');
    
    const today = new Date().toISOString().split('T')[0];
    console.log('📅 Today\'s date:', today);
    
    const result = await DMDailyChecklist.deleteMany({ date: today });
    console.log('🗑️  Deleted', result.deletedCount, 'checklist(s) for today');
    
    await mongoose.connection.close();
    console.log('✅ Done! Refresh your browser to see new 21 tasks');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

resetTodayChecklist();
