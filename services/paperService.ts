// ────────────────────────────────────────────────────────────
// paperService.ts — 6-stage paper writing pipeline
//   1. Outline Agent
//   2. Writing Agent (per section, with [Ref] markers)
//   3. Evidence Agent  → structured query plan + numbered CU placeholders
//   4. PubMed fetch     (handled in UI via pubmedService)
//   5. Rewriter Agent  → replaces [CU_N] with real PMID-backed citations
//   6. Review Agent    → quality control
// ────────────────────────────────────────────────────────────

import type { PubMedArticle } from './pubmedService';

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

// Evidence plan types ─────────────────────────────────────────

export type CitationNeedType = '지지 논문' | '반대 논문' | '방법론적 근거' | '배경 이론';

export interface ClaimPlan {
  id: string;           // "cu_1", "cu_2" …
  placeholder: string;  // "[CU_1]", "[CU_2]" …
  text: string;         // the claim sentence this citation supports
  searchQuery: string;  // primary English PubMed query
  variants: string[];   // 1-2 alternate queries
  neededType: CitationNeedType;
}

export interface SectionEvidencePlan {
  sectionName: string;
  claims: ClaimPlan[];
}

export interface EvidencePlan {
  plans: SectionEvidencePlan[];
  /** Section drafts with [Ref] replaced by numbered [CU_N] placeholders */
  draftWithCU: Record<string, string>;
}

