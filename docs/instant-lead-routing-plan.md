# Instant Lead Routing — Smart Auto-Assignment Feature

## Overview

When a new lead arrives via Facebook → Make.com → webhook, instead of sitting
in the unassigned queue waiting for an admin to manually assign, the lead gets
**instantly routed** to a counsellor who is marked as "on duty".

During working hours, counsellors receive new leads the moment they arrive.
When no new leads are coming in, they work their follow-up queue. Admin retains
full visibility and override control at all times.

---

## Phase 1 — Counsellor Availability

- [ ] Add `availableForInstantLeads: Boolean` field to `User` model (default `false`)
- [ ] Add toggle button in counsellor's own dashboard — "I'm Available / Off Duty"
- [ ] Admin can also toggle availability for any counsellor from the Meta Lead manager
- [ ] Show a green/grey availability dot next to each counsellor name in the CRM

---

## Phase 2 — Instant Routing on Webhook

- [ ] On webhook lead arrival, query counsellors with `availableForInstantLeads: true` and `isActive: true`
- [ ] Routing logic:
  - **1 available** → assign directly to them
  - **2+ available** → round-robin among the on-duty pool only
  - **0 available** → fall back to normal unassigned queue (admin assigns manually)
- [ ] Set `autoAssigned: true`, `status: 'Assigned'`, `validationStatus: 'validated'` immediately
- [ ] Skip the manual validation gate entirely for instantly-routed leads

---

## Phase 3 — Counsellor Real-Time Notification

- [ ] When a lead is instantly assigned, push an SSE event to that counsellor's active browser session
- [ ] Show a popup/toast: "New lead just arrived — [Name] · [Phone]" with a direct link
- [ ] Add a notification badge on the counsellor's sidebar/topbar
- [ ] Optional: browser sound alert when new instant lead arrives

---

## Phase 4 — Counsellor Work Queue View

Build a counsellor-facing "My Queue" page with two clear sections:

- **New Leads** (top, highlighted) — just arrived, status: Assigned, not yet contacted
- **Follow-ups** (below) — leads needing follow-up, sorted by `nextFollowUpDate` ascending

Behaviour:
- [ ] When counsellor opens/views a lead → auto-move to "Counseling" status
- [ ] Follow-up section only shows leads where `nextFollowUpDate <= today`
- [ ] Queue auto-refreshes via SSE (same mechanism as Meta Lead CRM)

---

## Phase 5 — Admin Control Panel

- [ ] In Meta Lead CRM header, show which counsellors are currently on-duty (green dot + name)
- [ ] Admin can enable/disable instant routing per counsellor with a toggle
- [ ] Admin can configure routing mode per campaign/form:
  - `round-robin` among all available counsellors
  - `specific counsellor` — always route to one person
  - `all available` — assign to everyone simultaneously (broadcast)
- [ ] Admin can see a live log: "Lead ML-2026-00012 → routed to Tanvir at 10:32 AM"

---

## Data Model Changes

```
User:
  + availableForInstantLeads: Boolean  (default: false)
  + instantLeadCount: Number           (counter for round-robin fairness)

MetaLead:
  + routedAt: Date                     (timestamp when instantly routed)
  + routingMode: String                (round-robin | specific | broadcast)
```

---

## How It Changes the Workflow

| Before | After |
|---|---|
| Lead arrives → sits unassigned → admin manually assigns | Lead arrives → instantly routed to on-duty counsellor |
| Counsellor waits to be assigned | Counsellor marks themselves available, leads come to them |
| Admin bottleneck during busy hours | Admin only involved when no counsellors are on duty |
| Follow-ups mixed with new leads | Two clear queues: New vs Follow-up |

---

## Build Order

1. Phase 1 (availability toggle) — backend + admin toggle UI
2. Phase 2 (instant routing logic) — modify webhook handler
3. Phase 3 (real-time notification) — SSE push to counsellor session
4. Phase 4 (counsellor queue view) — new frontend page
5. Phase 5 (admin control panel) — routing config UI

---

*Created: 2026-06-28*
*Status: Planned — not started*
