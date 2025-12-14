import express from 'express';
import ActivityLog from '../models/ActivityLog.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get all activities with filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    if (!['ITAdmin', 'SuperAdmin', 'Admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { page = 1, limit = 50, userId, action, resourceType, startDate, endDate } = req.query;

    const filter = {};
    if (userId) filter.user = userId;
    if (action) filter.action = action;
    if (resourceType) filter.resourceType = resourceType;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const total = await ActivityLog.countDocuments(filter);
    const activities = await ActivityLog.find(filter)
      .populate('user', 'name email role avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      activities,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit), limit: parseInt(limit) }
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get activity statistics
router.get('/stats', requireAuth, async (req, res) => {
  try {
    if (!['ITAdmin', 'SuperAdmin', 'Admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const totalActivities = await ActivityLog.countDocuments();
    const actionStats = await ActivityLog.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } }
    ]);

    res.json({ totalActivities, actionStats });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Manual logging helper
export async function logActivity(userId, userName, userEmail, userRole, action, resourceType, resourceName, description) {
  try {
    await ActivityLog.create({
      user: userId,
      userName,
      userEmail,
      userRole,
      action,
      resourceType,
      resourceName,
      description
    });
  } catch (error) {
    console.error('Activity log error:', error);
  }
}

export default router;
