import MetaLead from '../models/MetaLead.js';
import { createNotification } from '../utils/notifications.js';

/**
 * #5 — Notify counsellors the morning a follow-up is due.
 * Runs daily (wired in server.js via node-cron).
 */
export async function runFollowUpDueReminders() {
  console.log('[Follow-Up Reminders] Checking leads due today…');

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const dueToday = await MetaLead.find({
    status: 'In Follow Up',
    isDeleted: false,
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
      link:      '/meta-leads/queue',
      relatedModel: null
    });
  }

  console.log(`[Follow-Up Reminders] ✅ Notified for ${dueToday.length} lead(s) due today`);
  return { notified: dueToday.length };
}

/**
 * #7 — Flag stale follow-up leads for DM review.
 * A lead is "stale" if: status is "In Follow Up", has 6+ touchpoints,
 * and the oldest touchpoint was 60+ days ago. Does NOT auto-archive —
 * only flags (flaggedStale: true) so DM can review and decide manually.
 * Runs daily (wired in server.js via node-cron).
 */
export async function runStaleFollowUpFlagging() {
  console.log('[Stale Follow-Up] Scanning for stale leads…');

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const candidates = await MetaLead.find({
    status: 'In Follow Up',
    isDeleted: false,
    flaggedStale: false,
    $expr: { $gte: [{ $size: { $ifNull: ['$followUps', []] } }, 6] }
  }).select('followUps');

  const staleIds = candidates
    .filter(lead => {
      const first = lead.followUps[0];
      return first && new Date(first.at) <= sixtyDaysAgo;
    })
    .map(lead => lead._id);

  if (staleIds.length > 0) {
    await MetaLead.updateMany(
      { _id: { $in: staleIds } },
      { $set: { flaggedStale: true, flaggedStaleAt: new Date() } }
    );
  }

  console.log(`[Stale Follow-Up] ✅ Flagged ${staleIds.length} stale lead(s)`);
  return { flagged: staleIds.length };
}
