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

  // Meta format: field_data: [{name: "question_key", values: ["answer"]}]
  if (Array.isArray(rawQuestionData.field_data)) {
    return rawQuestionData.field_data.map(({ name, values }) => ({
      question: name,
      answer:   Array.isArray(values) ? values[0] : values
    }));
  }

  // Flat format: {"full_name": "John", "phone_number": "017...", ...}
  const skip = new Set(['full_name','phone_number','email','id','form_id','ad_id',
    'ad_name','campaign_id','campaign_name','created_time','platform','is_organic']);
  return Object.entries(rawQuestionData)
    .filter(([k]) => !skip.has(k))
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

  const prompt = `You are a lead qualification expert for Prime Academy, an educational institution in Bangladesh.

A prospective student submitted a Meta (Facebook/Instagram) ad lead form. Your job is to score this lead based ONLY on their form answers — not contact details.

Key signals to look for:
- Readiness to enroll: answers like "হ্যাঁ, প্রস্তুত" / "Yes, ready" / within 7 days → HIGH score
- Wants more info: "আরও জানতে চাই" / "want to know more" / "partially" → MEDIUM score
- Uncertain / not ready: "এখনো নিশ্চিত নই" / "not sure" / vague answers → LOW score
- Career clarity: specific goal (e.g. freelancing, job, IELTS target score) → boosts score
- Course interest: knows exactly which course they want → boosts score

Lead information:
- Course interested in: ${lead.interestedCourse || 'not specified'}
- Platform: ${lead.platform || 'unknown'}
- Is organic: ${lead.isOrganic ? 'yes (higher intent)' : 'no (paid ad)'}

Form questions and answers (may be in Bengali or English):
${qaBlock}

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "score": 72,
  "temperature": "Warm",
  "reasoning": "One sentence explaining why."
}

Rules:
- score: integer 0–100
- temperature: exactly "Hot" (score 70+), "Warm" (score 50–69), or "Cold" (score 0–49)
- reasoning: max 15 words, in English`;

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

    if (typeof parsed.score !== 'number') throw new Error('Invalid score');

    const score = Math.min(100, Math.max(0, Math.round(parsed.score)));

    // Enforce thresholds server-side regardless of what AI returned
    const temperature = score >= 70 ? 'Hot' : score >= 50 ? 'Warm' : 'Cold';

    return { score, temperature, reasoning: parsed.reasoning || '' };
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
