import express from 'express';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { hashPassword } from '../utils/hash.js';
import { logActivity } from './activities.js';

const router = express.Router();

/**
 * List all employees
 * All authenticated users can view user list (for task assignment)
 * Excludes ITAdmin from employee lists
 */
router.get('/', requireAuth, async (req, res) => {
  const users = await User.find({ role: { $ne: 'ITAdmin' } }).select('-password');
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
 * Admin and SuperAdmin can create users
 * Only SuperAdmin can create SuperAdmin accounts
 */
router.post('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  const { name, email, password, role, department, designation, avatar, phone, displayOrder } = req.body || {};
  
  // Only SuperAdmin can create SuperAdmin accounts
  if (role === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Only SuperAdmin can create SuperAdmin accounts' });
  }
  
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ code: 'EMAIL_EXISTS', message: 'Email already in use' });

  const hashed = await hashPassword(password || 'password123');
  const user = await User.create({
    name, email, password: hashed, role, department, designation, avatar, phone, displayOrder: displayOrder || 0
  });
  const { password: _, ...safe } = user.toObject();
  console.log(`[CREATE USER] Successfully created user: ${user.name}`);
  
  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'CREATE',
    'User',
    name,
    `Created user account: ${name} (${role})`
  );
  
  return res.status(201).json({ user: safe });
});

/**
 * Update employee
 * Admin and SuperAdmin can modify users
 * SuperAdmin can modify anyone including other SuperAdmins
 * Admin cannot modify SuperAdmin
 */
router.put('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  console.log(`[UPDATE USER] ID: ${req.params.id}, Body:`, JSON.stringify(req.body));
  console.log(`[UPDATE USER] Request User Role: ${req.user.role}, User ID: ${req.user.id}`);
  
  const target = await User.findById(req.params.id).select('+password');
  if (!target) return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
  console.log(`[UPDATE USER] Target User Role: ${target.role}, Target Name: ${target.name}`);
  
  const { name, email, role, department, designation, avatar, phone, isActive, newPassword, displayOrder } = req.body || {};
  
  // Only SuperAdmin can modify another SuperAdmin
  if (target.role === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Only SuperAdmin can modify SuperAdmin accounts' });
  }

  // Only SuperAdmin can promote someone to SuperAdmin
  if (role === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Only SuperAdmin can create SuperAdmin accounts' });
  }

  // Update all fields
  if (email) target.email = email;
  if (name) target.name = name;
  if (role) target.role = role;
  if (department !== undefined) target.department = department;
  if (designation !== undefined) target.designation = designation;
  if (avatar !== undefined) target.avatar = avatar;
  if (phone !== undefined) target.phone = phone;
  if (displayOrder !== undefined) target.displayOrder = parseInt(displayOrder) || 0;
  if (typeof isActive === 'boolean') target.isActive = isActive;
  if (newPassword) target.password = await hashPassword(newPassword);

  await target.save();
  const { password: _, ...safe } = target.toObject();
  console.log(`[UPDATE USER] Successfully updated user: ${target.name}`);
  
  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'UPDATE',
    'User',
    target.name,
    `Updated user account: ${target.name} (${target.role})`
  );
  
  return res.json({ user: safe });
});

/**
 * Delete employee
 * Admin and SuperAdmin can delete users
 * SuperAdmin can delete anyone including other SuperAdmins
 * Admin cannot delete SuperAdmin
 */
router.delete('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
  
  // Only SuperAdmin can delete another SuperAdmin
  if (target.role === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Only SuperAdmin can delete SuperAdmin accounts' });
  }
  
  const userName = target.name;
  const userRole = target.role;
  await target.deleteOne();
  console.log(`[DELETE USER] Successfully deleted user: ${target.name}`);
  
  // Log activity
  await logActivity(
    req.user.id,
    req.user.name,
    req.user.email,
    req.user.role,
    'DELETE',
    'User',
    userName,
    `Deleted user account: ${userName} (${userRole})`
  );
  
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
