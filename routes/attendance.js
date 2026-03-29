import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';

const router = Router();

// Helper to get today's date in YYYY-MM-DD format
function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Record login (called from auth route on successful login)
export async function recordLogin(userId, req) {
  try {
    const today = getTodayDate();
    const now = new Date();
    
    // Check if already logged in today
    const existing = await Attendance.findOne({ user: userId, date: today });
    
    if (existing) {
      // Already have attendance for today, don't create new one
      return existing;
    }
    
    // Create new attendance record
    const attendance = await Attendance.create({
      user: userId,
      date: today,
      loginTime: now,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
      userAgent: req.headers['user-agent'] || ''
    });
    
    return attendance;
  } catch (err) {
    console.error('Error recording login attendance:', err);
    return null;
  }
}

// Record logout
export async function recordLogout(userId) {
  try {
    const today = getTodayDate();
    const now = new Date();
    
    const attendance = await Attendance.findOne({ user: userId, date: today });
    
    if (attendance && !attendance.logoutTime) {
      attendance.logoutTime = now;
      // Calculate total hours in minutes
      const diffMs = now - attendance.loginTime;
      attendance.totalHours = Math.round(diffMs / 60000); // Convert to minutes
      await attendance.save();
      return attendance;
    }
    
    return attendance;
  } catch (err) {
    console.error('Error recording logout attendance:', err);
    return null;
  }
}

// GET /api/attendance/today - Get current user's today attendance
router.get('/today', requireAuth, async (req, res) => {
  try {
    const today = getTodayDate();
    const attendance = await Attendance.findOne({ 
      user: req.user._id, 
      date: today 
    });
    
    res.json({ attendance });
  } catch (err) {
    console.error('Error fetching today attendance:', err);
    res.status(500).json({ message: 'Failed to fetch attendance' });
  }
});

// GET /api/attendance/my - Get current user's attendance history
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { from, to, limit = 30 } = req.query;
    
    const query = { user: req.user._id };
    
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }
    
    const attendances = await Attendance.find(query)
      .sort({ date: -1 })
      .limit(Number(limit));
    
    res.json({ attendances });
  } catch (err) {
    console.error('Error fetching attendance history:', err);
    res.status(500).json({ message: 'Failed to fetch attendance history' });
  }
});

// GET /api/attendance/all - Get all employees attendance (Accountant/Admin only)
router.get('/all', requireAuth, authorize(['Accountant', 'Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { from, to, userId, date } = req.query;
    
    const query = {};
    
    // Filter by specific date
    if (date) {
      query.date = date;
    } else if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    } else {
      // Default to today
      query.date = getTodayDate();
    }
    
    // Filter by specific user
    if (userId) {
      query.user = userId;
    }
    
    const attendances = await Attendance.find(query)
      .populate('user', 'name email role designation')
      .sort({ date: -1, loginTime: -1 });
    
    res.json({ attendances });
  } catch (err) {
    console.error('Error fetching all attendance:', err);
    res.status(500).json({ message: 'Failed to fetch attendance records' });
  }
});

// GET /api/attendance/report - Get attendance report (Accountant/Admin only)
router.get('/report', requireAuth, authorize(['Accountant', 'Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { from, to } = req.query;
    
    if (!from || !to) {
      return res.status(400).json({ message: 'From and to dates are required' });
    }
    
    // Get all active users
    const users = await User.find({ status: { $ne: 'Inactive' } })
      .select('name email role designation');
    
    // Get attendance records for the period
    const attendances = await Attendance.find({
      date: { $gte: from, $lte: to }
    }).populate('user', 'name email role');
    
    // Group by user
    const userAttendanceMap = {};
    
    users.forEach(user => {
      userAttendanceMap[user._id.toString()] = {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          designation: user.designation
        },
        totalDays: 0,
        presentDays: 0,
        totalMinutes: 0,
        records: []
      };
    });
    
    attendances.forEach(att => {
      const userId = att.user?._id?.toString();
      if (userId && userAttendanceMap[userId]) {
        userAttendanceMap[userId].presentDays++;
        userAttendanceMap[userId].totalMinutes += att.totalHours || 0;
        userAttendanceMap[userId].records.push({
          date: att.date,
          loginTime: att.loginTime,
          logoutTime: att.logoutTime,
          totalHours: att.totalHours
        });
      }
    });
    
    // Calculate total working days in range
    const startDate = new Date(from);
    const endDate = new Date(to);
    let totalDays = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      // Exclude weekends (Friday and Saturday for BD)
      const day = d.getDay();
      if (day !== 5 && day !== 6) {
        totalDays++;
      }
    }
    
    // Set total days for each user
    Object.values(userAttendanceMap).forEach(u => {
      u.totalDays = totalDays;
    });
    
    const report = Object.values(userAttendanceMap);
    
    res.json({ 
      report,
      period: { from, to },
      totalWorkingDays: totalDays
    });
  } catch (err) {
    console.error('Error generating attendance report:', err);
    res.status(500).json({ message: 'Failed to generate report' });
  }
});

// POST /api/attendance/manual - Manual attendance entry (Admin only)
router.post('/manual', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { userId, date, loginTime, logoutTime } = req.body;
    
    if (!userId || !date || !loginTime) {
      return res.status(400).json({ message: 'User, date and login time are required' });
    }
    
    // Check if already exists
    const existing = await Attendance.findOne({ user: userId, date });
    
    if (existing) {
      // Update existing
      existing.loginTime = new Date(loginTime);
      if (logoutTime) {
        existing.logoutTime = new Date(logoutTime);
        const diffMs = existing.logoutTime - existing.loginTime;
        existing.totalHours = Math.round(diffMs / 60000);
      }
      await existing.save();
      return res.json({ attendance: existing, message: 'Attendance updated' });
    }
    
    // Create new
    const attendance = await Attendance.create({
      user: userId,
      date,
      loginTime: new Date(loginTime),
      logoutTime: logoutTime ? new Date(logoutTime) : null,
      totalHours: logoutTime ? Math.round((new Date(logoutTime) - new Date(loginTime)) / 60000) : 0
    });
    
    res.status(201).json({ attendance, message: 'Attendance created' });
  } catch (err) {
    console.error('Error creating manual attendance:', err);
    res.status(500).json({ message: 'Failed to create attendance' });
  }
});

export default router;
