import React, { useState, useRef, useCallback } from 'react';
import {
  runOutlineAgent,
  runWritingAgent,
  runEvidenceAgent,
  runRewriterAgent,
  runReviewAgent,
  assembleFinalPaper,
  PaperOutline,
  EvidencePlan,
  ClaimPlan,
  ReviewResult,
  ReviewComment,
} from '../services/paperService';
import { searchWithFallback, PubMedArticle } from '../services/pubmedService';
import Layout from './Layout';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type Stage =
  | 'apikey'
  | 'input'
  | 'outline'
  | 'writing'
  | 'evidence'
  | 'rewrite'
  | 'review'
  | 'done';

type FetchStatus = 'pending' | 'fetching' | 'done' | 'empty';

const STAGE_LABELS: Record<Stage, string> = {
  apikey: 'API 키',
  input: '연구 입력',
  outline: '1 아웃라인',
  writing: '2 초안',
  evidence: '3 근거 수집',
  rewrite: '4 재작성',
  review: '5 리뷰',
  done: '완성',
};

const STAGE_ICONS: Record<Stage, string> = {
  apikey: 'fa-key',
  input: 'fa-pen-to-square',
  outline: 'fa-sitemap',
  writing: 'fa-file-lines',
  evidence: 'fa-microscope',
  rewrite: 'fa-pen-nib',
  review: 'fa-magnifying-glass',
  done: 'fa-scroll',
};

const REVIEW_TYPE_LABELS: Record<ReviewComment['type'], string> = {
  logical_leap: '논리적 비약',
  weak_evidence: '근거 부족',
  readability: '가독성',
  structural: '구조적 문제',
};

const REVIEW_TYPE_COLORS: Record<ReviewComment['type'], string> = {
  logical_leap: 'text-red-400 bg-red-400/10 border-red-400/30',
  weak_evidence: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  readability: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  structural: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
};

const NEED_TYPE_COLORS: Record<string, string> = {
  '지지 논문': 'text-green-400 bg-green-400/10 border-green-400/30',
  '반대 논문': 'text-red-400 bg-red-400/10 border-red-400/30',
  '방법론적 근거': 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  '배경 이론': 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
};

// ──────────────────────────────────────────────────────────────────────────
// Module-level sub-components
// ──────────────────────────────────────────────────────────────────────────

