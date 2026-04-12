// ────────────────────────────────────────────────────────────
// paperService.ts — 4-stage paper writing pipeline
// Uses the Anthropic Messages API directly via fetch (browser-safe)
// ────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = (
  (typeof process !== 'undefined' && process.env?.ANTHROPIC_API_KEY) ||
  ''
);
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-6';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface SectionOutline {
  name: string;
  keyArgument: string;
  visualizationSuggestion?: string | null;
}

export interface PaperOutline {
  title: string;
  abstract: string;
  sections: SectionOutline[];
  visualizations: string[];
}

export interface RefMarker {
  placeholder: string;
  searchQuery: string;
  neededType: '지지 논문' | '반대 논문' | '방법론적 근거' | '배경 이론';
  explanation: string;
}

export interface CitationEnhancement {
  refs: RefMarker[];
  enhancedDraft: string;
}

export interface ReviewComment {
  type: 'logical_leap' | 'weak_evidence' | 'readability' | 'structural';
  location: string;
  issue: string;
  suggestion: string;
}

export interface ReviewResult {
  overallScore: number;
  flowEvaluation: string;
  comments: ReviewComment[];
  revisedPassages: { original: string; revised: string }[];
}

// ────────────────────────────────────────────────────────────
// Core streaming helper
// ────────────────────────────────────────────────────────────

async function streamMessages(
  systemPrompt: string,
  userContent: string,
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
    messages: [{ role: 'user', content: userContent }],
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
        // ignore parse errors on non-JSON lines
      }
    }
  }

  return fullText;
}

// ────────────────────────────────────────────────────────────
// Stage 1 — Outline Agent
// ────────────────────────────────────────────────────────────

