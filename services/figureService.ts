// ─────────────────────────────────────────────────────────────────────────────
// figureService.ts — Claude vision-based figure legend generator
// Uses the Anthropic Messages API with base64 image + text (multi-modal)
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

// ─────────────────────────────────────────────────────────────────────────────
// Internal SSE streaming helper (image + text content)
// ─────────────────────────────────────────────────────────────────────────────

async function streamWithImage(
  systemPrompt: string,
  textPrompt: string,
  imageBase64: string,
  mimeType: ImageMimeType,
  maxTokens: number,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<string> {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    stream: true,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: textPrompt,
          },
        ],
      },
    ],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API 오류 ${res.status}: ${errText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data);
        if (
          evt.type === 'content_block_delta' &&
          evt.delta?.type === 'text_delta'
        ) {
          const text: string = evt.delta.text;
          fullText += text;
          onChunk(text);
        }
      } catch {
        // ignore non-JSON SSE lines
      }
    }
  }
  return fullText;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an English-only academic figure legend for the supplied image.
 *
 * @param imageBase64     Pure base64 string (no data-URL prefix)
 * @param mimeType        MIME type of the image
 * @param figureNumber    Figure number to appear in legend (e.g. 1 → "Figure 1.")
 * @param paperTitle      Title of the paper (for context)
 * @param sectionName     Section this figure belongs to (e.g. "Results")
 * @param extraContext    Any additional context (method, sample size, units…)
 * @param onChunk         Called on each streamed text chunk
 * @param apiKey          Anthropic API key
 */
export async function generateFigureLegend(
  imageBase64: string,
  mimeType: ImageMimeType,
  figureNumber: number,
  paperTitle: string,
  sectionName: string,
  extraContext: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<string> {
  const sys = `You are an expert scientific writer specializing in academic figure legends for international peer-reviewed journals.

Your task is to write a precise, professional figure legend in English only.

**Required format:**
Figure ${figureNumber}. **[Concise descriptive title].** [2–4 sentences covering: (1) what type of figure this is (bar graph, scatter plot, Western blot, micrograph, schematic, etc.), (2) what is being measured/compared and on which axes, (3) key results or trends visible, (4) any statistical indicators, error bars, p-values, or significance markers visible.] [Abbreviations: list if present]. [n = sample size, if shown].

**Strict rules:**
1. English only — no Korean, no other languages
2. Only describe what is visually present in the figure — never fabricate data or results
3. Explicitly mention axis labels, units, legend items, error bars, and any statistical annotations that are visible
4. Use precise scientific terminology appropriate for the field
5. Do not start with "This figure shows" — start directly with "Figure ${figureNumber}."
6. Keep the legend concise yet complete: typically 50–150 words`;

  const textPrompt = `Paper title: ${paperTitle || '(not provided)'}
Section: ${sectionName || '(not specified)'}${extraContext ? `\nAdditional context: ${extraContext}` : ''}

Please write the figure legend for the image above following the required format.`;

  return streamWithImage(sys, textPrompt, imageBase64, mimeType, 2048, onChunk, apiKey);
}
