// OpenAI lead scoring — reads raw Meta form answers, returns score + Hot/Warm/Cold.
// No manual scoring. DM only validates (approve/reject). AI does all qualification.
// NOTE: Read OPENAI_API_KEY inside functions, not at module level —
// ESM imports are hoisted so this module loads before dotenv.config() runs in server.js.
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Extract form Q&A pairs from rawQuestionData.
 * Handles both nested field_data array (from Make.com/Meta)
 * and flat key-value objects (from manual test POSTs).
 */
function extractFormAnswers(rawQuestionData) {
  if (!rawQuestionData) return [];

  // 1. Meta array format: field_data: [{name: "q", values: ["a"]}, ...]
  if (Array.isArray(rawQuestionData.field_data)) {
    return rawQuestionData.field_data.map(({ name, values }) => ({
      question: name,
      answer:   Array.isArray(values) ? values[0] : values
    }));
  }

  // 2. field_data sent as a JSON string — parse it first
  if (typeof rawQuestionData.field_data === 'string') {
    try {
      const fd = JSON.parse(rawQuestionData.field_data);
      // Array form after parsing
      if (Array.isArray(fd)) {
        return fd.map(({ name, values }) => ({
          question: name,
          answer:   Array.isArray(values) ? values[0] : values
        }));
      }
      // Flat object form after parsing: {"question_key": "answer" or ["answer"], ...}
      if (fd && typeof fd === 'object') {
        const skip = new Set(['full_name','phone_number','email','id','form_id','ad_id',
          'ad_name','campaign_id','campaign_name','created_time','platform','is_organic']);
        return Object.entries(fd)
          .filter(([k]) => !skip.has(k))
          .map(([k, v]) => ({
            question: k,
            answer: Array.isArray(v) ? v[0] : String(v)  // answers often come as arrays
          }))
          .filter(({ answer }) => answer && answer !== 'undefined');
      }
    } catch {}
  }

  // 3. Flat top-level format: {"full_name": "John", "phone_number": "017...", ...}
  const skip = new Set(['full_name','phone_number','email','id','form_id','ad_id',
    'ad_name','campaign_id','campaign_name','created_time','platform','is_organic',
    'field_data','interestedCourse']);
  return Object.entries(rawQuestionData)
    .filter(([k, v]) => !skip.has(k) && v && typeof v !== 'object')
    .map(([k, v]) => ({ question: k, answer: String(v) }));
}

/**
 * Score a lead using OpenAI by analysing the actual form answers.
 * Returns { score: number, temperature: 'Hot'|'Warm'|'Cold', reasoning: string }
 * or null on failure.
 *
 * Temperature logic (defined by team):
 *   Hot  = 70+     → ready to enroll, clear intent, willing within 7 days
 *   Warm = 50–69   → interested but needs follow-up, wants more info
 *   Cold = 0–49    → uncertain, not ready, just browsing
 */
