import express from 'express';
import Target from '../models/Target.js';
import Course from '../models/Course.js';
import Lead from '../models/Lead.js';
import AdmissionFee from '../models/AdmissionFee.js';
import RecruitmentCandidate from '../models/RecruitmentCandidate.js';
import RecruitmentIncome from '../models/RecruitmentIncome.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

/**
 * Set or Update Target
 * POST /api/targets
 * Body: { targetType, month, targetValue, courseId?, assignedTo?, note? }
 * Auth: Admin, SuperAdmin only
 */
router.post('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { targetType, month, targetValue, courseId, assignedTo, note } = req.body;

    // Validation
    if (!targetType || !month || targetValue === undefined) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'targetType, month, and targetValue are required'
      });
    }

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'month must be in YYYY-MM format (e.g., 2025-01)'
      });
    }

    // Validate targetType
    const validTypes = ['AdmissionStudent', 'AdmissionRevenue', 'RecruitmentCandidate', 'RecruitmentRevenue'];
    if (!validTypes.includes(targetType)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Invalid targetType. Must be one of: ' + validTypes.join(', ')
      });
    }

    // For AdmissionStudent targets, course is required
    if (targetType === 'AdmissionStudent' && !courseId) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'courseId is required for AdmissionStudent targets'
      });
    }

    // Validate course if provided
    if (courseId) {
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Course not found' });
      }
    }

    // Validate assignedTo if provided
    if (assignedTo) {
      const user = await User.findById(assignedTo);
      if (!user) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
      }
    }

    // Build query for upsert
    const query = {
      targetType,
      month,
      ...(courseId && { course: courseId }),
      ...(assignedTo && { assignedTo })
    };

    // Update or create target
    const target = await Target.findOneAndUpdate(
      query,
      {
        ...query,
        targetValue,
        setBy: req.user.id,
        ...(note && { note })
      },
      { new: true, upsert: true }
    )
      .populate('course', 'name courseId')
      .populate('assignedTo', 'name email role')
      .populate('setBy', 'name email');

    return res.json({ target });
  } catch (e) {
    console.error('Set target error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Get Targets with Achievement Status
 * GET /api/targets?targetType=AdmissionStudent&month=2025-01&assignedTo=userId
 * Auth: Admin, SuperAdmin, Admission, Recruitment
 */
router.get('/', requireAuth, authorize(['Admin', 'SuperAdmin', 'Admission', 'Recruitment']), async (req, res) => {
  try {
    const { targetType, month, assignedTo } = req.query;

    if (!month) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'month parameter is required (format: YYYY-MM)'
      });
    }

    // Build query
    const query = { month };
    if (targetType) query.targetType = targetType;
    if (assignedTo) query.assignedTo = assignedTo;

    // Get targets
    const targets = await Target.find(query)
      .populate('course', 'name courseId')
      .populate('assignedTo', 'name email role')
      .populate('setBy', 'name email')
      .sort({ targetType: 1, 'course.name': 1 });

    // Calculate achievements
    // Parse month and create date range
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0)); // First day of next month
    
    // Get current date/time
    const now = new Date();
    
    // Cap endDate to current date/time if the month is current or future
    const effectiveEndDate = endDate > now ? now : endDate;
    
    // Check if the month is entirely in the future (start of month is after today)
    const isFutureMonth = startDate > now;
    
    // Debug logging
    console.log(`[Targets] Month: ${month}, Start: ${startDate.toISOString()}, End: ${endDate.toISOString()}, Now: ${now.toISOString()}, Effective: ${effectiveEndDate.toISOString()}, IsFuture: ${isFutureMonth}`);

    const targetsWithAchievement = await Promise.all(
      targets.map(async (target) => {
        let achieved = 0;
        
        // Skip achievement calculation for future months
        if (isFutureMonth) {
          return {
            _id: target._id,
            targetType: target.targetType,
            course: target.course,
            month: target.month,
            targetValue: target.targetValue,
            achieved: 0,
            percentage: 0,
            assignedTo: target.assignedTo,
            setBy: target.setBy,
            note: target.note,
            createdAt: target.createdAt,
            updatedAt: target.updatedAt
          };
        }

        switch (target.targetType) {
          case 'AdmissionStudent':
            // Count admitted students for this course
            const studentQuery = {
              admittedToCourse: target.course?._id,
              status: 'Admitted',
              admittedAt: { $gte: startDate, $lt: effectiveEndDate }
            };
            if (target.assignedTo) {
              studentQuery.assignedTo = target.assignedTo._id;
            }
            console.log(`[Targets] AdmissionStudent query for course ${target.course?.name}:`, JSON.stringify(studentQuery));
            achieved = await Lead.countDocuments(studentQuery);
            console.log(`[Targets] Found ${achieved} students`);
            break;

          case 'AdmissionRevenue':
            // Sum approved admission fees
            const revenueQuery = {
              paymentDate: { $gte: startDate, $lt: effectiveEndDate },
              status: 'Approved'
            };
            if (target.assignedTo) {
              revenueQuery.submittedBy = target.assignedTo._id;
            }
            const fees = await AdmissionFee.aggregate([
              { $match: revenueQuery },
              { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            achieved = fees[0]?.total || 0;
            break;

          case 'RecruitmentCandidate':
            // Count placed candidates
            const candidateQuery = {
              status: 'Placed',
              placementDate: { $gte: startDate, $lt: effectiveEndDate }
            };
            if (target.assignedTo) {
              candidateQuery.assignedTo = target.assignedTo._id;
            }
            achieved = await RecruitmentCandidate.countDocuments(candidateQuery);
            break;

          case 'RecruitmentRevenue':
            // Sum recruitment income
            const incomeQuery = {
              date: { $gte: startDate, $lt: effectiveEndDate }
            };
            if (target.assignedTo) {
              incomeQuery.receivedBy = target.assignedTo._id;
            }
            const incomes = await RecruitmentIncome.aggregate([
              { $match: incomeQuery },
              { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            achieved = incomes[0]?.total || 0;
            break;
        }

        const percentage = target.targetValue > 0 ? Math.round((achieved / target.targetValue) * 100) : 0;

        return {
          _id: target._id,
          targetType: target.targetType,
          course: target.course,
          month: target.month,
          targetValue: target.targetValue,
          achieved,
          percentage,
          assignedTo: target.assignedTo,
          setBy: target.setBy,
          note: target.note,
          createdAt: target.createdAt,
          updatedAt: target.updatedAt
        };
      })
    );

    return res.json({ targets: targetsWithAchievement });
  } catch (e) {
    console.error('Get targets error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Get All Targets (all months, all types)
 * GET /api/targets/all
 * Auth: Admin, SuperAdmin
 */
router.get('/all', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const targets = await Target.find()
      .populate('course', 'name courseId')
      .populate('assignedTo', 'name email role')
      .populate('setBy', 'name email')
      .sort({ month: -1, targetType: 1 });

    return res.json({ targets });
  } catch (e) {
    console.error('Get all targets error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Delete Target
 * DELETE /api/targets/:id
 * Auth: Admin, SuperAdmin only
 */
router.delete('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const target = await Target.findByIdAndDelete(req.params.id);

    if (!target) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Target not found' });
    }

    return res.json({ message: 'Target deleted successfully' });
  } catch (e) {
    console.error('Delete target error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Get Team Members by Role
 * GET /api/targets/team-members?role=Admission
 * Auth: Admin, SuperAdmin
 */
router.get('/team-members', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { role } = req.query;
    
    const query = { isActive: true };
    if (role) {
      query.role = role;
    }

    const members = await User.find(query)
      .select('name email role')
      .sort({ name: 1 });

    return res.json({ members });
  } catch (e) {
    console.error('Get team members error:', e);
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
