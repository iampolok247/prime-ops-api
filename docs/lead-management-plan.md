# Lead Management Module — Build Plan

**Created:** 2026-06-25  
**Target:** 2-hour sprint (backend + frontend)  
**Stack:** Node.js + Express + MongoDB + React + Vite + Tailwind

---

## Business Rules

| # | Rule |
|---|------|
| 1 | Meta leads are captured through Make.com webhook, not direct Meta integration |
| 2 | New leads arrive via API endpoint |
| 3 | Duplicate leads must be detected using phone/email |
| 4 | Manual validation by DM/Admin happens before assignment |
| 5 | AI scoring verifies manual scoring |
| 6 | Final lead score is visible only to Admin and DM |
| 7 | Counsellors must never see lead score |
| 8 | Lead ordering is newest first |
| 9 | Manual assignment allowed |
| 10 | Every day at 1 PM, any unassigned lead must auto-assign via round robin |
| 11 | Counsellor updates lead status |
| 12 | Lead status changes must trigger Meta CAPI event sync |

---

## Gap Analysis — What Is Already Built vs. What Is Missing

### Already Built
- Lead model (basic fields, followUps, status machine)
- Lead CRUD routes — DM creates, Admission counsels
- Bulk CSV upload, manual assignment, bulk-assign
- Admission view (`LeadsCenterView`) — counsellors see their leads
- DM view (`LeadsCenter`) — full lead management

### Missing

| Rule # | Feature | Status |
|--------|---------|--------|
| 1 | Make.com webhook endpoint for Meta leads | ❌ Not built |
| 3 | Duplicate detection (robust) | ⚠️ Partial (180-day window only) |
| 4 | Manual validation state (`pending`) before assignment | ❌ Not built |
| 5 | AI scoring via OpenAI/Groq | ❌ Not built |
| 6 | Score hidden from counsellors (server-side RBAC) | ❌ Not built |
| 10 | 1 PM round-robin auto-assign cron | ❌ Not built |
| 12 | Meta CAPI on status change | ❌ Not built |

---

## File Change Map

```
Backend (Node.js)
├── models/Lead.js              ← add 5 new fields
├── routes/leads.js             ← add webhook, validate, round-robin trigger
├── routes/admission.js         ← strip score fields, status → CAPI
├── utils/aiScoring.js          ← NEW: Groq scoring
├── utils/metaCapi.js           ← NEW: CAPI client
├── jobs/roundRobin.js          ← NEW: cron logic
└── server.js                   ← register cron on startup

Frontend (React)
├── pages/LeadsCenter.jsx       ← Pending tab, validate modal, score badge
├── pages/LeadsCenterView.jsx   ← nextFollowUpDate, guard score fields
└── lib/api.js                  ← add validateLead(), triggerRoundRobin()
```

---

## Recommended Build Order

```
1. models/Lead.js          — everything depends on this
2. utils/aiScoring.js
3. utils/metaCapi.js
4. jobs/roundRobin.js
5. routes/leads.js         — webhook + validate endpoints
6. routes/admission.js     — score strip + CAPI fire
7. server.js               — cron wire-up
8. lib/api.js              — new API calls
9. LeadsCenter.jsx         — pending tab + validate modal + score badge
10. LeadsCenterView.jsx    — follow-up date picker + score guard
```

---

## Phase-by-Phase TODO List

### PHASE 1 — Model + Webhook `Backend` `0:00–0:20`

> Goal: Accept Meta leads from Make.com

