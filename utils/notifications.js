import Notification from '../models/Notification.js';
import User from '../models/User.js';

/**
 * Create a notification for a specific user
 */
export async function createNotification(data) {
  try {
    console.log('🔔 Creating notification:', { 
      recipient: data.recipient, 
      sender: data.sender,
      type: data.type, 
      title: data.title
    });
    
    const notif = await Notification.create(data);
    console.log('✅ Notification created with ID:', notif._id);
    return notif;
  } catch (error) {
    console.error('❌ Error creating notification:', error.message);
    return null;
  }
}

/**
 * Send notification to all active Accountants
 */
export async function notifyAccountants(data) {
  try {
    const accountants = await User.find({ role: 'Accountant', isActive: true });
    console.log('📢 Sending notification to', accountants.length, 'accountants:', data.title);
    
    const notifications = [];
    for (const accountant of accountants) {
      const notif = await createNotification({
        ...data,
        recipient: accountant._id
      });
      if (notif) notifications.push(notif);
    }
    
    return notifications;
  } catch (error) {
    console.error('❌ Error notifying accountants:', error.message);
    return [];
  }
}

/**
 * Send notification to all active Admins and SuperAdmins
 */
export async function notifyAdmins(data) {
  try {
    const admins = await User.find({ 
      role: { $in: ['Admin', 'SuperAdmin'] }, 
      isActive: true 
    });
    console.log('📢 Sending notification to', admins.length, 'admins:', data.title);
    
    const notifications = [];
    for (const admin of admins) {
      const notif = await createNotification({
        ...data,
        recipient: admin._id
      });
      if (notif) notifications.push(notif);
    }
    
    return notifications;
  } catch (error) {
    console.error('❌ Error notifying admins:', error.message);
    return [];
  }
}

/**
 * Send notification to users with specific roles
 */
export async function notifyByRoles(roles, data) {
  try {
    const users = await User.find({ 
      role: { $in: roles }, 
      isActive: true 
    });
    console.log('📢 Sending notification to', users.length, 'users with roles', roles, ':', data.title);
    
    const notifications = [];
    for (const user of users) {
      const notif = await createNotification({
        ...data,
        recipient: user._id
      });
      if (notif) notifications.push(notif);
    }
    
    return notifications;
  } catch (error) {
    console.error('❌ Error notifying users:', error.message);
    return [];
  }
}