// Review types ────────────────────────────────────────────────

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
// Core streaming helper (raw fetch → SSE)
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
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          const text: string = evt.delta.text;
          fullText += text;
          onChunk(text);
        }
      } catch {
        // non-JSON SSE lines — ignore
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
  const sys = `당신은 세계적인 학술지의 편집장입니다. 연구자가 제공하는 데이터/가설/핵심 아이디어를 바탕으로 논문의 체계적인 아웃라인을 작성합니다.

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

  const full = await streamMessages(
    sys,
    `다음 연구 내용을 바탕으로 논문 아웃라인을 작성해주세요:\n\n${researchInput}`,
    4096,
    onChunk,
    apiKey,
  );

  const m = full.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('아웃라인 JSON 파싱 실패. 응답: ' + full.slice(0, 300));
  return JSON.parse(m[0]) as PaperOutline;
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
  const sys = `당신은 학술 논문 전문 저술가입니다. 다음 규칙을 엄격히 지켜 섹션을 작성하세요:
1. 격식 있는 학술적 문체(Academic Tone)를 유지할 것
2. 문장 간의 논리적 연결성(Cohesion)을 극대화할 것
3. 인용이 필요한 주장 뒤에는 [Ref]를 명시할 것 (절대 논문을 지어내지 말 것)
4. 섹션 제목은 포함하지 말 것 (본문만 작성)
5. 600-1000 단어 분량으로 작성할 것`;

  const user = `논문 제목: ${outline.title}

**작성할 섹션:** ${sectionName}
**핵심 주장:** ${sectionInfo?.keyArgument ?? ''}

**전체 아웃라인 요약:**
${outline.sections.map(s => `- ${s.name}: ${s.keyArgument}`).join('\n')}

**연구 데이터/배경:**
${researchInput}

위 내용을 바탕으로 "${sectionName}" 섹션의 본문을 학술적 문체로 작성해주세요. 인용이 필요한 부분은 [Ref]로 표시하세요.`;

  return streamMessages(sys, user, 8192, onChunk, apiKey);
}

// ────────────────────────────────────────────────────────────
// Stage 3 — Evidence Agent
// Reads all section drafts, identifies [Ref] markers,
// assigns numbered claim-unit IDs [CU_N], and generates
// English PubMed search queries for each.
// ────────────────────────────────────────────────────────────

export async function runEvidenceAgent(
  outline: PaperOutline,
  sectionDrafts: Record<string, string>,
  keywords: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<EvidencePlan> {
  const sys = `당신은 학술 논문의 실증 근거 수집 전문 에이전트입니다.
초안에서 [Ref] 표시된 위치를 분석하여 각 주장에 필요한 PubMed 검색 쿼리를 생성합니다.

**출력 규칙:**
- 순수 JSON만 출력 (마크다운 코드블록 없이)
- 검색 쿼리는 반드시 영어로 작성 (PubMed MeSH 용어 활용)
- 각 [Ref]에는 고유한 번호 부여 (cu_1, cu_2, …)
- draftWithCU에는 원본 초안에서 [Ref]를 [CU_N]으로 교체한 전체 텍스트 수록

JSON 형식:
{
  "plans": [
    {
      "sectionName": "서론",
      "claims": [
        {
          "id": "cu_1",
          "placeholder": "[CU_1]",
          "text": "[Ref] 바로 앞 핵심 주장 문장 (한국어 원문)",
          "searchQuery": "primary English PubMed query with MeSH terms",
          "variants": ["alternative query 1", "alternative query 2"],
          "neededType": "지지 논문"
        }
      ]
    }
  ],
  "draftWithCU": {
    "서론": "[Ref]를 [CU_1], [CU_2]... 로 교체한 서론 전체 텍스트",
    "연구 방법": "..."
  }
}

neededType은 반드시 "지지 논문", "반대 논문", "방법론적 근거", "배경 이론" 중 하나.`;

  const draftsText = outline.sections
    .filter(s => !!sectionDrafts[s.name])
    .map(s => `### ${s.name}\n${sectionDrafts[s.name]}`)
    .join('\n\n---\n\n');

  const user = `**논문 제목:** ${outline.title}
**핵심 키워드:** ${keywords}

**섹션 초안들 (각 [Ref]에 번호 부여 필요):**

${draftsText}

위 초안에서 모든 [Ref] 표시를 찾아 고유 번호(cu_1부터 순서대로)를 부여하고, 각 위치에 필요한 실제 PubMed 검색 쿼리를 생성해주세요.`;

  const full = await streamMessages(sys, user, 8192, onChunk, apiKey);

  const m = full.match(/\{[\s\S]*\}/);
  if (!m) {
    // Fallback: return an empty plan so the pipeline can continue
    const emptyDrafts: Record<string, string> = {};
    outline.sections.forEach(s => {
      if (sectionDrafts[s.name]) emptyDrafts[s.name] = sectionDrafts[s.name];
    });
    return { plans: [], draftWithCU: emptyDrafts };
  }
  try {
    return JSON.parse(m[0]) as EvidencePlan;
  } catch {
    const emptyDrafts: Record<string, string> = {};
    outline.sections.forEach(s => {
      if (sectionDrafts[s.name]) emptyDrafts[s.name] = sectionDrafts[s.name];
    });
    return { plans: [], draftWithCU: emptyDrafts };
  }
}

// ────────────────────────────────────────────────────────────
// Stage 5 — Rewriter Agent
// Takes a section draft with [CU_N] placeholders and a map of
// real fetched PubMed articles, and rewrites the section
// using only the provided evidence.
// ────────────────────────────────────────────────────────────