const ArticleCard: React.FC<{ art: PubMedArticle }> = ({ art }) => (
  <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-800 space-y-1">
    <div className="flex items-start gap-2">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-500/20 flex-shrink-0 mt-0.5">
        PMID
      </span>
      <a
        href={`https://pubmed.ncbi.nlm.nih.gov/${art.pmid}/`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-violet-400 font-mono hover:underline flex-shrink-0 mt-0.5"
      >
        {art.pmid}
      </a>
      <span className="text-[11px] text-slate-300 font-medium leading-tight flex-1 min-w-0">
        {art.title.length > 90 ? art.title.slice(0, 87) + '…' : art.title}
      </span>
    </div>
    <div className="flex items-center gap-2 text-[10px] text-slate-500">
      <span>{art.authorDisplay}</span>
      <span>·</span>
      <span>{art.journal.length > 30 ? art.journal.slice(0, 28) + '…' : art.journal}</span>
      <span>·</span>
      <span>{art.pubYear}</span>
    </div>
    {art.abstract && (
      <p className="text-[10px] text-slate-500 leading-relaxed line-clamp-2">
        {art.abstract}
      </p>
    )}
  </div>
);

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

const PaperWriter: React.FC<Props> = ({ onBack }) => {
  // API key ──────────────────────────────────────────────
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('anthropic_api_key') || '');
  const [apiKeyInput, setApiKeyInput] = useState(apiKey);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  // Pipeline state ────────────────────────────────────────
  const [stage, setStage] = useState<Stage>(apiKey ? 'input' : 'apikey');
  const [researchInput, setResearchInput] = useState('');
  const [keywords, setKeywords] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [streamBuffer, setStreamBuffer] = useState('');

  // Paper data ────────────────────────────────────────────
  const [outline, setOutline] = useState<PaperOutline | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, string>>({});

  // Evidence & PubMed state ───────────────────────────────
  const [evidencePlan, setEvidencePlan] = useState<EvidencePlan | null>(null);
  const [draftsWithCU, setDraftsWithCU] = useState<Record<string, string>>({});
  const [claimArticles, setClaimArticles] = useState<Record<string, PubMedArticle[]>>({});
  const [claimFetchStatus, setClaimFetchStatus] = useState<Record<string, FetchStatus>>({});

  // Rewrite & review ──────────────────────────────────────
  const [rewrittenDrafts, setRewrittenDrafts] = useState<Record<string, string>>({});
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [finalPaper, setFinalPaper] = useState('');

  // Active tracking ───────────────────────────────────────
  const [activeSection, setActiveSection] = useState('');

  const abortRef = useRef(false);

  // ── helpers ────────────────────────────────────────────

  const appendStream = useCallback((text: string) => {
    setStreamBuffer(prev => prev + text);
  }, []);

  const resetStream = () => setStreamBuffer('');

  const saveApiKey = () => {
    const key = apiKeyInput.trim();
    if (!key.startsWith('sk-ant-')) {
      alert('올바른 Anthropic API 키를 입력하세요. (sk-ant-로 시작해야 합니다)');
      return;
    }
    localStorage.setItem('anthropic_api_key', key);
    setApiKey(key);
    setStage('input');
  };

  // ──────────────────────────────────────────────────────────
  // Stage 1 — Outline
  // ──────────────────────────────────────────────────────────

  const handleGenerateOutline = async () => {
    if (!researchInput.trim()) return;
    setIsLoading(true);
    abortRef.current = false;
    resetStream();
    setStage('outline');
    setStatusMsg('아웃라인 에이전트가 논문 구조를 설계하는 중...');
    try {
      const result = await runOutlineAgent(researchInput, appendStream, apiKey);
      setOutline(result);
      setStatusMsg('아웃라인 완성! 초안 작성 단계로 이동하세요.');
    } catch (e: any) {
      setStatusMsg('오류: ' + (e.message ?? '알 수 없는 오류'));
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────
  // Stage 2 — Writing
  // ──────────────────────────────────────────────────────────

  const handleWriteSection = async (sectionName: string) => {
    if (!outline) return;
    setIsLoading(true);
    abortRef.current = false;
    resetStream();
    setActiveSection(sectionName);
    setStage('writing');
    setStatusMsg(`"${sectionName}" 섹션 집필 중...`);
    try {
      const draft = await runWritingAgent(outline, sectionName, researchInput, appendStream, apiKey);
      setSectionDrafts(prev => ({ ...prev, [sectionName]: draft }));
      setStatusMsg(`"${sectionName}" 초안 완성!`);
    } catch (e: any) {
      setStatusMsg('오류: ' + (e.message ?? ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleWriteAll = async () => {
    if (!outline) return;
    setIsLoading(true);
    setStage('writing');
    for (let i = 0; i < outline.sections.length; i++) {
      if (abortRef.current) break;
      const sec = outline.sections[i];
      resetStream();
      setActiveSection(sec.name);
      setStatusMsg(`"${sec.name}" 섹션 집필 중... (${i + 1}/${outline.sections.length})`);
      try {
        const draft = await runWritingAgent(outline, sec.name, researchInput, appendStream, apiKey);
        setSectionDrafts(prev => ({ ...prev, [sec.name]: draft }));
      } catch (e: any) {
        setStatusMsg('오류: ' + (e.message ?? ''));
        break;
      }
    }
    setStatusMsg('모든 섹션 초안 완성! 근거 수집 단계로 이동하세요.');
    setIsLoading(false);
  };

  // ──────────────────────────────────────────────────────────
  // Stage 3 — Evidence Agent + PubMed fetch (auto-combined)
  // ──────────────────────────────────────────────────────────

  const handleRunEvidence = async () => {
    if (!outline || Object.keys(sectionDrafts).length === 0) return;
    setIsLoading(true);
    abortRef.current = false;
    resetStream();
    setStage('evidence');
    setStatusMsg('근거 수집 에이전트가 인용 계획을 수립하는 중...');

    try {
      // ── Step A: AI generates evidence plan ──────────────
      const plan = await runEvidenceAgent(
        outline,
        sectionDrafts,
        keywords || researchInput.slice(0, 200),
        appendStream,
        apiKey,
      );
      setEvidencePlan(plan);
      setDraftsWithCU(plan.draftWithCU);
      resetStream();

      // ── Step B: Fetch PubMed for each claim ─────────────
      const allClaims: ClaimPlan[] = plan.plans.flatMap(p => p.claims);
      if (allClaims.length === 0) {
        setStatusMsg('인용 계획 완성! (인용 자리표시자 없음 — 재작성 단계로 진행하세요)');
        setIsLoading(false);
        return;
      }

      // Initialise fetch status
      const initStatus: Record<string, FetchStatus> = {};
      allClaims.forEach(c => { initStatus[c.id] = 'pending'; });
      setClaimFetchStatus(initStatus);

      for (let i = 0; i < allClaims.length; i++) {
        if (abortRef.current) break;
        const claim = allClaims[i];
        setClaimFetchStatus(prev => ({ ...prev, [claim.id]: 'fetching' }));
        setStatusMsg(
          `PubMed 검색 중 (${i + 1}/${allClaims.length}): "${claim.text.slice(0, 50)}..."`,
        );
        try {
          const arts = await searchWithFallback(claim.searchQuery, claim.variants, 5);
          setClaimArticles(prev => ({ ...prev, [claim.id]: arts }));
          setClaimFetchStatus(prev => ({
            ...prev,
            [claim.id]: arts.length > 0 ? 'done' : 'empty',
          }));
        } catch {
          setClaimFetchStatus(prev => ({ ...prev, [claim.id]: 'empty' }));
        }
      }

      const found = allClaims.filter(c => (claimArticles[c.id]?.length ?? 0) > 0).length;
      setStatusMsg(
        `근거 수집 완료! ${allClaims.length}개 주장 중 ${found}개에서 PubMed 논문 확보. 재작성 단계로 이동하세요.`,
      );
    } catch (e: any) {
      setStatusMsg('오류: ' + (e.message ?? ''));
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────
  // Stage 4 — Rewriter Agent (uses real papers per section)
  // ──────────────────────────────────────────────────────────

  const handleRunRewrite = async () => {
    if (!outline || !evidencePlan) return;
    setIsLoading(true);
    abortRef.current = false;
    setStage('rewrite');

    const sectionsToRewrite = outline.sections.filter(
      s => !!(draftsWithCU[s.name] || sectionDrafts[s.name]),
    );

    for (let i = 0; i < sectionsToRewrite.length; i++) {
      if (abortRef.current) break;
      const sec = sectionsToRewrite[i];
      const draft = draftsWithCU[sec.name] || sectionDrafts[sec.name];
      const sectionPlan = evidencePlan.plans.find(p => p.sectionName === sec.name);

      resetStream();
      setActiveSection(sec.name);
      setStatusMsg(`"${sec.name}" 재작성 중... (${i + 1}/${sectionsToRewrite.length})`);

      try {
        const rewritten = await runRewriterAgent(
          outline,
          sec.name,
          draft,
          sectionPlan?.claims ?? [],
          claimArticles,
          appendStream,
          apiKey,
        );
        setRewrittenDrafts(prev => ({ ...prev, [sec.name]: rewritten }));
      } catch (e: any) {
        setStatusMsg('오류: ' + (e.message ?? ''));
        break;
      }
    }

    setStatusMsg('재작성 완료! 리뷰 단계로 이동하세요.');
    setIsLoading(false);
  };

  // ──────────────────────────────────────────────────────────
  // Stage 5 — Review Agent
  // ──────────────────────────────────────────────────────────

  const handleRunReview = async () => {
    if (!outline) return;
    const assembled = assembleFinalPaper(outline, sectionDrafts, rewrittenDrafts);
    setIsLoading(true);
    resetStream();
    setStage('review');
    setStatusMsg('리뷰 에이전트(Reviewer #2)가 논문을 검토 중...');
    try {
      const result = await runReviewAgent(outline, assembled, appendStream, apiKey);
      setReviewResult(result);
      setFinalPaper(assembled);
      setStage('done');
      setStatusMsg('리뷰 완료! 완성 논문을 확인하세요.');
    } catch (e: any) {
      setStatusMsg('오류: ' + (e.message ?? ''));
    } finally {
      setIsLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────
  // Export / Reset
  // ──────────────────────────────────────────────────────────

  const handleExport = () => {
    const blob = new Blob([finalPaper], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${outline?.title ?? '논문'}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyFinal = () => navigator.clipboard.writeText(finalPaper);

  const handleReset = () => {
    setStage('input');
    setOutline(null);
    setSectionDrafts({});
    setEvidencePlan(null);
    setDraftsWithCU({});
    setClaimArticles({});
    setClaimFetchStatus({});
    setRewrittenDrafts({});
    setReviewResult(null);
    setFinalPaper('');
    setResearchInput('');
    setKeywords('');
    setStatusMsg('');
    resetStream();
  };

  // ──────────────────────────────────────────────────────────
  // Derived state helpers
  // ──────────────────────────────────────────────────────────

  const hasDraft = (name: string) => !!sectionDrafts[name];
  const hasRewrite = (name: string) => !!rewrittenDrafts[name];
  const allDrafted = outline ? outline.sections.every(s => hasDraft(s.name)) : false;
  const allRewritten = outline
    ? outline.sections.every(s => hasRewrite(s.name) || !hasDraft(s.name))
    : false;

  // ──────────────────────────────────────────────────────────
  // Stage indicator
  // ──────────────────────────────────────────────────────────

  const VISIBLE_STAGES: Stage[] = ['input', 'outline', 'writing', 'evidence', 'rewrite', 'review', 'done'];
  const ALL_STAGES: Stage[] = ['apikey', 'input', 'outline', 'writing', 'evidence', 'rewrite', 'review', 'done'];

  const StageIndicator = () => {
    const currentIdx = ALL_STAGES.indexOf(stage);
    return (
      <div className="flex gap-1 overflow-x-auto py-2 no-scrollbar mb-4">
        {VISIBLE_STAGES.map(s => {
          const idx = ALL_STAGES.indexOf(s);
          const isActive = s === stage;
          const isDone = idx < currentIdx;
          return (
            <div
              key={s}
              className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all
                ${isActive
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : isDone
                  ? 'bg-slate-800 border-slate-700 text-green-400'
                  : 'bg-slate-900 border-slate-800 text-slate-600'}`}
            >
              <i className={`fas ${isDone ? 'fa-check' : STAGE_ICONS[s]} text-[10px]`}></i>
              <span>{STAGE_LABELS[s]}</span>
            </div>
          );
        })}
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────
  // Stream box
  // ──────────────────────────────────────────────────────────

  const StreamBox = () => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-violet-400 text-xs">
        <i className="fas fa-circle-notch fa-spin"></i>
        <span>{statusMsg}</span>
      </div>
      {streamBuffer && (
        <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 max-h-40 overflow-y-auto text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed font-mono">
          {streamBuffer}
        </div>
      )}
    </div>
  );

  // ──────────────────────────────────────────────────────────
  // Stage renders
  // ──────────────────────────────────────────────────────────

  const renderApiKey = () => (
    <div className="space-y-6">
      <div className="p-4 bg-violet-950/30 rounded-2xl border border-violet-500/20">
        <h2 className="text-base font-bold text-violet-300 mb-2 flex items-center gap-2">
          <i className="fas fa-scroll text-sm"></i> 자동 논문 작성기
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Claude AI (claude-opus-4-6)가 6단계 파이프라인으로 논문을 작성합니다.
          PubMed 실증 근거를 자동으로 검색·인용합니다.
        </p>
      </div>
      <div className="p-4 bg-yellow-950/20 rounded-xl border border-yellow-500/20 text-xs text-yellow-400 leading-relaxed">
        <i className="fas fa-triangle-exclamation mr-2"></i>
        API 키는 이 기기의 localStorage에만 저장됩니다. 서버로 전송되지 않습니다.
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Anthropic API Key</label>
        <div className="relative">
          <input
            type={apiKeyVisible ? 'text' : 'password'}
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-200 placeholder:text-slate-700 outline-none focus:border-violet-500 transition-colors pr-12"
            onKeyDown={e => { if (e.key === 'Enter') saveApiKey(); }}
          />
          <button
            onClick={() => setApiKeyVisible(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <i className={`fas ${apiKeyVisible ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i>
          </button>
        </div>
        <p className="text-[10px] text-slate-500">
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">
            console.anthropic.com
          </a>에서 발급받을 수 있습니다.
        </p>
      </div>
      <button
        onClick={saveApiKey}
        disabled={!apiKeyInput.trim()}
        className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl font-bold text-base transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <i className="fas fa-arrow-right"></i>API 키 저장 후 시작
      </button>
    </div>
  );

  // ── Input ────────────────────────────────────────────────

  const renderInput = () => (
    <div className="space-y-6">
      <div className="p-4 bg-violet-950/30 rounded-2xl border border-violet-500/20">
        <h2 className="text-base font-bold text-violet-300 mb-1 flex items-center gap-2">
          <i className="fas fa-flask text-sm"></i> 자동 논문 작성기
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          아웃라인 → 초안 → <span className="text-emerald-400 font-medium">PubMed 실증 근거 수집</span> → 재작성 → 리뷰
        </p>
        <button onClick={() => setStage('apikey')} className="mt-2 text-[10px] text-violet-400/70 hover:text-violet-400">
          <i className="fas fa-key mr-1"></i>API 키 변경
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          연구 내용 <span className="text-red-400">*</span>
        </label>
        <textarea
          value={researchInput}
          onChange={e => setResearchInput(e.target.value)}
          placeholder={`연구 데이터, 가설, 핵심 아이디어를 상세히 입력하세요.\n\n예시:\n- 연구 주제: SNS 사용 시간과 청소년 수면 장애의 상관관계\n- 가설: 일일 SNS 사용 3시간 이상 시 수면 지연 증가\n- 데이터: 서울 중고등학생 500명 설문, 수면다원검사 결과\n- 주요 발견: 사용 시간과 멜라토닌 억제 정도 r=0.72 양의 상관`}
          className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-sm text-slate-200 placeholder:text-slate-700 resize-none min-h-[200px] outline-none focus:border-violet-500 transition-colors leading-relaxed"
          rows={8}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">핵심 키워드 (PubMed 검색에 사용)</label>
        <input
          type="text"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="예: sleep, adolescents, smartphone, melatonin"
          className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-700 outline-none focus:border-violet-500 transition-colors"
        />
      </div>

      <button
        onClick={handleGenerateOutline}
        disabled={!researchInput.trim() || isLoading}
        className="w-full py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl font-bold text-base transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <i className="fas fa-sitemap"></i>1단계: 아웃라인 생성 시작
      </button>
    </div>
  );

  // ── Outline ──────────────────────────────────────────────

  const renderOutline = () => (
    <div className="space-y-4">
      {isLoading && !outline && <StreamBox />}
      {outline && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900 rounded-2xl border border-violet-500/30">
            <h2 className="text-lg font-bold text-violet-300 mb-1">{outline.title}</h2>
            <p className="text-sm text-slate-400 leading-relaxed">{outline.abstract}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">섹션 구성</p>
            {outline.sections.map((section, i) => (
              <div key={section.name} className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-600/20 text-violet-400 text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-200 text-sm">{section.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{section.keyArgument}</p>
                    {section.visualizationSuggestion && (
                      <p className="text-xs text-blue-400 mt-1 flex items-center gap-1">
                        <i className="fas fa-chart-bar text-[10px]"></i>
                        {section.visualizationSuggestion}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {outline.visualizations.length > 0 && (
            <div className="p-3 bg-blue-950/20 rounded-xl border border-blue-500/20">
              <p className="text-xs font-bold text-blue-400 uppercase mb-2">시각화 제안</p>
              {outline.visualizations.map((v, i) => (
                <p key={i} className="text-xs text-slate-400 flex items-center gap-2 mb-1">
                  <i className="fas fa-table-columns text-blue-500/60 text-[10px]"></i>{v}
                </p>
              ))}
            </div>
          )}

          <button
            onClick={handleWriteAll}
            disabled={isLoading}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-file-lines"></i>2단계: 전체 섹션 초안 작성
          </button>
        </div>
      )}
    </div>
  );

  // ── Writing ──────────────────────────────────────────────

  const renderWriting = () => (
    <div className="space-y-4">
      {outline && (
        <div className="grid grid-cols-3 gap-2">
          {outline.sections.map(section => (
            <div
              key={section.name}
              className={`p-2 rounded-xl text-center text-[11px] font-medium border transition-all
                ${activeSection === section.name && isLoading
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300 animate-pulse'
                  : hasDraft(section.name)
                  ? 'bg-green-900/20 border-green-500/30 text-green-400'
                  : 'bg-slate-900 border-slate-800 text-slate-500'}`}
            >
              {activeSection === section.name && isLoading
                ? <><i className="fas fa-spinner fa-spin mr-1 text-[10px]"></i>작성 중</>
                : hasDraft(section.name)
                ? <><i className="fas fa-check mr-1 text-[10px]"></i>{section.name}</>
                : section.name}
            </div>
          ))}
        </div>
      )}

      {isLoading && <StreamBox />}

      {outline && Object.keys(sectionDrafts).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">작성된 초안</p>
          {outline.sections.filter(s => hasDraft(s.name)).map(section => (
            <details key={section.name} className="group bg-slate-900 rounded-xl border border-slate-800">
              <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                <span className="font-medium text-slate-200 text-sm flex items-center gap-2">
                  <i className="fas fa-check-circle text-green-400 text-xs"></i>
                  {section.name}
                </span>
                <i className="fas fa-chevron-down text-slate-600 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <div className="px-3 pb-3 pt-1 border-t border-slate-800">
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{sectionDrafts[section.name]}</p>
              </div>
            </details>
          ))}
        </div>
      )}

      {outline && !isLoading && outline.sections.filter(s => !hasDraft(s.name)).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">미작성 섹션 개별 작성:</p>
          {outline.sections.filter(s => !hasDraft(s.name)).map(section => (
            <button
              key={section.name}
              onClick={() => handleWriteSection(section.name)}
              disabled={isLoading}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 text-left disabled:opacity-40 transition-all border border-slate-700"
            >
              <i className="fas fa-pen mr-2 text-violet-400 text-xs"></i>{section.name} 작성
            </button>
          ))}
        </div>
      )}

      {allDrafted && !isLoading && (
        <div className="pt-2">
          <div className="h-px bg-slate-800 mb-3"></div>
          <button
            onClick={handleRunEvidence}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-microscope"></i>3단계: PubMed 실증 근거 수집
          </button>
        </div>
      )}
    </div>
  );

  // ── Evidence ─────────────────────────────────────────────

  const renderEvidence = () => {
    const allClaims = evidencePlan?.plans.flatMap(p => p.claims) ?? [];
    const fetchedCount = allClaims.filter(c => claimFetchStatus[c.id] === 'done').length;
    const totalArticles = allClaims.reduce((sum, c) => sum + (claimArticles[c.id]?.length ?? 0), 0);

    return (
      <div className="space-y-4">
        {isLoading && <StreamBox />}

        {/* Progress summary */}
        {allClaims.length > 0 && (
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                <i className="fas fa-microscope text-[10px]"></i>
                PubMed 수집 현황
              </span>
              <span className="text-xs text-slate-400">
                {fetchedCount}/{allClaims.length} 완료 · 논문 {totalArticles}편
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: allClaims.length ? `${(fetchedCount / allClaims.length) * 100}%` : '0%' }}
              ></div>
            </div>
          </div>
        )}

        {/* Per-section claim cards */}
        {evidencePlan?.plans.map(planSection => (
          <details key={planSection.sectionName} className="group bg-slate-900 rounded-xl border border-slate-800" open>
            <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
              <span className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                <i className="fas fa-book-open text-violet-400 text-xs"></i>
                {planSection.sectionName}
                <span className="text-xs text-slate-500 font-normal">
                  ({planSection.claims.length}개 주장)
                </span>
              </span>
              <i className="fas fa-chevron-down text-slate-600 text-xs group-open:rotate-180 transition-transform"></i>
            </summary>

            <div className="px-3 pb-3 pt-2 border-t border-slate-800 space-y-3">
              {planSection.claims.map(claim => {
                const status = claimFetchStatus[claim.id] ?? 'pending';
                const arts = claimArticles[claim.id] ?? [];
                return (
                  <div key={claim.id} className="space-y-2">
                    {/* Claim header */}
                    <div className="flex items-start gap-2">
                      <span className="flex-shrink-0 text-[10px] font-bold text-violet-400 font-mono bg-violet-900/30 px-1.5 py-0.5 rounded border border-violet-500/30 mt-0.5">
                        {claim.placeholder}
                      </span>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium mt-0.5 ${NEED_TYPE_COLORS[claim.neededType] ?? ''}`}>
                        {claim.neededType}
                      </span>
                      <p className="text-xs text-slate-400 leading-relaxed flex-1 min-w-0">{claim.text}</p>
                    </div>

                    {/* Query */}
                    <div className="flex items-center gap-2 bg-slate-950 rounded-lg px-2 py-1.5 ml-2">
                      <i className="fas fa-magnifying-glass text-slate-600 text-[10px] flex-shrink-0"></i>
                      <code className="text-[10px] text-slate-400 flex-1 truncate">{claim.searchQuery}</code>
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(claim.searchQuery)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium flex-shrink-0"
                      >
                        PubMed →
                      </a>
                    </div>

                    {/* Fetch status / articles */}
                    {status === 'pending' && (
                      <p className="text-[10px] text-slate-600 ml-2 flex items-center gap-1">
                        <i className="fas fa-clock text-[9px]"></i>대기 중
                      </p>
                    )}
                    {status === 'fetching' && (
                      <p className="text-[10px] text-violet-400 ml-2 flex items-center gap-1 animate-pulse">
                        <i className="fas fa-spinner fa-spin text-[9px]"></i>PubMed 검색 중...
                      </p>
                    )}
                    {status === 'empty' && (
                      <p className="text-[10px] text-orange-400 ml-2 flex items-center gap-1">
                        <i className="fas fa-triangle-exclamation text-[9px]"></i>
                        검색 결과 없음 — 재작성 시 이 인용 자리표시자는 제거됩니다
                      </p>
                    )}
                    {status === 'done' && arts.length > 0 && (
                      <div className="ml-2 space-y-1.5">
                        <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                          <i className="fas fa-check text-[9px]"></i>{arts.length}편 확보
                        </p>
                        {arts.map(art => <ArticleCard key={art.pmid} art={art} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        ))}

        {/* Next step */}
        {!isLoading && evidencePlan && (
          <div className="pt-2">
            <div className="h-px bg-slate-800 mb-3"></div>
            <button
              onClick={handleRunRewrite}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <i className="fas fa-pen-nib"></i>
              4단계: 실증 근거로 섹션 재작성
            </button>
          </div>
        )}

        {/* Button to retry if not yet started (fallback) */}
        {!isLoading && !evidencePlan && (
          <button
            onClick={handleRunEvidence}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-microscope"></i>근거 수집 시작
          </button>
        )}
      </div>
    );
  };

  // ── Rewrite ──────────────────────────────────────────────

  const renderRewrite = () => (
    <div className="space-y-4">
      {outline && (
        <div className="grid grid-cols-3 gap-2">
          {outline.sections.map(section => (
            <div
              key={section.name}
              className={`p-2 rounded-xl text-center text-[11px] font-medium border transition-all
                ${activeSection === section.name && isLoading
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300 animate-pulse'
                  : hasRewrite(section.name)
                  ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-400'
                  : hasDraft(section.name)
                  ? 'bg-slate-900 border-slate-700 text-slate-500'
                  : 'bg-slate-950 border-slate-800 text-slate-700'}`}
            >
              {activeSection === section.name && isLoading
                ? <><i className="fas fa-spinner fa-spin mr-1 text-[10px]"></i>재작성</>
                : hasRewrite(section.name)
                ? <><i className="fas fa-check mr-1 text-[10px]"></i>{section.name}</>
                : section.name}
            </div>
          ))}
        </div>
      )}

      {isLoading && <StreamBox />}

      {outline && Object.keys(rewrittenDrafts).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">재작성된 섹션 (실증 인용 포함)</p>
          {outline.sections.filter(s => hasRewrite(s.name)).map(section => (
            <details key={section.name} className="group bg-slate-900 rounded-xl border border-slate-800">
              <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                <span className="font-medium text-slate-200 text-sm flex items-center gap-2">
                  <i className="fas fa-check-circle text-emerald-400 text-xs"></i>
                  {section.name}
                  <span className="text-[10px] text-emerald-400/70 font-normal">PubMed 인용 포함</span>
                </span>
                <i className="fas fa-chevron-down text-slate-600 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <div className="px-3 pb-3 pt-1 border-t border-slate-800">
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{rewrittenDrafts[section.name]}</p>
              </div>
            </details>
          ))}
        </div>
      )}

      {allRewritten && !isLoading && (
        <div className="pt-2">
          <div className="h-px bg-slate-800 mb-3"></div>
          <button
            onClick={handleRunReview}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-magnifying-glass"></i>5단계: 리뷰 에이전트 실행
          </button>
        </div>
      )}
    </div>
  );

  // ── Review ───────────────────────────────────────────────

  const renderReview = () => (
    <div className="space-y-4">
      {isLoading && <StreamBox />}

      {reviewResult && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900 rounded-2xl border border-slate-700 flex items-center gap-4">
            <div className="text-center flex-shrink-0">
              <div className={`text-4xl font-black ${
                reviewResult.overallScore >= 8 ? 'text-green-400'
                : reviewResult.overallScore >= 6 ? 'text-yellow-400'
                : 'text-red-400'
              }`}>{reviewResult.overallScore}</div>
              <div className="text-xs text-slate-500">/10</div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-widest">전체 흐름 평가</p>
              <p className="text-sm text-slate-300 leading-relaxed">{reviewResult.flowEvaluation}</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              리뷰 의견 ({reviewResult.comments.length}개)
            </p>
            {reviewResult.comments.map((comment, i) => (
              <div key={i} className={`p-3 rounded-xl border ${REVIEW_TYPE_COLORS[comment.type]}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase">{REVIEW_TYPE_LABELS[comment.type]}</span>
                  <span className="text-[10px] opacity-70 truncate flex-1">{comment.location}</span>
                </div>
                <p className="text-xs mb-1.5 opacity-90">{comment.issue}</p>
                <p className="text-xs font-medium flex items-start gap-1.5">
                  <i className="fas fa-arrow-right mt-0.5 opacity-60 text-[10px] flex-shrink-0"></i>
                  {comment.suggestion}
                </p>
              </div>
            ))}
          </div>

          {reviewResult.revisedPassages.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">수정 제안</p>
              {reviewResult.revisedPassages.map((passage, i) => (
                <div key={i} className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                  <div className="px-3 py-2 bg-red-900/10 border-b border-slate-800">
                    <p className="text-xs text-red-400 line-through opacity-80 leading-relaxed">{passage.original}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs text-green-400 leading-relaxed">{passage.revised}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Done ────────────────────────────────────────────────

  const renderDone = () => (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={handleCopyFinal}
          className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-95 border border-slate-700"
        >
          <i className="fas fa-copy text-violet-400 text-xs"></i>복사
        </button>
        <button
          onClick={handleExport}
          className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <i className="fas fa-download text-xs"></i>.md 다운로드
        </button>
      </div>

      {reviewResult && (
        <div className="p-3 bg-emerald-950/20 rounded-xl border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
          <i className="fas fa-certificate"></i>
          PubMed 실증 인용 포함 완성 논문 · 리뷰 점수 {reviewResult.overallScore}/10
        </div>
      )}

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 max-h-[55vh] overflow-y-auto">
        <pre className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">{finalPaper}</pre>
      </div>

      <button
        onClick={handleReset}
        className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-2xl font-bold text-slate-300 transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <i className="fas fa-plus"></i>새 논문 작성
      </button>
    </div>
  );

  // ──────────────────────────────────────────────────────────
  // Main render
  // ──────────────────────────────────────────────────────────

  return (
    <Layout
      onBack={onBack}
      title="논문 작성기"
      rightAction={
        isLoading ? (
          <button
            onClick={() => { abortRef.current = true; setIsLoading(false); setStatusMsg('중단됨'); }}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-red-900/30 text-red-400 border border-red-500/30"
            title="중단"
          >
            <i className="fas fa-stop text-xs"></i>
          </button>
        ) : undefined
      }
    >
      {VISIBLE_STAGES.includes(stage) && <StageIndicator />}

      {statusMsg && !isLoading && (
        <div className="mb-4 px-3 py-2 bg-slate-900 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
          <i className="fas fa-circle-check text-green-400 text-[10px]"></i>
          {statusMsg}
        </div>
      )}

      {stage === 'apikey'   && renderApiKey()}
      {stage === 'input'    && renderInput()}
      {stage === 'outline'  && renderOutline()}
      {stage === 'writing'  && renderWriting()}
      {stage === 'evidence' && renderEvidence()}
      {stage === 'rewrite'  && renderRewrite()}
      {stage === 'review'   && renderReview()}
      {stage === 'done'     && renderDone()}
    </Layout>
  );
};

export default PaperWriter;
