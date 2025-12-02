import mongoose from 'mongoose';
import Lead from './models/Lead.js';

mongoose.connect('mongodb://localhost:27017/prime_ops')
  .then(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log('Today range:', { start: today.toISOString(), end: tomorrow.toISOString() });
    
    const leads = await Lead.find({
      assignedTo: { $exists: true },
      $or: [
        { counselingAt: { $gte: today, $lt: tomorrow } },
        { 'followUps.at': { $gte: today, $lt: tomorrow } }
      ]
    }).select('leadId name counselingAt followUps');

    console.log(`Found ${leads.length} leads with today's counseling or follow-ups`);
    leads.slice(0, 3).forEach(l => {
      console.log('\nLead:', l.leadId, l.name);
      console.log('  counselingAt:', l.counselingAt);
      console.log('  followUps:', l.followUps.map(f => ({ at: f.at, note: f.note.substring(0, 30) })));
    });

    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