export async function runRewriterAgent(
  outline: PaperOutline,
  sectionName: string,
  draftWithCU: string,
  claimPlans: ClaimPlan[],
  claimArticles: Record<string, PubMedArticle[]>,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<string> {
  const sys = `당신은 실증 근거 기반 논문 섹션 재작성 전문가입니다.

**절대 규칙 (반드시 준수):**
1. 아래 "사용 가능한 근거" 목록에 있는 논문만 인용 가능합니다
2. PMID, 저자명, 발행연도를 절대 변조하거나 새로 만들지 마세요
3. 인용 형식: (저자표시, 연도) (PMID: XXXXXXXX)
   예: (Park et al., 2023) (PMID: 36712345)
4. [CU_N]에 해당하는 근거가 없으면 해당 주장을 근거 없이 서술하거나 삭제하세요
5. 제공되지 않은 어떤 논문도 인용하지 마세요
6. 학술적 문체와 원문의 논리 구조를 유지하세요`;

  // Build evidence context
  const evidenceLines: string[] = [];
  for (const claim of claimPlans) {
    const arts = claimArticles[claim.id] ?? [];
    evidenceLines.push(`\n**${claim.placeholder}** — 주장: "${claim.text}"`);
    evidenceLines.push(`필요 유형: ${claim.neededType}`);
    if (arts.length === 0) {
      evidenceLines.push('  ⚠️ 검색 결과 없음 — 이 자리표시자를 제거하거나 주장을 약화시키세요');
    } else {
      arts.forEach((art, i) => {
        evidenceLines.push(`  ${i + 1}. ${art.citationFull}`);
        evidenceLines.push(`     제목: ${art.title}`);
        evidenceLines.push(`     저널: ${art.journal} (${art.pubYear})`);
        if (art.abstract) {
          evidenceLines.push(`     초록: ${art.abstract.slice(0, 300)}${art.abstract.length > 300 ? '…' : ''}`);
        }
      });
    }
  }

  const user = `**논문 제목:** ${outline.title}
**섹션명:** ${sectionName}

**사용 가능한 근거 (PubMed 실제 논문):**
${evidenceLines.join('\n')}

**재작성할 초안 (${sectionName}):**
${draftWithCU}

위 초안에서 [CU_N] 자리표시자를 사용 가능한 근거 논문으로 교체하여 섹션을 재작성해주세요.
섹션 제목 없이 본문만 출력하세요.`;

  return streamMessages(sys, user, 8192, onChunk, apiKey);
}

// ────────────────────────────────────────────────────────────
// Stage 6 — Review Agent
// ────────────────────────────────────────────────────────────

export async function runReviewAgent(
  outline: PaperOutline,
  fullDraft: string,
  onChunk: (text: string) => void,
  apiKey: string,
): Promise<ReviewResult> {
  const sys = `당신은 엄격한 논문 리뷰어(Reviewer #2)입니다. 제출된 초안을 비판적으로 검토하여 구체적이고 실질적인 개선 의견을 제시합니다.

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

type은 반드시 "logical_leap", "weak_evidence", "readability", "structural" 중 하나.`;

  const user = `**논문 제목:** ${outline.title}

**서론 핵심 주장:** ${outline.sections.find(s => s.name === '서론')?.keyArgument ?? ''}
**결론 핵심 주장:** ${outline.sections.find(s => s.name === '결론')?.keyArgument ?? ''}

**전체 초안:**
${fullDraft.slice(0, 14000)}

위 초안을 비판적으로 검토해주세요:
1. 인용이 제대로 됐는지 확인 (PMID 없는 인용 지적)
2. 논리적 비약이나 근거 부족한 문장 지적
3. 가독성 문제 수정 제안
4. 서론의 질문에 결론이 명확히 답하는지 평가
5. 최소 5개 이상의 구체적인 개선 의견 제시`;

  const full = await streamMessages(sys, user, 8192, onChunk, apiKey);

  const m = full.match(/\{[\s\S]*\}/);
  if (!m) return { overallScore: 0, flowEvaluation: full, comments: [], revisedPassages: [] };
  try {
    return JSON.parse(m[0]) as ReviewResult;
  } catch {
    return { overallScore: 0, flowEvaluation: full, comments: [], revisedPassages: [] };
  }
}

// ────────────────────────────────────────────────────────────
// Assemble final paper
// Prefers rewrittenDrafts (with real citations) over raw drafts
// ────────────────────────────────────────────────────────────

export function assembleFinalPaper(
  outline: PaperOutline,
  sectionDrafts: Record<string, string>,
  rewrittenDrafts: Record<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`# ${outline.title}\n`);
  lines.push(`## 초록\n\n${outline.abstract}\n`);

  for (const section of outline.sections) {
    lines.push(`## ${section.name}\n`);
    const body = rewrittenDrafts[section.name] || sectionDrafts[section.name] || '';
    lines.push(body + '\n');
  }

  if (outline.visualizations.length > 0) {
    lines.push(`\n## 시각화 제안\n`);
    outline.visualizations.forEach(v => lines.push(`- ${v}`));
  }

  return lines.join('\n');
}
