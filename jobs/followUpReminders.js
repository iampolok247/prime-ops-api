import MetaCrmLead from '../models/MetaCrmLead.js';
import { createNotification } from '../utils/notifications.js';

/**
 * #5 — Notify counsellors the morning a Meta CRM follow-up is due.
 * Runs daily (wired in server.js via node-cron).
 */
export async function runFollowUpDueReminders() {
  console.log('[Follow-Up Reminders] Checking leads due today…');

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const dueToday = await MetaCrmLead.find({
    status: 'In Follow Up',
    isDeleted: false,
    validationStatus: 'validated',
    assignedTo: { $ne: null },
    nextFollowUpDate: { $gte: todayStart, $lte: todayEnd }
  }).populate('assignedTo', 'name');

  for (const lead of dueToday) {
    if (!lead.assignedTo) continue;
    await createNotification({
      recipient: lead.assignedTo._id,
      type:      'TASK_ASSIGNED', // reuse existing enum value — closest semantic match
      title:     'Follow-up due today',
      message:   `${lead.name} (${lead.phone || lead.email || 'no contact'}) — follow-up scheduled for today`,
      link:      '/meta-crm/follow-up',
      relatedModel: null
    });
  }

  console.log(`[Follow-Up Reminders] ✅ Notified for ${dueToday.length} lead(s) due today`);
  return { notified: dueToday.length };
}
