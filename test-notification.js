import mongoose from 'mongoose';
import Notification from './models/Notification.js';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/primeops';

async function testNotifications() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find an admin user
    const admin = await User.findOne({ role: { $in: ['Admin', 'SuperAdmin'] } });
    if (!admin) {
      console.log('❌ No admin user found in database');
      process.exit(1);
    }
    console.log('👤 Found admin user:', admin.name, admin.email, admin._id);

    // Check existing notifications for this admin
    console.log('\n📋 Checking existing notifications for admin...');
    const existingNotifs = await Notification.find({ recipient: admin._id }).sort({ createdAt: -1 }).limit(5);
    console.log(`Found ${existingNotifs.length} notifications:`);
    existingNotifs.forEach(n => {
      console.log(`  - ${n.type}: ${n.title} (read: ${n.isRead}) - ${n.createdAt}`);
    });

    // Count unread
    const unreadCount = await Notification.countDocuments({ recipient: admin._id, isRead: false });
    console.log(`\n📊 Unread notifications for admin: ${unreadCount}`);

    // Check all recent notifications in system
    console.log('\n📋 Recent notifications in system (all users):');
    const allRecent = await Notification.find({}).sort({ createdAt: -1 }).limit(10).populate('recipient', 'name email');
    allRecent.forEach(n => {
      console.log(`  - ${n.type} → ${n.recipient?.name || 'Unknown'} (${n.recipient?._id}) | Read: ${n.isRead} | ${n.createdAt}`);
    });

    // Create a test notification
    console.log('\n🧪 Creating test notification...');
    const testNotif = await Notification.create({
      recipient: admin._id,
      sender: admin._id,
      type: 'LEAVE_SUBMITTED',
      title: 'TEST: Leave Application Notification',
      message: 'This is a test notification to verify the system works',
      link: '/admin/approvals',
      relatedModel: 'LeaveApplication',
      isRead: false
    });
    console.log('✅ Test notification created:', testNotif._id);
    console.log('   Recipient:', testNotif.recipient);
    console.log('   Type:', testNotif.type);
    console.log('   isRead:', testNotif.isRead);

    // Query it back
    console.log('\n🔍 Querying notification back...');
    const queried = await Notification.findById(testNotif._id);
    console.log('Found:', queried ? 'YES' : 'NO');
    if (queried) {
      console.log('  Type:', queried.type);
      console.log('  Recipient:', queried.recipient);
      console.log('  isRead:', queried.isRead);
    }

    // Query with same query as API
    console.log('\n🔍 Querying with API query (unread for admin)...');
    const apiQuery = await Notification.find({ recipient: admin._id, isRead: false })
      .populate('sender', 'name email role avatar')
      .sort({ createdAt: -1 })
      .limit(20);
    console.log(`Found ${apiQuery.length} unread notifications`);
    apiQuery.forEach(n => {
      console.log(`  - ${n.type}: ${n.title}`);
    });

    console.log('\n✅ Test complete!');
    console.log('\n📝 Summary:');
    console.log(`   - Admin user ID: ${admin._id}`);
    console.log(`   - Total notifications for admin: ${existingNotifs.length}`);
    console.log(`   - Unread count: ${unreadCount + 1}`);
    console.log(`   - Test notification ID: ${testNotif._id}`);
    console.log('\n💡 Open your browser and check the notification bell!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

testNotifications();
