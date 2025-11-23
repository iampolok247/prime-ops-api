import express from 'express';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { hashPassword } from '../utils/hash.js';

const router = express.Router();

/**
 * List all employees
 * All authenticated users can view user list (for task assignment)
 */
router.get('/', requireAuth, async (req, res) => {
  const users = await User.find().select('-password');
  return res.json({ users });
});

/**
 * List Admission users (for assigning leads)
 * Allowed: Admin, SuperAdmin, DigitalMarketing (read-only)
 */
router.get('/admission', requireAuth, authorize(['Admin', 'SuperAdmin', 'DigitalMarketing']), async (req, res) => {
  const users = await User.find({ role: 'Admission', isActive: true })
    .select('name email role avatar department designation');
  return res.json({ users });
});

/**
 * Lightweight user list for dropdowns
 * Allowed: Admin, SuperAdmin, Accountant, DigitalMarketing, Admission
 * Returns minimal fields (id, name, designation, role)
 */
router.get('/list', requireAuth, authorize(['Admin', 'SuperAdmin', 'Accountant', 'DigitalMarketing', 'Admission']), async (req, res) => {
  const users = await User.find({ isActive: true }).select('name designation role');
  return res.json({ users });
});

/**
 * Create employee
 * Admin only — cannot create SuperAdmin
 */
router.post('/', requireAuth, authorize(['Admin']), async (req, res) => {
  const { name, email, password, role, department, designation, avatar, phone, displayOrder } = req.body || {};
  if (role === 'SuperAdmin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot create Super Admin' });
  }
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ code: 'EMAIL_EXISTS', message: 'Email already in use' });

  const hashed = await hashPassword(password || 'password123');
  const user = await User.create({
    name, email, password: hashed, role, department, designation, avatar, phone, displayOrder: displayOrder || 0
  });
  const { password: _, ...safe } = user.toObject();
  return res.status(201).json({ user: safe });
});

/**
 * Update employee
 * Admin only — cannot modify/demote SuperAdmin
 */
router.put('/:id', requireAuth, authorize(['Admin']), async (req, res) => {
  console.log(`[UPDATE USER] ID: ${req.params.id}, Body:`, JSON.stringify(req.body));
  
  const target = await User.findById(req.params.id).select('+password');
  if (!target) return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
  
  // Log request body for debugging SuperAdmin updates
  if (target.role === 'SuperAdmin') {
    console.log('[SuperAdmin] Attempting update - User:', target.name, 'Role:', target.role);
  }
  
  const { name, email, role, department, designation, avatar, phone, isActive, newPassword, displayOrder } = req.body || {};
  
  // Allow displayOrder change for SuperAdmin, but prevent other changes
  if (target.role === 'SuperAdmin') {
    // Only allow displayOrder to be updated
    if ('displayOrder' in req.body) {
      target.displayOrder = parseInt(displayOrder) || 0;
      await target.save();
      const { password: _, ...safe } = target.toObject();
      console.log('SuperAdmin displayOrder updated successfully to:', target.displayOrder);
      return res.json({ user: safe });
    }
    // If displayOrder not in request, reject
    console.log('SuperAdmin update rejected - displayOrder not in request body');
    console.log('Request body keys:', Object.keys(req.body));
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot modify Super Admin - only displayOrder can be changed' });
  }

  if (email) target.email = email;
  if (name) target.name = name;
  if (role) {
    if (role === 'SuperAdmin') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot set role Super Admin' });
    }
    target.role = role;
  }
  if (department !== undefined) target.department = department;
  if (designation !== undefined) target.designation = designation;
  if (avatar !== undefined) target.avatar = avatar;
  if (phone !== undefined) target.phone = phone;
  if (displayOrder !== undefined) target.displayOrder = displayOrder;
  if (typeof isActive === 'boolean') target.isActive = isActive;
  if (newPassword) target.password = await hashPassword(newPassword);

  await target.save();
  const { password: _, ...safe } = target.toObject();
  return res.json({ user: safe });
});

/**
 * Delete employee
 * Admin only — cannot delete SuperAdmin
 */
router.delete('/:id', requireAuth, authorize(['Admin']), async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
  if (target.role === 'SuperAdmin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot delete Super Admin' });
  }
  await target.deleteOne();
  return res.json({ ok: true });
});

/**
 * Reorder employees (update display order)
 * Admin only — update display order for custom employee hierarchy
 */
router.put('/reorder', requireAuth, authorize(['Admin']), async (req, res) => {
  const { orders } = req.body || {}; // Array of { id, displayOrder }
  if (!Array.isArray(orders)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'orders must be an array' });
  }

  try {
    // Update display order for each user
    const updates = orders.map(({ id, displayOrder }) => 
      User.findByIdAndUpdate(id, { displayOrder }, { new: false })
    );
    await Promise.all(updates);
    
    return res.json({ ok: true, message: 'Display order updated successfully' });
  } catch (error) {
    return res.status(500).json({ code: 'UPDATE_FAILED', message: error.message });
  }
});

export default router;
