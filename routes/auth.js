import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { comparePassword, hashPassword } from '../utils/hash.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from './activities.js';

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email, isActive: true }).select('+password');
    if (!user) return res.status(400).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });

    const ok = await comparePassword(password, user.password);
    if (!ok) return res.status(400).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });

    const payload = { id: user._id.toString(), role: user.role, email: user.email, name: user.name };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Set cookie for same-origin requests
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production', // true in production for HTTPS
      path: '/'
    });

    const { password: _, ...safe } = user.toObject();
    
    // Log login activity
    await logActivity(
      user._id.toString(),
      user.name,
      user.email,
      user.role,
      'LOGIN',
      'Auth',
      user.email,
      `User logged in`
    );
    
    // Also send token in response body for cross-origin setups
    return res.json({ user: safe, token });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Me
router.get('/me', requireAuth, async (req, res) => {
  console.log('[AUTH /me] JWT Token contains:', JSON.stringify(req.user));
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
  console.log('[AUTH /me] Database shows role:', user.role);
  
  // Log ACCESS activity (only once per day to avoid spam)
  const ActivityLog = (await import('../models/ActivityLog.js')).default;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const existingAccessToday = await ActivityLog.findOne({
    user: req.user.id,
    action: 'ACCESS',
    createdAt: { $gte: today, $lt: tomorrow }
  });
  
  if (!existingAccessToday) {
    await logActivity(
      req.user.id,
      req.user.name,
      req.user.email,
      req.user.role,
      'ACCESS',
      'Auth',
      req.user.email,
      `User accessed portal (session restored)`
    );
  }
  
  // If JWT role doesn't match database role, return both for debugging
  if (req.user.role !== user.role) {
    console.log('[AUTH /me] WARNING: JWT role mismatch! JWT:', req.user.role, 'DB:', user.role);
    return res.json({ 
      user, 
      _debug: { 
        jwtRole: req.user.role, 
        dbRole: user.role,
        message: 'Role mismatch detected - please logout and login again'
      }
    });
  }
  
  return res.json({ user });
});

// Logout
router.post('/logout', requireAuth, async (req, res) => {
  // Log logout activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'LOGOUT',
    'Auth',
    req.user.email,
    `User logged out`
  );
  
  res.clearCookie('token', { path: '/' });
  return res.json({ ok: true });
});

// Update profile (name, avatar, password change)
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { name, avatar, currentPassword, newPassword } = req.body || {};
    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });

    if (name) user.name = name;
    if (avatar) user.avatar = avatar;

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ code: 'CURRENT_PASSWORD_REQUIRED', message: 'Current password required' });
      }
      const ok = await comparePassword(currentPassword, user.password);
      if (!ok) {
        return res.status(400).json({ code: 'INVALID_CURRENT_PASSWORD', message: 'Current password incorrect' });
      }
      user.password = await hashPassword(newPassword);
    }

    await user.save();
    const { password: _, ...safe } = user.toObject();
    return res.json({ user: safe });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
