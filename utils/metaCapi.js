import { createHash } from 'crypto';
import CapiEventLog from '../models/CapiEventLog.js';
import { DISQUALIFIED_EVENT, NOT_INTERESTED_EVENT } from './leadQuality.js';

// Meta Conversions API for CRM ("Conversion Leads" optimization).
//
// Meta matches each event back to the original ad lead by the Meta leadgen ID
// (user_data.lead_id), so only leads that came from a Meta lead form (have
// metaLeadId) are sent. Event names are our CRM stage names; event_time is when
// the lead actually entered that stage, not when the DM clicked "send".

const PIXEL_ID      = process.env.META_PIXEL_ID;   // CRM dataset ID connected to the Page's lead forms
const ACCESS_TOKEN  = process.env.META_ACCESS_TOKEN;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE; // optional: Events Manager → Test events

export const CRM_NAME = 'Prime OPS';

// Meta rejects events older than 7 days
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Pipeline status → CRM stage event name sent to Meta.
// 'Lead' (raw lead received) is queued by the webhook, not by a status change.
// Negative stages come from structured quality feedback (utils/leadQuality.js):
// 'Disqualified' (junk lead) and 'Not Interested' (genuine lead, not converted).
export const STATUS_EVENT_MAP = {
  Counseling:     'Counseling',
  'In Follow Up': 'Counseling', // Admission pipeline goes Assigned → In Follow Up when counseling starts
  Admitted:       'Admitted',
};
export const LEAD_RECEIVED_EVENT = 'Lead';
// Events that can be queued directly (not derived from a pipeline status)
const DIRECT_EVENTS = [LEAD_RECEIVED_EVENT, DISQUALIFIED_EVENT, NOT_INTERESTED_EVENT];

function sha256(value) {
  return createHash('sha256').update(String(value).trim()).digest('hex');
}

// Normalise Bangladeshi numbers to E.164 digits (8801XXXXXXXXX) before hashing
export function normalizePhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('01')) d = '88' + d;
  else if (d.length === 10 && d.startsWith('1')) d = '880' + d;
  return d;
}

/**
 * Queue a CRM stage event for a Meta CRM lead. DM reviews and sends from the
 * Meta CAPI Tracking page. Each stage is queued at most once per lead, so
 * reschedules, bulk moves or undo/redo of an admission never double-count.
 * `status` is a pipeline status or one of the direct events (Lead / Disqualified / Not Interested).
 * A lead ends in at most one negative stage: Disqualified wins over Not Interested.
 */
export async function queueCapiStageEvent(lead, status, userId) {
  try {
    const event = DIRECT_EVENTS.includes(status) ? status : STATUS_EVENT_MAP[status];
    if (!event || !lead?.metaLeadId) return null;

    if (event === DISQUALIFIED_EVENT || event === NOT_INTERESTED_EVENT) {
      const negative = await CapiEventLog.find({
        lead: lead._id, pipeline: 'crm', event: { $in: [DISQUALIFIED_EVENT, NOT_INTERESTED_EVENT] },
        sendStatus: { $in: ['pending', 'sent'] }
      });
      if (negative.some(n => n.event === event || n.event === DISQUALIFIED_EVENT)) return negative[0];
      // Upgrading Not Interested → Disqualified: drop the still-pending Not Interested event
      await CapiEventLog.deleteMany({ _id: { $in: negative.filter(n => n.sendStatus === 'pending').map(n => n._id) } });
    }

    const existing = await CapiEventLog.findOne({
      lead: lead._id, event, pipeline: 'crm', sendStatus: { $in: ['pending', 'sent'] }
    });
    if (existing) return existing;

    return await CapiEventLog.create({
      pipeline:      'crm',
      lead:          lead._id,
      leadDisplayId: lead.leadId,
      leadName:      lead.name,
      leadStatus:    status,
      event,
      eventTime:     status === LEAD_RECEIVED_EVENT ? (lead.createdAt || new Date()) : new Date(),
      queuedBy:      userId || undefined,
      sendStatus:    'pending'
    });
  } catch (e) {
    console.error('[Meta CAPI] Queue error:', e.message);
    return null;
  }
}

// Meta expects user_data.lead_id as a JSON number. Leadgen IDs can exceed
// Number.MAX_SAFE_INTEGER, so emit the digits verbatim instead of converting.
export function toMetaJson(payload) {
  return JSON.stringify(payload).replace(/"lead_id":"(\d{1,20})"/g, '"lead_id":$1');
}

