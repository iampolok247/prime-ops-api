import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { authorize } from "../middleware/authorize.js";
import DMExpense from "../models/DMExpense.js";
import DMCampaign from "../models/DMCampaign.js";
import SocialMetrics from "../models/SocialMetrics.js";
import SEOWork from "../models/SEOWork.js";
import DMDailyChecklist from "../models/DMDailyChecklist.js";

const router = express.Router();

/** -------- Expense (DM only) -------- */
router.get(
  "/expense",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    const items = await DMExpense.find().sort({ date: -1 });
    return res.json({ items });
  }
);

router.post(
  "/expense",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const { date, purpose, amount } = req.body || {};
    if (!date || !purpose || amount === undefined) {
      return res
        .status(400)
        .json({
          code: "VALIDATION_ERROR",
          message: "date, purpose, amount required",
        });
    }
    const item = await DMExpense.create({
      date: new Date(date),
      purpose,
      amount: Number(amount),
      addedBy: req.user.id,
    });
    return res.status(201).json({ item });
  }
);

router.delete(
  "/expense/:id",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const it = await DMExpense.findById(req.params.id);
    if (!it)
      return res
        .status(404)
        .json({ code: "NOT_FOUND", message: "Expense not found" });
    await it.deleteOne();
    return res.json({ ok: true });
  }
);

/** -------- Social metrics (DM only write; SA/Admin read) -------- */
router.get(
  "/social",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    const latest = await SocialMetrics.findOne().sort({ updatedAt: -1 });
    return res.json({
      metrics: latest?.metrics || {},
      updatedAt: latest?.updatedAt || null,
    });
  }
);

router.put(
  "/social",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const payload = req.body?.metrics || {};
    const doc = await SocialMetrics.create({
      metrics: payload,
      updatedBy: req.user.id,
    });
    return res.json({ metrics: doc.metrics, updatedAt: doc.updatedAt });
  }
);

/** -------- SEO reports (DM only write; SA/Admin read) -------- */
router.get(
  "/seo",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    const items = await SEOWork.find().sort({ date: -1 });
    return res.json({ items });
  }
);

router.post(
  "/seo",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    const { date, typeOfWork, challenge, details } = req.body || {};
    if (!date || !typeOfWork)
      return res
        .status(400)
        .json({
          code: "VALIDATION_ERROR",
          message: "date and typeOfWork required",
        });
    const it = await SEOWork.create({
      date: new Date(date),
      typeOfWork,
      challenge: challenge || "",
      details: details || "",
      addedBy: req.user.id,
    });
    return res.status(201).json({ item: it });
  }
);

/** -------- DM Campaigns (Meta Ads / LinkedIn Ads) -------- */