- [ ] Extend `Lead` model — add fields:
  - `validationStatus`: `'pending' | 'validated' | 'rejected'` (default `'pending'` for Meta leads, `'validated'` for manual)
  - `aiScore`: Number 0–100
  - `manualScore`: `'Very Interested' | 'Interested' | 'Few Interested' | 'Not Interested'`
  - `metaLeadId`: String (Meta's lead ID, used for dedup)
  - `metaFormId`: String
- [ ] Create `POST /api/leads/webhook/meta` — no JWT, HMAC secret header from Make.com
- [ ] Auto-dedup on `phone + email` in webhook handler
- [ ] Save with `validationStatus: 'pending'`, `source: 'Meta Lead'`
- [ ] Add `node-cron` to dependencies

**Architectural note:** Using HMAC secret header instead of IP allowlist — more portable, Make.com supports custom headers natively.

---

### PHASE 2 — AI Scoring + Score Field RBAC `Backend` `0:20–0:45`

> Goal: Score leads automatically, hide score from counsellors at the API layer

- [ ] Create `utils/aiScoring.js` — Groq API call with lead context, returns score 0–100 + reasoning string
- [ ] Fire AI scoring async (non-blocking) after webhook save — update score document after response
- [ ] Fire AI scoring on manual lead creation too
- [ ] Modify `GET /api/admission/leads` — strip `aiScore`, `manualScore` when `req.user.role === 'Admission'`
- [ ] Modify `GET /api/leads/:id/history` — strip score fields for Admission role
- [ ] Add `PATCH /api/leads/:id/validate` — Admin/DM only, sets `validationStatus`, `manualScore`, optionally `assignedTo`

**Architectural note:** Score is stripped server-side so counsellors cannot access it via DevTools or direct API calls.

---

### PHASE 3 — Round-Robin Auto-Assign Cron `Backend` `0:45–1:00`

> Goal: Every day at 1 PM, all validated+unassigned leads are distributed evenly

- [ ] Create `jobs/roundRobin.js` — query `{ validationStatus: 'validated', assignedTo: null }` leads
- [ ] Fetch all active Admission users, sort by `displayOrder`
- [ ] Distribute leads in round-robin: lead[i] → admissions[i % admissions.length]
- [ ] Bulk-update with `assignedTo`, `assignedAt`, `status: 'Assigned'`
- [ ] Log each auto-assignment to ActivityLog
- [ ] Wire `node-cron` in `server.js`: `cron.schedule('0 7 * * *', ...)` (1 PM BST = 07:00 UTC)
- [ ] Add `POST /api/leads/round-robin/trigger` — Admin/SuperAdmin manual trigger for testing

**Architectural note:** `node-cron` runs in-process. Acceptable for single PM2 instance. For multi-instance, switch to Agenda.js with MongoDB lock.

---

### PHASE 4 — Meta CAPI Integration `Backend` `1:00–1:10`

> Goal: Sync lead status changes to Meta Conversions API

- [ ] Create `utils/metaCapi.js` — POST to Meta Graph API `/events` endpoint
- [ ] Status → event mapping:
  - `Counseling` → `Lead`
  - `Admitted` → `CompleteRegistration`
  - `Not Interested` → skip
- [ ] Fire non-blocking on status change in both `routes/leads.js` and `routes/admission.js`
- [ ] Add env vars: `META_PIXEL_ID`, `META_ACCESS_TOKEN`

**Architectural note:** Fire-and-forget (no retry). Full retry queue would need Agenda.js or BullMQ. Acceptable for MVP.

---

### PHASE 5 — Frontend: Pending Validation Tab `Frontend` `1:10–1:30`

> Goal: DM/Admin can review, score, and validate Meta leads before assignment

- [ ] Add `"Pending Review"` tab to `LeadsCenter.jsx` — filter by `validationStatus: 'pending'`
- [ ] Add `aiScore` badge (visible only to `DigitalMarketing`, `Admin`, `SuperAdmin`)
- [ ] Add **Validate Lead** modal — set `manualScore`, optionally assign to counsellor, Approve/Reject buttons
- [ ] Add `api.validateLead(id, payload)` to `lib/api.js`
- [ ] Add Meta lead badge (Facebook icon + "Meta Lead" tag on lead cards)

---

### PHASE 6 — Frontend: Counsellor View Polish `Frontend` `1:30–1:50`

> Goal: Counsellors can update status cleanly, follow-up scheduling works

- [ ] Verify `LeadsCenterView.jsx` status buttons work (`Counseling → Admitted / In Follow Up / Not Interested`)
- [ ] Add `nextFollowUpDate` date picker when counsellor selects "In Follow Up"
- [ ] Confirm `aiScore` and `manualScore` fields are **never rendered** in `LeadsCenterView.jsx`
- [ ] Add "Unvalidated" visual warning if a pending lead appears in counsellor view (should not happen, but guard anyway)

---

### PHASE 7 — Env / Wiring / Smoke Test `Both` `1:50–2:00`

- [ ] Add to `.env`:
  - `WEBHOOK_SECRET=<hmac-secret>`
  - `GROQ_API_KEY=<key>`
  - `META_PIXEL_ID=<pixel-id>`
  - `META_ACCESS_TOKEN=<token>`
- [ ] Test Make.com webhook with curl
- [ ] Manually trigger round-robin via `POST /api/leads/round-robin/trigger`
- [ ] Verify score fields are absent in Admission API response
- [ ] Verify Meta CAPI fires on status change (check Meta Events Manager)

---

## Environment Variables Required

```env
# Make.com webhook authentication
WEBHOOK_SECRET=

# AI scoring
GROQ_API_KEY=
# or OPENAI_API_KEY=

# Meta Conversions API
META_PIXEL_ID=
META_ACCESS_TOKEN=
```

---

## Progress Tracker

| Phase | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | Model fields + webhook | ✅ Done | All 16 spreadsheet columns in MetaLead.js |
| 2 | AI scoring + RBAC | ✅ Done | OpenAI gpt-4o-mini, score stripped server-side for Admission |
| 3 | Round-robin cron | ✅ Done | node-cron at 07:00 UTC (1 PM BST), manual trigger endpoint |
| 4 | Meta CAPI | ✅ Done | Fires async on Counseling / Admitted status change |
| 5 | Frontend DM/Admin view | ✅ Done | MetaLeadsManager.jsx — all 16 columns matching spreadsheet |
| 6 | Frontend counsellor view | ✅ Done | MetaLeadsPipeline.jsx — no score fields |
| 7 | Local smoke test | ✅ Done | All 10 API tests passed locally with Docker MongoDB |

## Local Test Results (2026-06-25)

| Test | Result |
|------|--------|
| Webhook rejects wrong secret | ✅ 401 UNAUTHORIZED |
| Webhook creates lead (ML-2026-00001) | ✅ 201 created |
| Duplicate detection (same phone/email) | ✅ 200 DUPLICATE |
| List leads as SuperAdmin (score visible) | ✅ all fields present |
| List leads as Admission (score hidden) | ✅ score fields absent |
| Stats endpoint | ✅ pending/validated counts correct |
| Round-robin trigger | ✅ fires without error |
| Validate lead (manualScore set) | ✅ validationStatus → validated |
| Stats after validation | ✅ validatedUnassigned incremented |

## Remaining Before Production Push

- [ ] Add `OPENAI_API_KEY` to production server `.env`
- [ ] Add `WEBHOOK_SECRET` to production server `.env` and configure Make.com header
- [ ] Add `META_PIXEL_ID` + `META_ACCESS_TOKEN` to production server `.env`
- [ ] Restart server on production (`pm2 restart prime.server`)
- [ ] Send one real test lead from Make.com scenario

Update this table as each phase completes:
- ⬜ Todo
- 🔄 In Progress
- ✅ Done
- ❌ Blocked
