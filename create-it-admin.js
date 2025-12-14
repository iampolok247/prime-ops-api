import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB } from './config/db.js';
import User from './models/User.js';

dotenv.config();

async function createITAdmin() {
  try {
    await connectDB(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    const existingUser = await User.findOne({ email: 'engnr.polok@gmail.com' });
    if (existingUser) {
      console.log('ℹ️  IT Admin already exists');
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash('01617134501Jrp', 10);

    const itAdmin = new User({
      name: 'Jonakur Rohan',
      email: 'engnr.polok@gmail.com',
      password: hashedPassword,
      role: 'ITAdmin',
      department: 'IT',
      designation: 'IT Administrator',
      phone: '01617134501',
      isActive: true,
      displayOrder: 999,
    });

    await itAdmin.save();
    console.log('✅ IT Admin created!');
    console.log('Email: engnr.polok@gmail.com');
    console.log('Password: 01617134501Jrp');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createITAdmin();
