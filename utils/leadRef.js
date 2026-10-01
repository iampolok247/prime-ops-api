// Shared "which lead collection?" helpers.
//
// Admission fees, batches, dues and activity logs can point at either a regular
// Lead or a Meta CRM lead (MetaCrmLead). Each of those documents carries a
// `leadModel` field; legacy documents created before the Meta CRM existed have
// no such field, so everything falls back to 'Lead'.
//
// `ref` is a function (not `refPath`) on purpose: Mongoose calls it with the
// (sub)document as the first argument, which also works for `.lean()` queries
// on legacy docs where `leadModel` is missing and schema defaults are not applied.
import mongoose from 'mongoose';
// Register both lead models so mongoose.model(name) lookups always resolve
import '../models/Lead.js';
import '../models/MetaCrmLead.js';

export const LEAD_MODELS = ['Lead', 'MetaCrmLead'];

export function leadRef(doc) {
  return (doc && doc.leadModel) || 'Lead';
}

export const leadModelField = { type: String, enum: LEAD_MODELS, default: 'Lead' };

// Resolve the Mongoose model for a lead-model name (defaults to Lead).
export function getLeadModel(name) {
  return mongoose.model(LEAD_MODELS.includes(name) ? name : 'Lead');
}

// Find a lead by id in whichever collection holds it.
// Returns { lead, leadModel } or { lead: null }.
export async function findAnyLead(id, preferred = 'Lead') {
  const order = preferred === 'MetaCrmLead' ? ['MetaCrmLead', 'Lead'] : ['Lead', 'MetaCrmLead'];
  for (const name of order) {
    const lead = await mongoose.model(name).findById(id);
    if (lead) return { lead, leadModel: name };
  }
  return { lead: null, leadModel: null };
}
