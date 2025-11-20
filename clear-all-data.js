import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import mongoose from 'mongoose';

dotenv.config();

(async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    
    // Get all collections
    const collections = await mongoose.connection.db.collections();
    
    console.log(`🗑️  Found ${collections.length} collections to clear...`);
    
    // Drop all collections
    for (let collection of collections) {
      await collection.drop();
      console.log(`   ✓ Dropped ${collection.collectionName}`);
    }
    
    console.log('✅ All data cleared successfully!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Clear error:', e.message);
    process.exit(1);
  }
})();