export const isCapiConfigured = () => !!(PIXEL_ID && ACCESS_TOKEN);

/**
 * Send one CRM stage event to Meta. Returns { success, eventsReceived } or
 * { success: false, errorMessage, permanent }. `permanent` failures can never
 * succeed (no leadgen ID, too old); everything else is worth retrying.
 */
export async function sendMetaCapiEvent(lead, event, eventTime) {
  if (!isCapiConfigured()) {
    return { success: false, errorMessage: 'META_PIXEL_ID / META_ACCESS_TOKEN not set on the server' };
  }
  if (!lead.metaLeadId) {
    return { success: false, permanent: true, errorMessage: 'Lead has no Meta leadgen ID — Meta cannot match it' };
  }

  const at = eventTime ? new Date(eventTime) : new Date();
  if (Date.now() - at.getTime() > MAX_EVENT_AGE_MS) {
    return { success: false, permanent: true, errorMessage: 'Event is older than 7 days — Meta no longer accepts it' };
  }

  const userData = { lead_id: String(lead.metaLeadId) };
  if (lead.email) userData.em = [sha256(lead.email.toLowerCase())];
  const phone = normalizePhone(lead.phone);
  if (phone) userData.ph = [sha256(phone)];

  const payload = {
    data: [{
      event_name:    event,
      event_time:    Math.floor(at.getTime() / 1000),
      action_source: 'system_generated',
      user_data:     userData,
      custom_data: {
        event_source:      'crm',
        lead_event_source: CRM_NAME
      }
    }]
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    toMetaJson(payload)
    });
    const data = await res.json();

    if (res.ok) {
      console.log(`[Meta CAPI] ✅ ${event} sent for ${lead.leadId} — events_received: ${data.events_received}`);
      return { success: true, eventsReceived: data.events_received || 0 };
    }
    console.error(`[Meta CAPI] ❌ ${event} failed for ${lead.leadId}:`, data);
    return { success: false, errorMessage: data?.error?.message || JSON.stringify(data) };
  } catch (e) {
    console.error('[Meta CAPI] Error:', e.message);
    return { success: false, errorMessage: e.message };
  }
}

/**
 * Send queued CRM events. Used by the DM "Send" buttons and the nightly job.
 * A failed send stays 'pending' (with the error and attempt count) and is
 * retried next time — so a missing token, a permission problem or a Meta
 * outage never loses events. It only becomes 'failed' when it can never
 * succeed: lead gone, no leadgen ID, or older than Meta's 7-day limit.
 */
export async function sendPendingCapiEvents({ logIds, userId } = {}) {
  if (!isCapiConfigured()) {
    return { sent: 0, failed: 0, retrying: 0, configured: false,
      message: 'Meta CAPI is not configured on the server (META_PIXEL_ID / META_ACCESS_TOKEN) — events stay pending' };
  }
  const { default: MetaCrmLead } = await import('../models/MetaCrmLead.js');
  const query = { pipeline: 'crm', sendStatus: 'pending' };
  if (Array.isArray(logIds)) query._id = { $in: logIds };

  const pending = await CapiEventLog.find(query).sort({ createdAt: 1 }).populate('lead');
  let sent = 0, failed = 0, retrying = 0;
  for (const entry of pending) {
    const result = entry.lead
      ? await sendMetaCapiEvent(entry.lead, entry.event, entry.eventTime || entry.createdAt)
      : { success: false, permanent: true, errorMessage: 'Lead no longer exists' };

    entry.attempts = (entry.attempts || 0) + 1;
    entry.lastAttemptAt = new Date();
    if (result.success) {
      entry.sendStatus = 'sent';
      entry.sentAt = new Date();
      entry.sentBy = userId || undefined;
      entry.errorMessage = '';
      entry.eventsReceived = result.eventsReceived || 0;
      sent++;
    } else if (result.permanent) {
      entry.sendStatus = 'failed';
      entry.errorMessage = result.errorMessage || 'Unknown error';
      failed++;
    } else {
      entry.errorMessage = `Will retry: ${result.errorMessage || 'Unknown error'}`;
      retrying++;
    }
    await entry.save();

    if (entry.lead && (result.success || result.permanent)) {
      await MetaCrmLead.findByIdAndUpdate(entry.lead._id, {
        ...(result.success ? { sentToCapi: true } : {}),
        $push: { capiEvents: { event: entry.event, success: !!result.success, at: new Date() } }
      });
    }
  }
  return { sent, failed, retrying, configured: true };
}