export async function runOutlineAgent(
  researchInput: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<PaperOutline> {
  const systemPrompt = `당신은 세계적인 학술지의 편집장입니다. 연구자가 제공하는 데이터/가설/핵심 아이디어를 바탕으로 논문의 체계적인 아웃라인을 작성합니다.

반드시 다음 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON만):
{
  "title": "논문 제목",
  "abstract": "초록 (3-5문장)",
  "sections": [
    {"name": "서론", "keyArgument": "핵심 주장 한 문장", "visualizationSuggestion": null},
    {"name": "이론적 배경", "keyArgument": "...", "visualizationSuggestion": "Table 1: ..."},
    {"name": "연구 방법", "keyArgument": "...", "visualizationSuggestion": "Figure 1: ..."},
    {"name": "결과", "keyArgument": "...", "visualizationSuggestion": "Figure 2: ..."},
    {"name": "고찰", "keyArgument": "...", "visualizationSuggestion": null},
    {"name": "결론", "keyArgument": "...", "visualizationSuggestion": null}
  ],
  "visualizations": ["Table 1: ...", "Figure 1: ...", "Figure 2: ..."]
}`;

  const fullText = await streamMessages(
    systemPrompt,
    `다음 연구 내용을 바탕으로 논문 아웃라인을 작성해주세요:\n\n${researchInput}`,
    4096,
    onChunk,
    apiKey,
  );

  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('아웃라인 JSON 파싱 실패. 응답: ' + fullText.slice(0, 300));
  return JSON.parse(jsonMatch[0]) as PaperOutline;
}

// ────────────────────────────────────────────────────────────
// Stage 2 — Writing Agent
// ────────────────────────────────────────────────────────────

export async function runWritingAgent(
  outline: PaperOutline,
  sectionName: string,
  researchInput: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<string> {
  const sectionInfo = outline.sections.find(s => s.name === sectionName);
  const systemPrompt = `당신은 학술 논문 전문 저술가입니다. 다음 규칙을 엄격히 지켜 섹션을 작성하세요:
1. 격식 있는 학술적 문체(Academic Tone)를 유지할 것
2. 문장 간의 논리적 연결성(Cohesion)을 극대화할 것
3. 인용이 필요한 주장 뒤에는 [Ref]를 명시할 것
4. 섹션 제목은 포함하지 말 것 (본문만 작성)
5. 600-1000 단어 분량으로 작성할 것`;

  const userPrompt = `논문 제목: ${outline.title}

**작성할 섹션:** ${sectionName}
**핵심 주장:** ${sectionInfo?.keyArgument ?? ''}

**전체 아웃라인 요약:**
${outline.sections.map(s => `- ${s.name}: ${s.keyArgument}`).join('\n')}

**연구 데이터/배경:**
${researchInput}

위 내용을 바탕으로 "${sectionName}" 섹션의 본문을 학술적 문체로 작성해주세요. 인용이 필요한 부분은 [Ref]로 표시하세요.`;

  return await streamMessages(systemPrompt, userPrompt, 8192, onChunk, apiKey);
}

// ────────────────────────────────────────────────────────────
// Stage 3 — Citation Enhancement Agent
// ────────────────────────────────────────────────────────────

export async function runCitationAgent(
  sectionName: string,
  draftText: string,
  keywords: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<CitationEnhancement> {
  const systemPrompt = `당신은 서지정보 전문가이자 문헌 정보 에이전트입니다. 초안에서 [Ref] 표시된 부분을 분석하여 각 위치에 필요한 인용 정보를 제안합니다.

반드시 다음 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON만):
{
  "refs": [
    {
      "placeholder": "[Ref_1]",
      "searchQuery": "Google Scholar 검색 쿼리 (영어로)",
      "neededType": "지지 논문",
      "explanation": "이 위치에 어떤 성격의 논문이 필요한지 설명"
    }
  ],
  "enhancedDraft": "원본 초안에서 각 [Ref]를 [Ref_N: 간략 설명]으로 교체한 전체 텍스트"
}

neededType은 반드시 "지지 논문", "반대 논문", "방법론적 근거", "배경 이론" 중 하나여야 합니다.`;

  const userPrompt = `**섹션명:** ${sectionName}
**핵심 키워드:** ${keywords}

**초안 텍스트:**
${draftText}

위 초안에서 [Ref] 표시된 부분에 들어갈 인용 후보를 분석해주세요.
- 2020년 이후 주요 논문들이 다뤘을 법한 내용을 추론
- 각 [Ref] 위치에 어떤 성격의 논문이 필요한지 설명
- 실제 검색에 사용할 구체적인 영어 쿼리 제공`;

  const fullText = await streamMessages(systemPrompt, userPrompt, 6144, onChunk, apiKey);

  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { refs: [], enhancedDraft: draftText };
  }
  try {
    return JSON.parse(jsonMatch[0]) as CitationEnhancement;
  } catch {
    return { refs: [], enhancedDraft: draftText };
  }
}

// ────────────────────────────────────────────────────────────
// Stage 4 — Review Agent
// ────────────────────────────────────────────────────────────

export async function runReviewAgent(
  outline: PaperOutline,
  fullDraft: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<ReviewResult> {
  const systemPrompt = `당신은 엄격한 논문 리뷰어(Reviewer #2)입니다. 제출된 초안을 비판적으로 검토하여 구체적이고 실질적인 개선 의견을 제시합니다.

반드시 다음 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON만):
{
  "overallScore": 7,
  "flowEvaluation": "서론-결론 흐름 전체 평가 (3-5문장)",
  "comments": [
    {
      "type": "logical_leap",
      "location": "섹션 이름 또는 인용 문구",
      "issue": "문제점 설명",
      "suggestion": "개선 제안"
    }
  ],
  "revisedPassages": [
    {"original": "원문 문장", "revised": "수정된 문장"}
  ]
}

type은 반드시 "logical_leap", "weak_evidence", "readability", "structural" 중 하나여야 합니다.`;

  const userPrompt = `**논문 제목:** ${outline.title}

**서론 핵심 주장:** ${outline.sections.find(s => s.name === '서론')?.keyArgument ?? ''}
**결론 핵심 주장:** ${outline.sections.find(s => s.name === '결론')?.keyArgument ?? ''}

**전체 초안:**
${fullDraft.slice(0, 12000)}

위 초안을 비판적으로 검토해주세요:
1. 논리적 비약이나 근거 부족한 문장 지적
2. 가독성 문제 수정 제안
3. 서론의 질문에 결론이 명확히 답하는지 평가
4. 최소 5개 이상의 구체적인 개선 의견 제시`;

  const fullText = await streamMessages(systemPrompt, userPrompt, 8192, onChunk, apiKey);

  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      overallScore: 0,
      flowEvaluation: fullText,
      comments: [],
      revisedPassages: [],
    };
  }
  try {
    return JSON.parse(jsonMatch[0]) as ReviewResult;
  } catch {
    return {
      overallScore: 0,
      flowEvaluation: fullText,
      comments: [],
      revisedPassages: [],
    };
  }
}

// ────────────────────────────────────────────────────────────
// Assemble final paper
// ────────────────────────────────────────────────────────────

export function assembleFinalPaper(
  outline: PaperOutline,
  sectionDrafts: Record<string, string>,
  citationEnhancements: Record<string, CitationEnhancement>,
): string {
  const lines: string[] = [];

  lines.push(`# ${outline.title}\n`);
  lines.push(`## 초록\n\n${outline.abstract}\n`);

  for (const section of outline.sections) {
    lines.push(`## ${section.name}\n`);
    const enhanced = citationEnhancements[section.name];
    const draft = enhanced?.enhancedDraft || sectionDrafts[section.name] || '';
    lines.push(draft + '\n');
  }

  if (outline.visualizations.length > 0) {
    lines.push(`\n## 시각화 제안\n`);
    outline.visualizations.forEach(v => lines.push(`- ${v}`));
  }

  return lines.join('\n');
}