export async function scoreLeadWithAI(lead) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.warn('[AI Scoring] OPENAI_API_KEY not configured — skipping');
    return null;
  }

  const formAnswers = extractFormAnswers(lead.rawQuestionData);

  // Build a readable Q&A block for the AI
  const qaBlock = formAnswers.length > 0
    ? formAnswers.map(({ question, answer }) => `  Q: ${question}\n  A: ${answer}`).join('\n\n')
    : '  (no form answers available)';

  const prompt = `You are an AI lead scoring assistant for Prime Academy Bangladesh.
Your job: Analyze Meta/Facebook educational leads and assign likelihood-to-enroll score.
Output: ONLY valid JSON. No markdown. No explanation outside JSON.


SCORING RANGES:
70–100 = Hot Lead (likely to enroll within 30 days)
40–69 = Warm Lead (interested, needs nurture)
0–39 = Cold Lead (low intent or unfit)


SCORING FORMULA (Total = 100 points):

1. ENROLLMENT READINESS (50 points — MOST IMPORTANT)

Question key: "সঠিক_গাইডলাইন_পেলে_আগামী_৭_দিনের_মধ্যে_ভর্তি_হতে_আগ্রহী_কি?"
(Translation: "Are you interested in enrolling within 7 days if given proper guidance?")

Keyword scoring:
├─ Answer contains "হ্যাঁ,_প্রস্তুত" OR "হ্যাঁ" (Yes, ready) → +50
├─ Answer contains "আরও_জানতে_চাই" OR "জানতে" (Want to know more) → +30
├─ Answer contains "এখনো_নিশ্চিত_নই" OR "সম্ভবত" (Not sure / Maybe) → +10
└─ Any other answer or blank → +0

SENTIMENT FALLBACK (use when answer doesn't match any keyword above):
Analyze the overall sentiment and intent of the answer:
- Clear positive/eager sentiment → treat as "হ্যাঁ" → +50
- Curious but non-committal sentiment → treat as "জানতে" → +30
- Hesitant/uncertain sentiment → treat as "এখনো নিশ্চিত নই" → +10
- Negative/disinterested sentiment → +0


2. GOAL / MOTIVATION (35 points)

Question key: "আপনি_কেন_এই_কোর্সে_ভর্তি_হতে_চান_?"
(Translation: "Why do you want to enroll in this course?")

Keyword scoring tiers:

HIGH INTENT (+28–35):
├─ "ফ্রিল্যান্সিং" → +35
├─ "ব্যবসা" OR "সাইড ইনকাম" → +35
├─ "আয়" OR "টাকা" (earning/money) → +35
├─ "চাকরি" (job) → +32
├─ "ক্যারিয়ার" (career) → +32
└─ "উন্নত" (improve/advance) → +32

MEDIUM INTENT (+15–25):
├─ "স্কিল" OR "শিখতে" (skill/learn) → +20
├─ "দক্ষতা" (competency) → +18
├─ "ভবিষ্যত" (future) → +18
└─ "ব্যক্তিগত_উন্নয়ন" + industry context → +18

LOW INTENT (+0–12):
├─ "ব্যক্তিগত_উন্নয়ন" alone → +12
├─ "জানতে" OR "কৌতূহল" (curiosity) → +5
├─ "বন্ধু" (friend suggested) → +3
└─ Vague, "অন্যান্য", "না জানি" → +0

SENTIMENT FALLBACK (use when answer doesn't match any keyword):
Analyze the intent and goal described in the answer:
- Answer describes financial/career goal in any form → apply HIGH INTENT range
- Answer describes learning/growth desire → apply MEDIUM INTENT range
- Answer is vague, indirect, or shows no real goal → apply LOW INTENT range
- If multiple keywords match, use HIGHEST scoring tier


3. EXPERIENCE LEVEL (15 points)

Question key: "আপনার_বর্তমান_অভিজ্ঞতা_কতটুকু?"
(Translation: "What is your current experience level?")

Keyword scoring:
├─ "করেছি" OR "কাজ" OR "অভিজ্ঞতা" (have worked/experience) → +15
├─ "কিছুটা_জানি" OR "কিছুটা" (know a bit) → +10
├─ "সম্পর্কিত কোর্স" (related course) → +10
├─ "নতুন" OR "শুরু" OR "না" (beginner) → +3
└─ Blank or unclear → +5

SENTIMENT FALLBACK: Judge how much experience the answer implies — experienced/some/none.


SCORING ADJUSTMENTS (applied AFTER base score):

INCREASE by +5 to +10:
├─ Enrollment answer contains "এই মাসে" OR "এখন" OR "তাড়াতাড়ি" → +8
├─ Motivation contains "৳" OR "টাকা" OR any income number → +7
├─ Any answer mentions "upwork" OR "fiverr" OR "freelancer.com" → +6
└─ Motivation answer is more than 3 words (detailed) → +3

DECREASE by –5 to –15:
├─ Answer contains "ভাবব" OR "দেখব" OR "চিন্তা করব" (will think/will see) → –8
├─ Answer contains "অন্য" + ("কোর্স" OR "প্ল্যাটফর্ম") → –10
├─ Answer contains "বেকার" OR "চাকরি হারিয়েছি" OR "অনিশ্চয়ত" → –8
├─ Answer contains "সময় নেই" AND no flexible scheduling mention → –8
└─ Motivation < 2 words AND motivation scored < 10 → –5


FINAL CALCULATION:
Total = Enrollment + Motivation + Experience + Adjustments
Capped: 0–100


CONTACT VALIDATION: IGNORED
Score ONLY on the 3 core question answers.
Ignore: full_name, phone, email, date_of_birth, timestamp.


Lead context:
- Course: ${lead.interestedCourse || 'not specified'}
- Source: ${lead.isOrganic ? 'Organic (higher intent)' : 'Paid ad'}

Form Q&A:
${qaBlock}


OUTPUT — ONLY THIS JSON:
{
  "score": <integer 0–100>,
  "temperature": "Hot|Warm|Cold",
  "reasoning": "<max 15 words in English>"
}`;

  try {
    const res = await fetch(OPENAI_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.1,  // low temperature = consistent, deterministic scoring
        max_tokens:  120
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[AI Scoring] OpenAI ${res.status}:`, err?.error?.message || '');
      return null;
    }

    const data   = await res.json();
    const raw    = data.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw);

    // Support both key formats: {score/lead_score, temperature/lead_status, reasoning/reason}
    const rawScore = parsed.lead_score ?? parsed.score;
    if (typeof rawScore !== 'number') throw new Error('Invalid score');

    const score = Math.min(100, Math.max(0, Math.round(rawScore)));

    // Enforce thresholds server-side regardless of what AI returned
    const temperature = score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold';
    const reasoning   = parsed.reason || parsed.reasoning || '';

    return { score, temperature, reasoning };
  } catch (e) {
    console.error('[AI Scoring] Error:', e.message);
    return null;
  }
}

/**
 * Fire AI scoring async after lead save — never blocks the HTTP response.
 * Updates aiScore, leadTemperature, aiReasoning, aiScoredAt on the document.
 */
export function scoreLeadAsync(MetaLeadModel, leadId, leadData) {
  scoreLeadWithAI(leadData)
    .then(result => {
      if (!result) return;
      console.log(`[AI Scoring] ${leadData.name || leadId}: ${result.score} (${result.temperature})`);
      return MetaLeadModel.findByIdAndUpdate(leadId, {
        aiScore:         result.score,
        leadTemperature: result.temperature,
        aiReasoning:     result.reasoning,
        aiScoredAt:      new Date()
      });
    })
    .catch(e => console.error('[AI Scoring] Async update failed:', e.message));
}
