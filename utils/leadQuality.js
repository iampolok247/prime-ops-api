// Structured lead-quality feedback for Meta CRM leads.
//
// Counsellors (and DM at validation) pick a reason from a fixed list instead of
// free text, so it can be reported on and sent to Meta as a CRM stage:
//   BAD  → "Disqualified" stage — junk lead, negative signal for Meta's lead-quality optimisation
//   LOST → "Not Interested" stage — genuine lead that did not convert (quality was fine)
// Keep in sync with prime-ops-web/src/lib/leadQuality.js
export const BAD_LEAD_REASONS = [
  'Wrong / invalid number',
  'Fake / spam',
  'Did not fill the form',
  'Unreachable (5+ tries)',
  'Irrelevant / wrong course',
  'Duplicate lead',
];

export const LOST_LEAD_REASONS = [
  'Fee / budget issue',
  'Schedule / timing issue',
  'Location issue',
  'Joined elsewhere',
  'Just exploring',
  'Other',
];

export const ALL_LEAD_REASONS = [...BAD_LEAD_REASONS, ...LOST_LEAD_REASONS];

export const DISQUALIFIED_EVENT = 'Disqualified';
export const NOT_INTERESTED_EVENT = 'Not Interested';

export function qualityForReason(reason) {
  if (BAD_LEAD_REASONS.includes(reason)) return 'Bad';
  if (LOST_LEAD_REASONS.includes(reason)) return 'Lost';
  return null;
}
