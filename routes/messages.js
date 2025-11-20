import express from 'express';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * Get all conversations (list of users you've chatted with)
 */
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all unique users the current user has communicated with
    const sentMessages = await Message.find({ sender: userId }).distinct('recipient');
    const receivedMessages = await Message.find({ recipient: userId }).distinct('sender');
    
    // Combine and deduplicate
    const userIds = [...new Set([...sentMessages, ...receivedMessages])];
    
    // Get user details and last message for each conversation
    const conversations = await Promise.all(
      userIds.map(async (otherUserId) => {
        const user = await User.findById(otherUserId).select('name email avatar role designation isActive');
        
        // Get last message
        const lastMessage = await Message.findOne({
          $or: [
            { sender: userId, recipient: otherUserId },
            { sender: otherUserId, recipient: userId }
          ]
        }).sort({ createdAt: -1 });

        // Count unread messages from this user
        const unreadCount = await Message.countDocuments({
          sender: otherUserId,
          recipient: userId,
          isRead: false
        });

        return {
          user,
          lastMessage,
          unreadCount
        };
      })
    );

    // Sort by last message timestamp
    conversations.sort((a, b) => {
      const timeA = a.lastMessage?.createdAt || 0;
      const timeB = b.lastMessage?.createdAt || 0;
      return timeB - timeA;
    });

    return res.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

/**
 * Get messages with a specific user
 */
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;
    const { limit = 50, before } = req.query;

    // Build query
    const query = {
      $or: [
        { sender: currentUserId, recipient: userId },
        { sender: userId, recipient: currentUserId }
      ]
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('sender', 'name email avatar role')
      .populate('recipient', 'name email avatar role');

    // Mark messages as read
    await Message.updateMany(
      { sender: userId, recipient: currentUserId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.json({ messages: messages.reverse() });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

/**
 * Send a message
 */
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { recipient, content, attachments } = req.body;

    if (!recipient || !content) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Recipient and content are required' });
    }

    // Check if recipient exists and is active
    const recipientUser = await User.findById(recipient);
    if (!recipientUser || !recipientUser.isActive) {
      return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'Recipient not found' });
    }

    const message = await Message.create({
      sender: req.user.id,
      recipient,
      content,
      attachments: attachments || []
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email avatar role')
      .populate('recipient', 'name email avatar role');

    return res.status(201).json({ message: populatedMessage });
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

/**
 * Mark messages as read
 */
router.patch('/:userId/read', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;

    await Message.updateMany(
      { sender: userId, recipient: currentUserId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

/**
 * Delete a message (soft delete - only for sender)
 */
router.delete('/:messageId', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }

    if (message.sender.toString() !== req.user.id) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'You can only delete your own messages' });
    }

    await Message.findByIdAndDelete(messageId);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting message:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

/**
 * Get unread message count
 */
router.get('/unread/count', requireAuth, async (req, res) => {
  try {
    const count = await Message.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    return res.json({ count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return res.status(500).json({ code: 'SERVER_ERROR', message: error.message });
  }
});

export default router;