// List campaigns (filter by platform and date range)
router.get(
  "/campaigns",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    try {
      const { platform, from, to } = req.query;
      const q = {};
      if (platform && ['Meta Ads', 'LinkedIn Ads'].includes(platform)) {
        q.platform = platform;
      }
      if (from || to) {
        q.campaignDate = {};
        if (from) q.campaignDate.$gte = new Date(from);
        if (to) {
          const toDate = new Date(to);
          toDate.setHours(23, 59, 59, 999);
          q.campaignDate.$lte = toDate;
        }
      }
      const campaigns = await DMCampaign.find(q)
        .populate('createdBy', 'name email')
        .sort({ campaignDate: -1 });
      return res.json({ campaigns });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// Create campaign
router.post(
  "/campaigns",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    try {
      const { campaignName, platform, boostType, currency, cost, leads, postEngagements, thruPlays, impressions, reach, notes, campaignDate } = req.body || {};
      
      if (!campaignName || !platform || !boostType || cost === undefined) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'campaignName, platform, boostType, cost required' 
        });
      }

      const campaign = await DMCampaign.create({
        campaignName,
        platform,
        boostType,
        currency: currency || 'BDT',
        cost: Number(cost),
        leads: Number(leads) || 0,
        postEngagements: Number(postEngagements) || 0,
        thruPlays: Number(thruPlays) || 0,
        impressions: Number(impressions) || 0,
        reach: Number(reach) || 0,
        notes: notes || '',
        campaignDate: campaignDate ? new Date(campaignDate) : new Date(),
        createdBy: req.user.id
      });

      const populated = await DMCampaign.findById(campaign._id).populate('createdBy', 'name email');
      return res.status(201).json({ campaign: populated });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// Update campaign
router.patch(
  "/campaigns/:id",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    try {
      const { campaignName, platform, boostType, currency, cost, leads, postEngagements, thruPlays, impressions, reach, notes, campaignDate } = req.body || {};
      
      const campaign = await DMCampaign.findById(req.params.id);
      if (!campaign) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
      }

      if (campaignName !== undefined) campaign.campaignName = campaignName;
      if (platform !== undefined) campaign.platform = platform;
      if (boostType !== undefined) campaign.boostType = boostType;
      if (currency !== undefined) campaign.currency = currency;
      if (cost !== undefined) campaign.cost = Number(cost);
      if (leads !== undefined) campaign.leads = Number(leads);
      if (postEngagements !== undefined) campaign.postEngagements = Number(postEngagements);
      if (thruPlays !== undefined) campaign.thruPlays = Number(thruPlays);
      if (impressions !== undefined) campaign.impressions = Number(impressions);
      if (reach !== undefined) campaign.reach = Number(reach);
      if (notes !== undefined) campaign.notes = notes;
      if (campaignDate !== undefined) campaign.campaignDate = new Date(campaignDate);

      await campaign.save();
      const populated = await DMCampaign.findById(campaign._id).populate('createdBy', 'name email');
      return res.json({ campaign: populated });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// Delete campaign
router.delete(
  "/campaigns/:id",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    try {
      const campaign = await DMCampaign.findByIdAndDelete(req.params.id);
      if (!campaign) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Campaign not found' });
      }
      return res.json({ message: 'Campaign deleted', campaign });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// Get campaigns summary metrics
router.get(
  "/campaigns/summary/metrics",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    try {
      const { platform, from, to } = req.query;
      const q = {};
      if (platform && ['Meta Ads', 'LinkedIn Ads'].includes(platform)) {
        q.platform = platform;
      }
      if (from || to) {
        q.campaignDate = {};
        if (from) q.campaignDate.$gte = new Date(from);
        if (to) {
          const toDate = new Date(to);
          toDate.setHours(23, 59, 59, 999);
          q.campaignDate.$lte = toDate;
        }
      }

      const campaigns = await DMCampaign.find(q);
      
      const summary = {
        totalCampaigns: campaigns.length,
        totalCost: campaigns.reduce((sum, c) => sum + c.cost, 0),
        totalLeads: campaigns.reduce((sum, c) => sum + c.leads, 0),
        totalEngagements: campaigns.reduce((sum, c) => sum + c.postEngagements, 0),
        totalThruPlays: campaigns.reduce((sum, c) => sum + c.thruPlays, 0),
        totalImpressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
        totalReach: campaigns.reduce((sum, c) => sum + c.reach, 0),
        avgCostPerLead: 0,
        avgCostPerEngagement: 0
      };

      if (summary.totalLeads > 0) {
        summary.avgCostPerLead = (summary.totalCost / summary.totalLeads).toFixed(2);
      }
      if (summary.totalEngagements > 0) {
        summary.avgCostPerEngagement = (summary.totalCost / summary.totalEngagements).toFixed(2);
      }

      return res.json({ summary });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

/** -------- Dashboard Summary (for HeadOfCreative) -------- */
router.get(
  "/dashboard",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin", "HeadOfCreative"]),
  async (req, res) => {
    try {
      const { from, to } = req.query;
      const Lead = (await import('../models/Lead.js')).default;
      
      let dateFilter = {};
      if (from || to) {
        dateFilter.createdAt = {};
        if (from) dateFilter.createdAt.$gte = new Date(from);
        if (to) {
          const endDate = new Date(to);
          endDate.setHours(23, 59, 59, 999);
          dateFilter.createdAt.$lte = endDate;
        }
      }
      
      const [totalLeads, metaLeads, linkedinLeads, manualLeads, totalExpense] = await Promise.all([
        Lead.countDocuments(dateFilter),
        Lead.countDocuments({ ...dateFilter, source: 'Meta' }),
        Lead.countDocuments({ ...dateFilter, source: 'LinkedIn' }),
        Lead.countDocuments({ ...dateFilter, source: 'Manual' }),
        DMExpense.aggregate([
          ...(from || to ? [{ $match: {
            date: {
              ...(from && { $gte: new Date(from) }),
              ...(to && { $lte: new Date(to) })
            }
          }}] : []),
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]).then(r => r[0]?.total || 0)
      ]);
      
      return res.json({
        totalLeads,
        metaLeads,
        linkedinLeads,
        manualLeads,
        totalExpense
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

/** -------- Daily Checklist Routes -------- */

// GET today's checklist for current user
router.get(
  "/daily-checklist",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin"]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      
      // Allow force reset via query parameter
      if (req.query.reset === 'true') {
        const today = new Date().toISOString().split('T')[0];
        await DMDailyChecklist.deleteMany({ userId, date: today });
        console.log('🔄 Force reset checklist for user:', userId);
      }
      
      const checklist = await DMDailyChecklist.getOrCreateToday(userId);
      const completionPercentage = checklist.getCompletionPercentage();
      
      console.log('📋 Checklist items count:', checklist.items.length);
      
      return res.json({ 
        checklist,
        completionPercentage
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// POST - Mark a task as complete with comment
router.post(
  "/daily-checklist/complete",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    try {
      const { taskIndex, comment } = req.body;
      
      if (taskIndex === undefined) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'taskIndex is required' 
        });
      }
      
      const userId = req.user.id;
      const checklist = await DMDailyChecklist.getOrCreateToday(userId);
      
      await checklist.completeTask(taskIndex, comment || '');
      
      const completionPercentage = checklist.getCompletionPercentage();
      
      return res.json({ 
        checklist,
        completionPercentage
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// POST - Add new task
router.post(
  "/daily-checklist/add",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    try {
      const { task, category } = req.body;
      
      if (!task) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'task is required' 
        });
      }
      
      const userId = req.user.id;
      const checklist = await DMDailyChecklist.getOrCreateToday(userId);
      
      const newTask = {
        task,
        category: category || 'General',
        order: checklist.items.length,
        createdAt: new Date()
      };
      
      checklist.items.push(newTask);
      await checklist.save();
      
      const completionPercentage = checklist.getCompletionPercentage();
      
      return res.json({ 
        checklist,
        completionPercentage
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// PUT - Edit existing task
router.put(
  "/daily-checklist/edit/:taskIndex",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    try {
      const taskIndex = parseInt(req.params.taskIndex);
      const { task, category } = req.body;
      
      if (!task) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'task is required' 
        });
      }
      
      const userId = req.user.id;
      const checklist = await DMDailyChecklist.getOrCreateToday(userId);
      
      if (taskIndex < 0 || taskIndex >= checklist.items.length) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'Invalid task index' 
        });
      }
      
      checklist.items[taskIndex].task = task;
      if (category) {
        checklist.items[taskIndex].category = category;
      }
      
      await checklist.save();
      
      const completionPercentage = checklist.getCompletionPercentage();
      
      return res.json({ 
        checklist,
        completionPercentage
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// DELETE - Delete a task
router.delete(
  "/daily-checklist/delete/:taskIndex",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    try {
      const taskIndex = parseInt(req.params.taskIndex);
      
      const userId = req.user.id;
      const checklist = await DMDailyChecklist.getOrCreateToday(userId);
      
      if (taskIndex < 0 || taskIndex >= checklist.items.length) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'Invalid task index' 
        });
      }
      
      checklist.items.splice(taskIndex, 1);
      await checklist.save();
      
      const completionPercentage = checklist.getCompletionPercentage();
      
      return res.json({ 
        checklist,
        completionPercentage
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// POST - Toggle (for backward compatibility)
router.post(
  "/daily-checklist/toggle",
  requireAuth,
  authorize(["DigitalMarketing"]),
  async (req, res) => {
    try {
      const { taskIndex, completed } = req.body;
      
      if (taskIndex === undefined) {
        return res.status(400).json({ 
          code: 'VALIDATION_ERROR', 
          message: 'taskIndex is required' 
        });
      }
      
      const userId = req.user.id;
      const checklist = await DMDailyChecklist.getOrCreateToday(userId);
      
      if (completed) {
        await checklist.completeTask(taskIndex);
      } else {
        await checklist.uncompleteTask(taskIndex);
      }
      
      const completionPercentage = checklist.getCompletionPercentage();
      
      return res.json({ 
        checklist,
        completionPercentage
      });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

// GET checklist reports/history
router.get(
  "/daily-checklist/reports",
  requireAuth,
  authorize(["DigitalMarketing", "Admin", "SuperAdmin"]),
  async (req, res) => {
    try {
      const { from, to, userId: queryUserId } = req.query;
      const isAdminOrSuper = ['Admin', 'SuperAdmin'].includes(req.user.role);
      
      // Build query
      const query = {};
      
      // If admin/superadmin can query any user, otherwise only own data
      if (queryUserId && isAdminOrSuper) {
        query.userId = queryUserId;
      } else {
        query.userId = req.user.id;
      }
      
      // Date range filter
      if (from || to) {
        query.date = {};
        if (from) query.date.$gte = from;
        if (to) query.date.$lte = to;
      }
      
      const checklists = await DMDailyChecklist
        .find(query)
        .populate('userId', 'name email')
        .sort({ date: -1 })
        .limit(90); // Last 90 days max
      
      // Calculate stats
      const stats = checklists.map(checklist => {
        const totalTasks = checklist.items.length;
        const completedTasks = checklist.items.filter(item => item.completed).length;
        const completionPercentage = totalTasks > 0 
          ? Math.round((completedTasks / totalTasks) * 100) 
          : 0;
        
        return {
          date: checklist.date,
          user: checklist.userId,
          totalTasks,
          completedTasks,
          incompleteTasks: totalTasks - completedTasks,
          completionPercentage,
          items: checklist.items
        };
      });
      
      return res.json({ reports: stats });
    } catch (e) {
      return res.status(500).json({ code: 'SERVER_ERROR', message: e.message });
    }
  }
);

export default router;
