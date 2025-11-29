import mongoose from 'mongoose';
import Notification from './models/Notification.js';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

async function testNotifications() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get a user to test with - use J.R Polok specifically
    const user = await User.findOne({ name: 'J.R Polok' });
    if (!user) {
      console.log('❌ User not found. Let me list all users:');
      const allUsers = await User.find().select('name role email');
      console.log('Available users:');
      allUsers.forEach(u => console.log(`  - ${u.name} (${u.role})`));
      process.exit(1);
    }

    console.log('📌 Testing with user:', user.name, '(ID:', user._id, ')');

    // Create multiple test notifications with different types
    const notificationTypes = [
      {
        type: 'LEAVE_SUBMITTED',
        title: 'Leave Application Submitted',
        message: 'Your leave application has been submitted for review',
        link: '/my-applications'
      },
      {
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: 'You have been assigned a new task',
        link: '/tasks'
      },
      {
        type: 'MESSAGE_RECEIVED',
        title: 'New Message',
        message: 'You have received a new message',
        link: '/messages'
      },
      {
        type: 'TADA_SUBMITTED',
        title: 'TA/DA Application Submitted',
        message: 'Your TA/DA application has been submitted',
        link: '/my-applications'
      }
    ];

    let createdCount = 0;
    for (const notifData of notificationTypes) {
      const notification = await Notification.create({
        recipient: user._id,
        sender: user._id,
        type: notifData.type,
        title: notifData.title,
        message: notifData.message,
        link: notifData.link,
        relatedModel: notifData.type.includes('LEAVE') ? 'LeaveApplication' : notifData.type.includes('TASK') ? 'Task' : null,
        isRead: false
      });
      createdCount++;
      console.log(`✅ Created notification ${createdCount}/4:`, notification.type, '-', notification.title);
    }

    // Fetch the last one to show details
    const notification = await Notification.findOne({ recipient: user._id }).sort({ createdAt: -1 });

    // Verify we can fetch it
    const fetched = await Notification.findById(notification._id).populate('sender', 'name email');
    console.log('✅ Fetched notification:', {
      _id: fetched._id,
      title: fetched.title,
      message: fetched.message,
      sender: fetched.sender?.name,
      isRead: fetched.isRead
    });

    // Check unread count
    const unreadCount = await Notification.countDocuments({
      recipient: user._id,
      isRead: false
    });
    console.log('📊 Total unread notifications for this user:', unreadCount);

    // List all notifications for this user
    const allNotifications = await Notification.find({ recipient: user._id })
      .populate('sender', 'name email')
      .sort({ createdAt: -1 });
    console.log('📋 All notifications for this user:', allNotifications.length);
    allNotifications.forEach((n, i) => {
      console.log(`   ${i + 1}. ${n.type} - ${n.title} (read: ${n.isRead})`);
    });

    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testNotifications();
