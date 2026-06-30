import { createHash } from 'crypto';

const PIXEL_ID    = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// Lead status → Meta standard event name
const STATUS_EVENT_MAP = {
  Counseling:     'Lead',
  Admitted:       'CompleteRegistration',
  'In Follow Up': 'ViewContent',
};

function sha256(value) {
  return createHash('sha256').update(String(value).trim()).digest('hex');
}

/**
 * Send a Conversions API event to Meta for a given lead + status.
 * Fire-and-forget — caller does not need to await.
 * Returns { success, event } or null if status has no mapping.
 */
export async function sendMetaCapiEvent(lead, status) {
  const eventName = STATUS_EVENT_MAP[status];
  if (!eventName) return null;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[Meta CAPI] META_PIXEL_ID / META_ACCESS_TOKEN not set — skipping');
    return null;
  }

  const userData = {};
  if (lead.email) userData.em = [sha256(lead.email.toLowerCase())];
  if (lead.phone) userData.ph = [sha256(lead.phone.replace(/\D/g, ''))];
  if (lead.name)  userData.fn = [sha256(lead.name.split(' ')[0].toLowerCase())];

  const payload = {
    data: [{
      event_name:       eventName,
      event_time:       Math.floor(Date.now() / 1000),
      event_source_url: 'https://ops.primeacademy.org',
      action_source:    'system_generated',
      user_data:        userData,
      custom_data: {
        currency:     'BDT',
        content_name: lead.interestedCourse || 'Unknown Course',
        content_ids:  [lead.leadId],
        lead_id:      lead.leadId
      }
    }]
  };

  try {
    const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      console.log(`[Meta CAPI] ✅ ${eventName} sent for ${lead.leadId} — events_received: ${data.events_received}`);
      return { success: true, event: eventName, eventsReceived: data.events_received || 0 };
    } else {
      console.error(`[Meta CAPI] ❌ ${eventName} failed for ${lead.leadId}:`, data);
      return { success: false, event: eventName, errorMessage: data?.error?.message || JSON.stringify(data) };
    }
  } catch (e) {
    console.error('[Meta CAPI] Error:', e.message);
    return { success: false, event: eventName, errorMessage: e.message };
  }
}
