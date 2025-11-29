import express from 'express';
import Task from '../models/Task.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

/**
 * Helpers
 */
const isSuperAdmin = (u) => u?.role === 'SuperAdmin';

/**
 * Assign Task (All authenticated users can create tasks)
 * Enhanced with new fields: priority, tags, multiple assignees, checklist, etc.
 */
router.post('/assign', requireAuth, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      assignedTo, // Can be single ID or array of IDs
      dueDate, 
      priority, 
      tags, 
      checklist,
      boardColumn 
    } = req.body || {};

    if (!title || !assignedTo) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'title and assignedTo are required' });
    }

    // Handle multiple assignees
    const assigneeIds = Array.isArray(assignedTo) ? assignedTo : [assignedTo];
    
    // Validate all assignees
    for (const userId of assigneeIds) {
      const toUser = await User.findById(userId);
      if (!toUser || !toUser.isActive) {
        return res.status(404).json({ code: 'USER_NOT_FOUND', message: `Assignee ${userId} not found` });
      }
      // No one can assign TO SuperAdmin
      if (isSuperAdmin(toUser)) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot assign task to Super Admin' });
      }
    }

    const task = await Task.create({
      title,
      description: description || '',
      assignedBy: req.user.id,
      assignedTo: assigneeIds,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      priority: priority || 'Medium',
      tags: tags || [],
      status: 'To Do',
      boardColumn: boardColumn || 'To Do',
      checklist: checklist || [],
      notificationsSent: { assigned: true } // Mark as sent
    });

    const populated = await Task.findById(task._id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role');
    
    return res.status(201).json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * List all tasks (accessible to all authenticated users)
 * Query:
 *  - status=InProgress|Completed (optional)
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, priority, tags, boardColumn } = req.query;
    const q = {};
    
    if (status) q.status = status;
    if (priority) q.priority = priority;
    if (tags) q.tags = { $in: tags.split(',') };
    if (boardColumn) q.boardColumn = boardColumn;

    const tasks = await Task.find(q)
      .sort({ boardPosition: 1, createdAt: -1 })
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .populate('comments.author', 'name email avatar')
      .populate('comments.mentions', 'name email')
      .populate('checklist.completedBy', 'name email');

    return res.json({ tasks });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * My Tasks (for all roles except SuperAdmin)
 * Query:
 *  - status=InProgress|Completed (optional)
 */
router.get('/my', requireAuth, async (req, res) => {
  try {
    // Super Admin has no "My Task" per product rule; but still allow viewing own tasks if any exists.
    const { status } = req.query;
    // Use $in operator to find tasks where user is in the assignedTo array
    const q = { assignedTo: { $in: [req.user.id] } };
    if (status && ['InProgress', 'Completed'].includes(status)) q.status = status;

    const tasks = await Task.find(q)
      .sort({ createdAt: -1 })
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role');

    return res.json({ tasks });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Create Self Task (My Task → Add My Task)
 * Everyone except SuperAdmin can self-create a task assigned to themselves.
 */
router.post('/self', requireAuth, async (req, res) => {
  try {
    // Block Super Admin from creating self tasks (product rule)
    if (req.user.role === 'SuperAdmin') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Super Admin has no self tasks' });
    }

    const { title, description, category, deadline } = req.body || {};
    if (!title || !deadline) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'title and deadline are required' });
    }

    const task = await Task.create({
      title,
      description: description || '',
      category: category || '',
      assignedBy: req.user.id,
      assignedTo: req.user.id,
      deadline: new Date(deadline),
      status: 'InProgress'
    });

    const populated = await Task.findById(task._id).populate('assignedBy', 'name email role').populate('assignedTo', 'name email role');
    return res.status(201).json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Update Task Status
 * Enhanced with notification marking for automation
 */
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    const validStatuses = ['To Do', 'In Progress', 'In Review', 'Completed'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid status' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });

    // Check if user is assignee
    const isAssignee = task.assignedTo.some(id => id.toString() === req.user.id);
    if (!isAssignee && req.user.role !== 'SuperAdmin' && req.user.role !== 'Admin') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only assignee or admin can change status' });
    }

    task.status = status;
    task.boardColumn = status;
    task.completedAt = status === 'Completed' ? new Date() : undefined;
    
    // Mark completion notification as sent when completed
    if (status === 'Completed') {
      task.notificationsSent.completed = true;
    }
    
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role');
    
    return res.json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Update Task (full update including priority, tags, etc.)
 * Only the person who assigned the task (assignedBy) can edit it
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });

    // Check permissions - only assignedBy user can edit
    const isAssigner = task.assignedBy.toString() === req.user.id;
    
    if (!isAssigner) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the person who assigned this task can edit it' });
    }

    const { title, description, priority, tags, dueDate, assignedTo, category } = req.body;
    
    if (title) task.title = title;
    if (description !== undefined) task.description = description;
    if (priority) task.priority = priority;
    if (tags) task.tags = tags;
    if (dueDate) task.dueDate = new Date(dueDate);
    if (category !== undefined) task.category = category;
    if (assignedTo) task.assignedTo = Array.isArray(assignedTo) ? assignedTo : [assignedTo];
    
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role');
    
    return res.json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Add Comment to Task
 */
