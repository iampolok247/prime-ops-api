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

  const prompt = `You are a lead qualification expert for Prime Academy, an educational institution in Bangladesh.

Score this lead STRICTLY based on their actual form answers. Be honest — most paid ad leads are not ready to enroll immediately.

SCORING RULES (apply strictly):

COLD (0–39): Any of these answers → score max 35
- "এখনো নিশ্চিত নই" / "not sure yet" / "নিশ্চিত না"
- "অন্যান্য" / "Other" as reason (vague, no real intent)
- "না" / "No" to enrollment readiness
- No clear goal or reason given

WARM (40–69): Interested but hesitant
- Wants more information before deciding
- Has a goal but unsure about timing
- Positive but non-committal answers

HOT (70–100): Clear intent, ready to act
- "হ্যাঁ, আগ্রহী" / "Yes, interested" / "প্রস্তুত"
- Ready to enroll within 7 days
- Clear specific goal (freelancing income, job, IELTS score)
- Knows exactly what they want

Lead context:
- Course: ${lead.interestedCourse || 'not specified'}
- Source: ${lead.isOrganic ? 'Organic (higher intent)' : 'Paid ad'}

Form Q&A (Bengali or English):
${qaBlock}

Respond ONLY with valid JSON:
{
  "score": 25,
  "temperature": "Cold",
  "reasoning": "One sentence, max 15 words, in English."
}

IMPORTANT: If answers show uncertainty ("এখনো নিশ্চিত নই", "অন্যান্য"), score MUST be below 40.`;

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
