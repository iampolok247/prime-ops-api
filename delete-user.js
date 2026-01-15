// Script to freeze/deactivate user: rafsaniat@primeacademy.org
import mongoose from 'mongoose';
import User from './models/User.js';
import { connectDB } from './config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const email = 'rafsaniat@primeacademy.org';

async function freezeUser() {
  try {
    await connectDB(process.env.MONGO_URI || 'mongodb://localhost:27017/primeops');
    
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log(`❌ User not found with email: ${email}`);
      process.exit(1);
    }
    
    console.log(`\n📋 Found user:`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Current Status: ${user.isActive ? 'Active ✅' : 'Frozen ❄️'}`);
    console.log(`   ID: ${user._id}`);
    
    if (!user.isActive) {
      console.log(`\n⚠️  User is already frozen!`);
      process.exit(0);
    }
    
    console.log(`\n❄️  Freezing user account...`);
    user.isActive = false;
    await user.save();
    
    console.log(`✅ Successfully frozen user: ${user.name} (${email})`);
    console.log(`   This user can no longer log in.`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

freezeUser();