router.post('/:id/comments', requireAuth, async (req, res) => {
  try {
    const { text, mentions } = req.body;
    if (!text) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Comment text required' });

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });

    task.comments.push({
      text,
      author: req.user.id,
      mentions: mentions || []
    });
    
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .populate('comments.author', 'name email avatar')
      .populate('comments.mentions', 'name email');
    
    return res.json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Add Attachment to Task
 */
router.post('/:id/attachments', requireAuth, async (req, res) => {
  try {
    const { name, url, type, size } = req.body;
    if (!name || !url) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Name and URL required' });

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });

    task.attachments.push({
      name,
      url,
      type: type || 'file',
      size,
      uploadedBy: req.user.id
    });
    
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role');
    
    return res.json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Update Checklist Item
 */
router.patch('/:id/checklist/:itemId', requireAuth, async (req, res) => {
  try {
    const { completed } = req.body;
    
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });

    const item = task.checklist.id(req.params.itemId);
    if (!item) return res.status(404).json({ code: 'NOT_FOUND', message: 'Checklist item not found' });

    item.completed = completed;
    if (completed) {
      item.completedAt = new Date();
      item.completedBy = req.user.id;
    } else {
      item.completedAt = undefined;
      item.completedBy = undefined;
    }
    
    await task.save();

    const populated = await Task.findById(task._id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role')
      .populate('checklist.completedBy', 'name email');
    
    return res.json({ task: populated });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

/**
 * Update Kanban Board Position (drag & drop)
 */
router.patch('/:id/board-position', requireAuth, async (req, res) => {
  try {
    const { boardColumn, boardPosition } = req.body;
    
    console.log('[BOARD-POSITION] Moving task:', req.params.id, 'to column:', boardColumn, 'position:', boardPosition);
    
    const task = await Task.findById(req.params.id);
    if (!task) {
      console.log('[BOARD-POSITION] Task not found:', req.params.id);
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    console.log('[BOARD-POSITION] Current task state:', {
      id: task._id,
      boardColumn: task.boardColumn,
      status: task.status,
      assignedTo: task.assignedTo
    });

    // Prepare update - only update the fields we need
    const updateData = {};
    
    if (boardColumn) {
      updateData.boardColumn = boardColumn;
      
      // Map boardColumn to status enum
      const columnToStatus = {
        'Backlog': 'To Do',
        'To Do': 'To Do',
        'In Progress': 'In Progress',
        'In Review': 'In Review',
        'Completed': 'Completed'
      };
      
      updateData.status = columnToStatus[boardColumn] || 'To Do';
      
      if (boardColumn === 'Completed' && !task.completedAt) {
        updateData.completedAt = new Date();
      }
      
      console.log('[BOARD-POSITION] Will update to:', updateData);
    }
    
    if (boardPosition !== undefined) {
      updateData.boardPosition = boardPosition;
    }
    
    // Use updateOne to avoid validation issues and populate after
    await Task.updateOne(
      { _id: req.params.id },
      { $set: updateData }
    );
    
    console.log('[BOARD-POSITION] Update successful, fetching updated task');
    
    const updatedTask = await Task.findById(req.params.id)
      .populate('assignedBy', 'name email role')
      .populate('assignedTo', 'name email role');
    
    console.log('[BOARD-POSITION] Returning updated task');
    return res.json({ task: updatedTask });
  } catch (e) {
    console.error('[BOARD-POSITION] Error moving task:', e.message);
    console.error('[BOARD-POSITION] Error stack:', e.stack);
    return res.status(500).json({ 
      code: 'SERVER_ERROR', 
      message: e.message,
      stack: e.stack
    });
  }
});

/**
 * Delete Task
 * Only the person who assigned the task (assignedBy) can delete it
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND', message: 'Task not found' });

    // Check permissions - only assignedBy user can delete
    const isAssigner = task.assignedBy.toString() === req.user.id;
    
    if (!isAssigner) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Only the person who assigned this task can delete it' });
    }

    await task.deleteOne();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
  }
});

export default router;
