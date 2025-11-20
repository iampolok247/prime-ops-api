import express from 'express';
import AdmissionTarget from '../models/AdmissionTarget.js';
import AdmissionFee from '../models/AdmissionFee.js';
import Course from '../models/Course.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

/**
 * Set or Update Admission Target for a course/month
 * POST /api/admission-targets
 * Body: { courseId, month, target }
 * Auth: Admin, SuperAdmin only
 */
router.post('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { courseId, month, target } = req.body;

    if (!courseId || !month || target === undefined) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'courseId, month, and target are required' 
      });
    }

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'month must be in YYYY-MM format (e.g., 2025-11)' 
      });
    }

    // Check if course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Course not found' });
    }

    // Update or create target
    const admissionTarget = await AdmissionTarget.findOneAndUpdate(
      { course: courseId, month },
      { course: courseId, month, target, setBy: req.user.id },
      { new: true, upsert: true }
    ).populate('course', 'name courseId');

    return res.json({ target: admissionTarget });
  } catch (e) {
    console.error('Set admission target error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Get Admission Targets with Achievement Status
 * GET /api/admission-targets?month=2025-11
 * Auth: Admin, SuperAdmin
 */
router.get('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'month parameter is required (format: YYYY-MM)' 
      });
    }

    // Get all targets for the month
    const targets = await AdmissionTarget.find({ month })
      .populate('course', 'name courseId')
      .populate('setBy', 'name');

    // Calculate achievements for each target
    const Lead = (await import('../models/Lead.js')).default;
    
    const targetsWithAchievement = await Promise.all(
      targets.map(async (target) => {
        // Count admitted students for this course in this month
        const startDate = new Date(`${month}-01`);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);

        // Count leads admitted to this course in this month
        const achieved = await Lead.countDocuments({
          admittedToCourse: target.course._id,
          status: 'Admitted',
          admittedAt: { $gte: startDate, $lt: endDate }
        });

        return {
          _id: target._id,
          course: target.course,
          month: target.month,
          target: target.target,
          achieved,
          percentage: target.target > 0 ? Math.round((achieved / target.target) * 100) : 0,
          setBy: target.setBy,
          createdAt: target.createdAt,
          updatedAt: target.updatedAt
        };
      })
    );

    return res.json({ targets: targetsWithAchievement });
  } catch (e) {
    console.error('Get admission targets error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Get All Targets (all months, all courses)
 * GET /api/admission-targets/all
 * Auth: Admin, SuperAdmin
 */
router.get('/all', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const targets = await AdmissionTarget.find()
      .populate('course', 'name courseId')
      .populate('setBy', 'name')
      .sort({ month: -1, 'course.name': 1 });

    return res.json({ targets });
  } catch (e) {
    console.error('Get all admission targets error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Delete Admission Target
 * DELETE /api/admission-targets/:id
 * Auth: Admin, SuperAdmin only
 */
router.delete('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const target = await AdmissionTarget.findByIdAndDelete(req.params.id);
    
    if (!target) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Target not found' });
    }

    return res.json({ message: 'Target deleted successfully' });
  } catch (e) {
    console.error('Delete admission target error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
