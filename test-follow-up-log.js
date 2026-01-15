// Quick test script to verify follow-up logging
import { logActivity } from './routes/activities.js';

async function testLog() {
  console.log('Testing logActivity function...');
  
  try {
    await logActivity(
      'test-user-id',
      'Test User',
      'test@example.com',
      'Admission',
      'UPDATE',
      'Lead',
      'Test Lead (LEAD-2025-TEST-001)',
      'Added follow-up note: "This is a test note from script"'
    );
    
    console.log('✅ Log activity completed successfully!');
  } catch (error) {
    console.error('❌ Error logging activity:', error);
  }
  
  process.exit(0);
}

testLog();
