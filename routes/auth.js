import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { comparePassword, hashPassword } from '../utils/hash.js';
import { requireAuth } from '../middleware/auth.js';

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
  return res.json({ user });
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
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
