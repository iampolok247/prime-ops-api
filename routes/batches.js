import express from 'express';
import Batch from '../models/Batch.js';
import Lead from '../models/Lead.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logActivity } from './activities.js';

const router = express.Router();

const genBatchId = async () => {
  const y = new Date().getFullYear();
  const count = await Batch.countDocuments({ batchId: new RegExp(`^BATCH-${y}-`) });
  const n = (count + 1).toString().padStart(4, '0');
  return `BATCH-${y}-${n}`;
};

// Create batch (Admin, SuperAdmin only)
router.post('/', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { batchName, category, targetedStudent, status } = req.body;
    
    if (!batchName || !category || !targetedStudent) {
      return res.status(400).json({ 
        code: 'VALIDATION_ERROR', 
        message: 'batchName, category, and targetedStudent are required' 
      });
    }

    const batch = await Batch.create({
      batchId: await genBatchId(),
      batchName,
      category,
      targetedStudent: Number(targetedStudent),
      status: status || 'Active',
      createdBy: req.user.id
    });

    const populated = await Batch.findById(batch._id).populate('createdBy', 'name email role');
    
    // Log activity
    await logActivity(
      req.user.id,
      req.user.name,
      req.user.email,
      req.user.role,
      'CREATE',
      'Batch',
      batchName,
      `Created batch: ${batchName} (${category})`
    );
    
    return res.status(201).json({ batch: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// List all batches (Admin, SuperAdmin, Admission)
router.get('/', requireAuth, authorize(['Admin', 'SuperAdmin', 'Admission', 'ITAdmin']), async (req, res) => {
  try {
    const { status, category } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (category) query.category = category;

    const batches = await Batch.find(query)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email role')
      .populate({
        path: 'admittedStudents.lead',
        select: 'leadId name phone email interestedCourse'
      });

    return res.json({ batches });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Get single batch with full details
router.get('/:id', requireAuth, authorize(['Admin', 'SuperAdmin', 'Admission', 'ITAdmin']), async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id)
      .populate('createdBy', 'name email role')
      .populate({
        path: 'admittedStudents.lead',
        select: 'leadId name phone email interestedCourse admittedAt status'
      });

    if (!batch) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
    }

    return res.json({ batch });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Update batch (Admin, SuperAdmin only)
router.patch('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { batchName, category, targetedStudent, status } = req.body;
    const batch = await Batch.findById(req.params.id);

    if (!batch) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
    }

    if (batchName) batch.batchName = batchName;
    if (category) batch.category = category;
    if (targetedStudent) batch.targetedStudent = Number(targetedStudent);
    if (status) batch.status = status;

    await batch.save();

    const populated = await Batch.findById(batch._id)
      .populate('createdBy', 'name email role')
      .populate({
        path: 'admittedStudents.lead',
        select: 'leadId name phone email interestedCourse'
      });

    // Log activity
    await logActivity(
      req.user.id,
      req.user.name,
      req.user.email,
      req.user.role,
      'UPDATE',
      'Batch',
      batch.batchName,
      `Updated batch: ${batch.batchName}`
    );

    return res.json({ batch: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Delete batch (Admin, SuperAdmin only)
router.delete('/:id', requireAuth, authorize(['Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id);

    if (!batch) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
    }

    // Check if batch has admitted students
    if (batch.admittedStudents && batch.admittedStudents.length > 0) {
      return res.status(400).json({ 
        code: 'BATCH_NOT_EMPTY', 
        message: 'Cannot delete batch with admitted students' 
      });
    }

    const batchName = batch.batchName;
    await Batch.findByIdAndDelete(req.params.id);
    
    // Log activity
    await logActivity(
      req.user.id,
      req.user.name,
      req.user.email,
      req.user.role,
      'DELETE',
      'Batch',
      batchName,
      `Deleted batch: ${batchName}`
    );
    
    return res.json({ ok: true, message: 'Batch deleted successfully' });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Add student to batch (used when admission team admits a lead)
router.post('/:id/add-student', requireAuth, authorize(['Admission', 'Admin', 'SuperAdmin']), async (req, res) => {
  try {
    const { leadId } = req.body;

    if (!leadId) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'leadId required' });
    }

    const batch = await Batch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Lead not found' });
    }

    // Check if student already in batch
    const alreadyAdmitted = batch.admittedStudents.some(
      s => s.lead.toString() === leadId
    );

    if (alreadyAdmitted) {
      return res.status(400).json({ 
        code: 'ALREADY_ADMITTED', 
        message: 'Student already in this batch' 
      });
    }

    // Add student to batch
    batch.admittedStudents.push({
      lead: leadId,
      admittedAt: new Date()
    });

    await batch.save();

    const populated = await Batch.findById(batch._id)
      .populate('createdBy', 'name email role')
      .populate({
        path: 'admittedStudents.lead',
        select: 'leadId name phone email interestedCourse'
      });

    return res.json({ batch: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

// Get batch report (list of admitted students)
router.get('/:id/report', requireAuth, authorize(['Admin', 'SuperAdmin', 'Admission', 'ITAdmin']), async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id)
      .populate('createdBy', 'name email role')
      .populate({
        path: 'admittedStudents.lead',
        select: 'leadId name phone email interestedCourse admittedAt status assignedTo',
        populate: {
          path: 'assignedTo',
          select: 'name email'
        }
      });

    if (!batch) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Batch not found' });
    }

    return res.json({ batch });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
