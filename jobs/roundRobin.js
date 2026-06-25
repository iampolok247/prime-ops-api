import MetaLead from '../models/MetaLead.js';
import User     from '../models/User.js';

/**
 * Distribute all validated + unassigned MetaLeads evenly across active Admission users.
 * Runs daily at 1 PM (wired in server.js via node-cron).
 * Can also be triggered manually via POST /api/meta-leads/round-robin/trigger.
 */
export async function runRoundRobinAssignment() {
  console.log('[Round Robin] Starting auto-assignment run…');

  // 1. Fetch unassigned, validated leads — oldest first for FIFO fairness
  const unassigned = await MetaLead.find({
    validationStatus: 'validated',
    assignedTo: null,
    isDeleted:  false
  }).sort({ createdAt: 1 }).lean();

  if (unassigned.length === 0) {
    console.log('[Round Robin] No unassigned leads — nothing to do');
    return { assigned: 0, counsellors: 0 };
  }

  // 2. Active Admission counsellors sorted by display order
  const counsellors = await User.find({
    role:     'Admission',
    isActive: true
  }).sort({ displayOrder: 1, name: 1 }).lean();

  if (counsellors.length === 0) {
    console.warn('[Round Robin] No active Admission users found');
    return { assigned: 0, counsellors: 0, skipped: unassigned.length };
  }

  // 3. Round-robin distribute
  const now = new Date();
  const bulkOps = unassigned.map((lead, i) => {
    const counsellor = counsellors[i % counsellors.length];
    return {
      updateOne: {
        filter: { _id: lead._id },
        update: {
          $set: {
            assignedTo:   counsellor._id,
            assignedAt:   now,
            autoAssigned: true,
            status:       'Assigned'
          }
        }
      }
    };
  });

  await MetaLead.bulkWrite(bulkOps);

  const summary = `[Round Robin] ✅ ${unassigned.length} leads distributed across ${counsellors.length} counsellors`;
  console.log(summary);

  return {
    assigned:   unassigned.length,
    counsellors: counsellors.length,
    distribution: counsellors.map((c, i) => ({
      name:  c.name,
      leads: unassigned.filter((_, j) => j % counsellors.length === i).length
    }))
  };
}
