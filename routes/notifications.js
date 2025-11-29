import express from 'express';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// @route   GET /api/notifications/unread-count
// @desc    Get count of unread notifications
// @access  Private
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ code: 'FETCH_ERROR', message: 'Failed to fetch unread count' });
  }
});

// @route   PATCH /api/notifications/mark-all-read
// @desc    Mark all notifications as read
// @access  Private
router.patch('/mark-all-read', async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ code: 'UPDATE_ERROR', message: 'Failed to update notifications' });
  }
});

// @route   GET /api/notifications
// @desc    Get user's notifications
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { isRead, limit = 50 } = req.query;
    
    console.log('🔔 [GET /api/notifications] Request from user:', req.user.name, req.user.id);
    console.log('🔔 [GET /api/notifications] Query params:', { isRead, limit });
    
    const query = { recipient: req.user.id };
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    console.log('🔔 [GET /api/notifications] MongoDB query:', JSON.stringify(query));

    const notifications = await Notification.find(query)
      .populate('sender', 'name email role avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    console.log('🔔 [GET /api/notifications] Found', notifications.length, 'notifications');
    notifications.forEach(n => {
      console.log('   -', n.type, ':', n.title, '| isRead:', n.isRead, '| ID:', n._id);
    });

    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    console.log('🔔 [GET /api/notifications] Unread count:', unreadCount);

    // Disable caching for notifications
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('❌ [GET /api/notifications] Error fetching notifications:', error);
    res.status(500).json({ code: 'FETCH_ERROR', message: 'Failed to fetch notifications' });
  }
});

// @route   PATCH /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.patch('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user.id
    });

    if (!notification) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Notification not found' });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    res.json({ notification });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ code: 'UPDATE_ERROR', message: 'Failed to update notification' });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user.id
    });

    if (!notification) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ code: 'DELETE_ERROR', message: 'Failed to delete notification' });
  }
});

export default router;
