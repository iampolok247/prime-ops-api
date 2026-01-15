// Simple script to update Syed Tanvir's role to HeadOfCreative
// Run this on your production server: node update-tanvir-role.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const updateRole = async () => {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primeopsdb';
    
    await mongoose.connect(mongoUri, {
      dbName: 'primeops'
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Direct MongoDB update - no need to import User model
    const result = await mongoose.connection.db.collection('users').updateOne(
      { email: 'syedtanvirhossainalin@gmail.com' },
      { 
        $set: { 
          role: 'HeadOfCreative',
          jobTitle: 'Head of Creative'
        } 
      }
    );
    
    console.log('Update result:', result);
    
    if (result.matchedCount === 0) {
      console.log('❌ User not found with email: syedtanvirhossainalin@gmail.com');
    } else if (result.modifiedCount > 0) {
      console.log('✅ Successfully updated Syed Tanvir Hossain Alin to HeadOfCreative role');
      
      // Show updated user
      const updatedUser = await mongoose.connection.db.collection('users').findOne(
        { email: 'syedtanvirhossainalin@gmail.com' },
        { projection: { name: 1, email: 1, role: 1, jobTitle: 1 } }
      );
      console.log('Updated user:', updatedUser);
    } else {
      console.log('ℹ️ User already has HeadOfCreative role');
    }
    
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

updateRole();
