import React, { useState, useRef, useCallback } from 'react';
import {
  runOutlineAgent,
  runWritingAgent,
  runCitationAgent,
  runReviewAgent,
  assembleFinalPaper,
  PaperOutline,
  CitationEnhancement,
  ReviewResult,
  ReviewComment,
} from '../services/paperService';
import Layout from './Layout';

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

type Stage = 'apikey' | 'input' | 'outline' | 'writing' | 'citation' | 'review' | 'done';

const STAGE_LABELS: Record<Stage, string> = {
  apikey: 'API 키',
  input: '연구 입력',
  outline: '1단계',
  writing: '2단계',
  citation: '3단계',
  review: '4단계',
  done: '완성',
};

const STAGE_ICONS: Record<Stage, string> = {
  apikey: 'fa-key',
  input: 'fa-pen-to-square',
  outline: 'fa-sitemap',
  writing: 'fa-file-lines',
  citation: 'fa-quote-right',
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

// ──────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

const PaperWriter: React.FC<Props> = ({ onBack }) => {
  // ── API Key ──
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('anthropic_api_key') || '');
  const [apiKeyInput, setApiKeyInput] = useState(apiKey);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  // ── Stages ──
  const [stage, setStage] = useState<Stage>(apiKey ? 'input' : 'apikey');
  const [researchInput, setResearchInput] = useState('');
  const [keywords, setKeywords] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [streamBuffer, setStreamBuffer] = useState('');

  // ── Paper data ──
  const [outline, setOutline] = useState<PaperOutline | null>(null);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, string>>({});
  const [citationEnhancements, setCitationEnhancements] = useState<Record<string, CitationEnhancement>>({});
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [finalPaper, setFinalPaper] = useState('');

  // ── Active section tracking ──
  const [activeSection, setActiveSection] = useState<string>('');
  const [activeCitationSection, setActiveCitationSection] = useState<string>('');

  const abortRef = useRef(false);

  // ── helpers ──

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

  // ──────────────────────────────────────────────────────
  // Stage runners
  // ──────────────────────────────────────────────────────

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
      setStatusMsg('오류: ' + (e.message || '알 수 없는 오류'));
    } finally {
      setIsLoading(false);
    }
  };

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
      setStatusMsg('오류: ' + (e.message || '알 수 없는 오류'));
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
      const section = outline.sections[i];
      resetStream();
      setActiveSection(section.name);
      setStatusMsg(`"${section.name}" 섹션 집필 중... (${i + 1}/${outline.sections.length})`);
      try {
        const draft = await runWritingAgent(outline, section.name, researchInput, appendStream, apiKey);
        setSectionDrafts(prev => ({ ...prev, [section.name]: draft }));
      } catch (e: any) {
        setStatusMsg('오류: ' + (e.message || ''));
        break;
      }
    }
    setStatusMsg('모든 섹션 초안 완성! 인용 강화 단계로 이동하세요.');
    setIsLoading(false);
  };

  const handleEnhanceCitations = async (sectionName: string) => {
    if (!sectionDrafts[sectionName]) return;
    setIsLoading(true);
    resetStream();
    setActiveCitationSection(sectionName);
    setStage('citation');
    setStatusMsg(`"${sectionName}" 인용 강화 중...`);
    try {
      const result = await runCitationAgent(
        sectionName,
        sectionDrafts[sectionName],
        keywords || researchInput.slice(0, 200),
        appendStream,
        apiKey,
      );
      setCitationEnhancements(prev => ({ ...prev, [sectionName]: result }));
      setStatusMsg(`"${sectionName}" 인용 강화 완성!`);
    } catch (e: any) {
      setStatusMsg('오류: ' + (e.message || ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnhanceAllCitations = async () => {
    if (!outline) return;
    setIsLoading(true);
    setStage('citation');
    for (const section of outline.sections) {
      if (abortRef.current || !sectionDrafts[section.name]) continue;
      resetStream();
      setActiveCitationSection(section.name);
      setStatusMsg(`"${section.name}" 인용 강화 중...`);
      try {
        const result = await runCitationAgent(
          section.name,
          sectionDrafts[section.name],
          keywords || researchInput.slice(0, 200),
          appendStream,
          apiKey,
        );
        setCitationEnhancements(prev => ({ ...prev, [section.name]: result }));
      } catch (e: any) {
        setStatusMsg('오류: ' + (e.message || ''));
        break;
      }
    }
    setStatusMsg('모든 섹션 인용 강화 완성! 리뷰 단계로 이동하세요.');
    setIsLoading(false);
  };

  const handleRunReview = async () => {
    if (!outline) return;
    const assembled = assembleFinalPaper(outline, sectionDrafts, citationEnhancements);
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
      setStatusMsg('오류: ' + (e.message || ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([finalPaper], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${outline?.title || '논문'}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyFinal = () => {
    navigator.clipboard.writeText(finalPaper);
  };

  const handleReset = () => {
    setStage('input');
    setOutline(null);
    setSectionDrafts({});
    setCitationEnhancements({});
    setReviewResult(null);
    setFinalPaper('');
    setResearchInput('');
    setKeywords('');
    setStatusMsg('');
    resetStream();
  };

  // ──────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────

  const hasDraft = (name: string) => !!sectionDrafts[name];
  const hasCitation = (name: string) => !!citationEnhancements[name];
  const allDrafted = outline ? outline.sections.every(s => hasDraft(s.name)) : false;
  const allCited = outline
    ? outline.sections.every(s => hasCitation(s.name) || !hasDraft(s.name))
    : false;

  // ──────────────────────────────────────────────────────
  // Stage indicator
  // ──────────────────────────────────────────────────────

  const STAGES: Stage[] = ['apikey', 'input', 'outline', 'writing', 'citation', 'review', 'done'];

  const StageIndicator = () => {
    const currentIdx = STAGES.indexOf(stage);
    return (
      <div className="flex gap-1 overflow-x-auto py-2 no-scrollbar mb-4">
        {STAGES.filter(s => s !== 'apikey').map((s) => {
          const itemIdx = STAGES.indexOf(s);
          const isActive = s === stage;
          const isDone = itemIdx < currentIdx;
          return (
            <div
              key={s}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
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

  // ──────────────────────────────────────────────────────
  // Stream preview box
  // ──────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────
  // Render: API Key stage
  // ──────────────────────────────────────────────────────

  const renderApiKey = () => (
    <div className="space-y-6">
      <div className="p-4 bg-violet-950/30 rounded-2xl border border-violet-500/20">
        <h2 className="text-base font-bold text-violet-300 mb-2 flex items-center gap-2">
          <i className="fas fa-scroll text-sm"></i> 자동 논문 작성기
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Claude AI (claude-opus-4-6)가 4단계 파이프라인으로 논문을 자동 작성합니다.
          사용하려면 Anthropic API 키가 필요합니다.
        </p>
      </div>

      <div className="p-4 bg-yellow-950/20 rounded-xl border border-yellow-500/20 text-xs text-yellow-400 leading-relaxed">
        <i className="fas fa-triangle-exclamation mr-2"></i>
        API 키는 이 기기의 localStorage에만 저장됩니다. 서버로 전송되지 않습니다.
        API 비용이 발생할 수 있으니 주의하세요.
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
          API 키는 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-violet-400 underline">console.anthropic.com</a>에서 발급받을 수 있습니다.
        </p>
      </div>

      <button
        onClick={saveApiKey}
        disabled={!apiKeyInput.trim()}
        className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl font-bold text-base transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <i className="fas fa-arrow-right"></i>
        API 키 저장 후 시작
      </button>
    </div>
  );

  // ──────────────────────────────────────────────────────
  // Render: Input stage
  // ──────────────────────────────────────────────────────

  const renderInput = () => (
    <div className="space-y-6">
      <div className="p-4 bg-violet-950/30 rounded-2xl border border-violet-500/20">
        <h2 className="text-base font-bold text-violet-300 mb-1 flex items-center gap-2">
          <i className="fas fa-flask text-sm"></i> 자동 논문 작성기
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          연구 데이터·가설·아이디어를 입력하면 4단계 AI 에이전트가
          아웃라인 → 초안 → 인용 강화 → 품질 리뷰까지 자동으로 수행합니다.
        </p>
        <button
          onClick={() => setStage('apikey')}
          className="mt-2 text-[10px] text-violet-400/70 hover:text-violet-400"
        >
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
        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">핵심 키워드 (인용 검색에 사용)</label>
        <input
          type="text"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="예: SNS, 수면, 청소년, 멜라토닌, 스마트폰"
          className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-700 outline-none focus:border-violet-500 transition-colors"
        />
      </div>

      <button
        onClick={handleGenerateOutline}
        disabled={!researchInput.trim() || isLoading}
        className="w-full py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl font-bold text-base transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <i className="fas fa-sitemap"></i>
        1단계: 아웃라인 생성 시작
      </button>
    </div>
  );

  // ──────────────────────────────────────────────────────
  // Render: Outline stage
  // ──────────────────────────────────────────────────────

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
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-600/20 text-violet-400 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
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

          <div className="pt-2 space-y-2">
            <p className="text-xs text-slate-500 text-center">다음 단계로 진행하세요</p>
            <button
              onClick={handleWriteAll}
              disabled={isLoading}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <i className="fas fa-file-lines"></i>
              2단계: 전체 섹션 초안 작성
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ──────────────────────────────────────────────────────
  // Render: Writing stage
  // ──────────────────────────────────────────────────────

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
        <div className="pt-2 space-y-2">
          <div className="h-px bg-slate-800"></div>
          <button
            onClick={handleEnhanceAllCitations}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-quote-right"></i>
            3단계: 전체 인용 강화
          </button>
        </div>
      )}
    </div>
  );

  // ──────────────────────────────────────────────────────
  // Render: Citation stage
  // ──────────────────────────────────────────────────────

  const renderCitation = () => (
    <div className="space-y-4">
      {outline && (
        <div className="grid grid-cols-3 gap-2">
          {outline.sections.map(section => (
            <div
              key={section.name}
              className={`p-2 rounded-xl text-center text-[11px] font-medium border transition-all
                ${activeCitationSection === section.name && isLoading
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300 animate-pulse'
                  : hasCitation(section.name)
                  ? 'bg-green-900/20 border-green-500/30 text-green-400'
                  : hasDraft(section.name)
                  ? 'bg-slate-900 border-slate-700 text-slate-400'
                  : 'bg-slate-950 border-slate-800 text-slate-700'}`}
            >
              {activeCitationSection === section.name && isLoading
                ? <><i className="fas fa-spinner fa-spin mr-1 text-[10px]"></i>분석 중</>
                : hasCitation(section.name)
                ? <><i className="fas fa-check mr-1 text-[10px]"></i>{section.name}</>
                : section.name}
            </div>
          ))}
        </div>
      )}

      {isLoading && <StreamBox />}

      {Object.entries(citationEnhancements).map(([sectionName, enh]) => (
        <details key={sectionName} className="group bg-slate-900 rounded-xl border border-slate-800">
          <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
            <span className="font-medium text-slate-200 text-sm flex items-center gap-2">
              <i className="fas fa-quote-right text-violet-400 text-xs"></i>
              {sectionName} — {enh.refs.length}개 인용 제안
            </span>
            <i className="fas fa-chevron-down text-slate-600 text-xs group-open:rotate-180 transition-transform"></i>
          </summary>
          <div className="px-3 pb-3 pt-2 border-t border-slate-800 space-y-2">
            {enh.refs.map((ref, i) => (
              <div key={i} className="p-3 bg-slate-800/50 rounded-xl space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-violet-400 font-mono">{ref.placeholder}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                    ref.neededType === '지지 논문' ? 'text-green-400 bg-green-400/10 border-green-400/30'
                    : ref.neededType === '반대 논문' ? 'text-red-400 bg-red-400/10 border-red-400/30'
                    : ref.neededType === '방법론적 근거' ? 'text-blue-400 bg-blue-400/10 border-blue-400/30'
                    : 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
                  }`}>{ref.neededType}</span>
                </div>
                <p className="text-xs text-slate-400">{ref.explanation}</p>
                <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-2 py-1.5">
                  <i className="fas fa-magnifying-glass text-slate-500 text-[10px]"></i>
                  <code className="text-[11px] text-slate-300 flex-1 truncate">{ref.searchQuery}</code>
                  <button
                    onClick={() => {
                      window.open(
                        `https://scholar.google.com/scholar?q=${encodeURIComponent(ref.searchQuery)}`,
                        '_blank',
                      );
                    }}
                    className="text-[10px] text-violet-400 hover:text-violet-300 font-medium flex-shrink-0"
                  >
                    Scholar →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}

      {outline && !isLoading && outline.sections.filter(s => hasDraft(s.name) && !hasCitation(s.name)).map(section => (
        <button
          key={section.name}
          onClick={() => handleEnhanceCitations(section.name)}
          disabled={isLoading}
          className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 text-left border border-slate-700 disabled:opacity-40 transition-all"
        >
          <i className="fas fa-quote-right mr-2 text-violet-400 text-xs"></i>{section.name} 인용 분석
        </button>
      ))}

      {allCited && !isLoading && (
        <div className="pt-2">
          <button
            onClick={handleRunReview}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-2xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-magnifying-glass"></i>
            4단계: 리뷰 에이전트 실행
          </button>
        </div>
      )}
    </div>
  );

  // ──────────────────────────────────────────────────────
  // Render: Review stage
  // ──────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────
  // Render: Done stage
  // ──────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────
  // Main render
  // ──────────────────────────────────────────────────────

  const VISIBLE_STAGES: Stage[] = ['input', 'outline', 'writing', 'citation', 'review', 'done'];

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
      {/* Stage indicator (only after API key is saved) */}
      {VISIBLE_STAGES.includes(stage) && <StageIndicator />}

      {/* Status bar */}
      {statusMsg && !isLoading && (
        <div className="mb-4 px-3 py-2 bg-slate-900 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
          <i className="fas fa-circle-check text-green-400 text-[10px]"></i>
          {statusMsg}
        </div>
      )}

      {/* Stage content */}
      {stage === 'apikey' && renderApiKey()}
      {stage === 'input' && renderInput()}
      {stage === 'outline' && renderOutline()}
      {stage === 'writing' && renderWriting()}
      {stage === 'citation' && renderCitation()}
      {stage === 'review' && renderReview()}
      {stage === 'done' && renderDone()}
    </Layout>
  );
};

export default PaperWriter;
