import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import { hashPassword } from './utils/hash.js';

dotenv.config();

async function createSuperAdmin() {
  try {
    await connectDB(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    const email = 'hasan@primeacademy.org';
    const existing = await User.findOne({ email });
    if (existing) {
      console.log('ℹ️  SuperAdmin already exists');
      process.exit(0);
    }

    const hashed = await hashPassword('Hasan2025');

    const user = new User({
      name: 'Md Hasanuzzaman',
      email,
      password: hashed,
      role: 'SuperAdmin',
      roles: ['SuperAdmin'],
      department: 'Administration',
      designation: 'Super Admin',
      phone: '',
      isActive: true,
      displayOrder: 1,
    });

    await user.save();
    console.log('✅ SuperAdmin created!');
    console.log('Email:', email);
    console.log('Password: Hasan2025');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createSuperAdmin();
