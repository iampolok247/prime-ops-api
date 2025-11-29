// Script to manually set displayOrder for SuperAdmins
import mongoose from 'mongoose';
import User from './models/User.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/primeops';

const orders = [
  { name: 'Ikhtiar Rahman', order: 1 },
  { name: 'Pauline Price', order: 2 },
  { name: 'Raj Pahal', order: 3 },
  { name: 'Shahriar Arafat', order: 4 },
  { name: 'Kazi Sazzad', order: 5 }
];

async function run() {
  await mongoose.connect(MONGO_URI);
  for (const { name, order } of orders) {
    const user = await User.findOne({ name, role: 'SuperAdmin' });
    if (user) {
      user.displayOrder = order;
      await user.save();
      console.log(`Set order for ${name} to ${order}`);
    } else {
      console.log(`User not found: ${name}`);
    }
  }
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
