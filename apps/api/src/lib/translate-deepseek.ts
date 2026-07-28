/**
 * DeepSeek-powered EN → AR translation for admin content (template
 * titles, descriptions, input labels, banner copy, …).
 *
 * Model: `deepseek-chat` via DeepSeek's OpenAI-compatible REST API with
 * JSON-mode output, so the response is a machine-parseable map and never
 * free prose. Auth: `DEEPSEEK_API_KEY` Worker secret.
 *
 * ── Style guide ─────────────────────────────────────────────────────
 * `ARABIC_STYLE_GUIDE` is THE editable knob. The founder's wording
 * references land here (tone, product-term glossary, do-not-translate
 * list) — edit the constant, redeploy, and every Translate button in the
 * admin follows the new style. Keep rules terse and imperative; the
 * model follows short rules far better than essays.
 */

export const ARABIC_STYLE_GUIDE = `
You translate UI copy for "Clickefy" — an AI product-photo & video app.
Translate English → Modern Standard Arabic with these rules:

- Voice: modern, friendly-professional marketing Arabic. Not stiff or
  literary; not slangy. Address the user directly.
- Keep it SHORT. UI copy must stay roughly the same visual length as
  the English — compress rather than explain.
- Brand & product terms stay in Latin script, untranslated: "Clickefy",
  "Clickefy Pro", model names (Kling, Gemini, Nano Banana, Seedance).
- Established tech loanwords use the common Arabic form the app already
  uses: الذكاء الاصطناعي (AI), قالب/قوالب (template/s), رصيد/أرصدة
  (credit/s), اشتراك (subscription), توليد/إنشاء (generate/create).
- Numbers stay Western digits (1, 2, 3). Keep placeholders like
  {{count}} or {{name}} EXACTLY as-is, untranslated, in place.
- No diacritics (tashkeel) except where ambiguity truly demands it.
- Marketing flair is welcome when the English has it, but never invent
  claims that aren't in the source.
`.trim();

export interface TranslateArgs {
  apiKey: string;
  /** Flat map of stable keys → English source strings. */
  texts: Record<string, string>;
  /** Optional extra context ("template about jewelry product shots"). */
  context?: string;
}

/**
 * Translate a flat map of strings. Returns the same keys with Arabic
 * values. Throws on API/shape errors — the route maps that to a 502.
 */
export async function translateToArabic(args: TranslateArgs): Promise<Record<string, string>> {
  const { apiKey, texts, context } = args;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 1.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `${ARABIC_STYLE_GUIDE}\n\n` +
            'Input: a JSON object of key → English string. Reply with a JSON ' +
            'object with EXACTLY the same keys, each value the Arabic ' +
            'translation. No commentary, no extra keys.',
        },
        {
          role: 'user',
          content:
            (context ? `Context: ${context}\n\n` : '') + JSON.stringify(texts),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned an empty completion');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('DeepSeek returned non-JSON content');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DeepSeek returned a non-object payload');
  }

  // Keep only the requested keys with non-empty string values — the
  // model can neither inject extra fields nor blank out a source.
  const out: Record<string, string> = {};
  for (const key of Object.keys(texts)) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim().length > 0) out[key] = v.trim();
  }
  return out;
}
