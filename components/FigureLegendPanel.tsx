import React, { useState, useRef, useCallback, useId } from 'react';
import { generateFigureLegend, ImageMimeType } from '../services/figureService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FigureItem {
  id: string;
  dataUrl: string;        // for <img src>
  base64: string;         // for API
  mimeType: ImageMimeType;
  figureNumber: number;
  sectionName: string;
  context: string;
  legend: string;
  streamBuffer: string;
  isGenerating: boolean;
  showContext: boolean;
  copied: boolean;
}

interface Props {
  apiKey: string;
  paperTitle?: string;
  sections?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

function isAccepted(mime: string): mime is ImageMimeType {
  return ACCEPTED.includes(mime);
}

function readFileAsBase64(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(',')[1] ?? '';
      resolve({ base64, dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const FigureLegendPanel: React.FC<Props> = ({ apiKey, paperTitle = '', sections = [] }) => {
  const [figures, setFigures] = useState<FigureItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [sizeWarning, setSizeWarning] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  // ── Update a single figure field ──────────────────────────────────────────

  const update = useCallback(<K extends keyof FigureItem>(id: string, key: K, value: FigureItem[K]) => {
    setFigures(prev => prev.map(f => f.id === id ? { ...f, [key]: value } : f));
  }, []);

  // ── Process dropped / selected files ─────────────────────────────────────

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setSizeWarning('');
    const arr = Array.from(files);
    const oversized = arr.filter(f => f.size > MAX_BYTES);
    if (oversized.length > 0) {
      setSizeWarning(`⚠️ ${oversized.map(f => f.name).join(', ')} — 4 MB 초과 파일은 건너뜁니다.`);
    }
    const valid = arr.filter(f => isAccepted(f.type) && f.size <= MAX_BYTES);

    setFigures(prev => {
      const nextNum = prev.length + 1;
      return prev; // placeholder — updated after async reads below
      void nextNum;
    });

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      try {
        const { base64, dataUrl } = await readFileAsBase64(file);
        const newItem: FigureItem = {
          id: `${uid}-${Date.now()}-${i}`,
          dataUrl,
          base64,
          mimeType: file.type as ImageMimeType,
          figureNumber: 0,       // assigned below
          sectionName: sections[0] ?? '',
          context: '',
          legend: '',
          streamBuffer: '',
          isGenerating: false,
          showContext: false,
          copied: false,
        };
        setFigures(prev => {
          const nextNum = prev.length + 1;
          return [...prev, { ...newItem, figureNumber: nextNum }];
        });
      } catch {
        // skip unreadable file
      }
    }
  }, [uid, sections]);

  // ── File input change ─────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = ''; // reset so same file can be re-added
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  };

  // ── Delete figure ─────────────────────────────────────────────────────────

  const deleteFigure = (id: string) => {
    setFigures(prev => {
      const next = prev.filter(f => f.id !== id);
      // Renumber sequentially
      return next.map((f, i) => ({ ...f, figureNumber: i + 1 }));
    });
  };

  // ── Generate legend ───────────────────────────────────────────────────────

  const handleGenerate = async (id: string) => {
    const fig = figures.find(f => f.id === id);
    if (!fig || fig.isGenerating) return;

    update(id, 'isGenerating', true);
    update(id, 'streamBuffer', '');
    update(id, 'legend', '');

    try {
      const legend = await generateFigureLegend(
        fig.base64,
        fig.mimeType,
        fig.figureNumber,
        paperTitle,
        fig.sectionName,
        fig.context,
        (chunk) => {
          setFigures(prev =>
            prev.map(f => f.id === id ? { ...f, streamBuffer: f.streamBuffer + chunk } : f),
          );
        },
        apiKey,
      );
      setFigures(prev =>
        prev.map(f => f.id === id ? { ...f, legend, streamBuffer: '', isGenerating: false } : f),
      );
    } catch (e: any) {
      setFigures(prev =>
        prev.map(f =>
          f.id === id
            ? { ...f, legend: `오류: ${e.message ?? '알 수 없는 오류'}`, streamBuffer: '', isGenerating: false }
            : f,
        ),
      );
    }
  };

  // ── Copy legend ───────────────────────────────────────────────────────────

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    update(id, 'copied', true);
    setTimeout(() => update(id, 'copied', false), 2000);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="p-3 bg-violet-950/30 rounded-2xl border border-violet-500/20">
        <h2 className="text-sm font-bold text-violet-300 flex items-center gap-2 mb-1">
          <i className="fas fa-image text-xs"></i>Figure Legend 생성기
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          PPT에서 내보낸 그림 파일을 업로드하면 Claude가 국제 학술지 수준의
          영어 figure legend를 자동 작성합니다.
        </p>
      </div>

      {/* Size warning */}
      {sizeWarning && (
        <div className="px-3 py-2 bg-orange-950/20 rounded-xl border border-orange-500/20 text-xs text-orange-400">
          {sizeWarning}
        </div>
      )}

      {/* Upload area */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all select-none
          ${isDragging
            ? 'border-violet-400 bg-violet-900/20'
            : 'border-slate-700 hover:border-slate-600 bg-slate-900/40 hover:bg-slate-900/60'}`}
      >
        <i className={`fas fa-cloud-arrow-up text-2xl ${isDragging ? 'text-violet-400' : 'text-slate-600'}`}></i>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-300">클릭하거나 파일을 여기에 드롭</p>
          <p className="text-xs text-slate-600 mt-1">PNG · JPEG · GIF · WebP · 최대 4 MB</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Figure cards */}
      {figures.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            업로드된 그림 ({figures.length}개)
          </p>

          {figures.map(fig => (
            <div key={fig.id} className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">

              {/* Card top row: thumbnail + controls */}
              <div className="flex gap-3 p-3">

                {/* Thumbnail */}
                <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                  <img
                    src={fig.dataUrl}
                    alt={`Figure ${fig.figureNumber}`}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Right controls */}
                <div className="flex-1 min-w-0 space-y-2">

                  {/* Figure number + section */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-2 py-1 border border-slate-700 flex-shrink-0">
                      <span className="text-[10px] text-slate-500 font-medium">Fig.</span>
                      <input
                        type="number"
                        min={1}
                        value={fig.figureNumber}
                        onChange={e => update(fig.id, 'figureNumber', parseInt(e.target.value) || 1)}
                        className="w-8 bg-transparent text-sm font-bold text-violet-300 outline-none text-center"
                      />
                    </div>

                    {sections.length > 0 ? (
                      <select
                        value={fig.sectionName}
                        onChange={e => update(fig.id, 'sectionName', e.target.value)}
                        className="flex-1 min-w-0 bg-slate-800 text-xs text-slate-300 rounded-lg px-2 py-1.5 border border-slate-700 outline-none"
                      >
                        <option value="">섹션 선택</option>
                        {sections.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={fig.sectionName}
                        onChange={e => update(fig.id, 'sectionName', e.target.value)}
                        placeholder="섹션명 (예: Results)"
                        className="flex-1 min-w-0 bg-slate-800 text-xs text-slate-300 rounded-lg px-2 py-1.5 border border-slate-700 outline-none placeholder:text-slate-700"
                      />
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => deleteFigure(fig.id)}
                      disabled={fig.isGenerating}
                      className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-30"
                      title="삭제"
                    >
                      <i className="fas fa-xmark text-xs"></i>
                    </button>
                  </div>

                  {/* Additional context toggle */}
                  <button
                    onClick={() => update(fig.id, 'showContext', !fig.showContext)}
                    className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
                  >
                    <i className={`fas fa-chevron-${fig.showContext ? 'up' : 'down'} text-[8px]`}></i>
                    추가 정보 {fig.showContext ? '접기' : '입력 (선택)'}
                  </button>

                  {fig.showContext && (
                    <textarea
                      value={fig.context}
                      onChange={e => update(fig.id, 'context', e.target.value)}
                      placeholder="예: n=30 mice per group, scale bar=100μm, error bars=SEM, measured at 24h post-treatment"
                      rows={2}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 placeholder:text-slate-700 resize-none outline-none focus:border-violet-500 transition-colors leading-relaxed"
                    />
                  )}
                </div>
              </div>

              {/* Generate button */}
              <div className="px-3 pb-3">
                <button
                  onClick={() => handleGenerate(fig.id)}
                  disabled={fig.isGenerating}
                  className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {fig.isGenerating
                    ? <><i className="fas fa-circle-notch fa-spin text-xs"></i>Legend 생성 중...</>
                    : fig.legend
                    ? <><i className="fas fa-rotate-right text-xs"></i>Legend 재생성</>
                    : <><i className="fas fa-wand-magic-sparkles text-xs"></i>Legend 생성</>}
                </button>
              </div>

              {/* Streaming preview */}
              {fig.isGenerating && fig.streamBuffer && (
                <div className="px-3 pb-3">
                  <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 max-h-32 overflow-y-auto text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed font-mono">
                    {fig.streamBuffer}
                    <span className="inline-block w-1.5 h-3 bg-violet-400 animate-pulse ml-0.5 align-middle"></span>
                  </div>
                </div>
              )}

              {/* Final legend */}
              {fig.legend && !fig.isGenerating && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                      <i className="fas fa-check-circle text-[10px]"></i>생성된 Legend
                    </span>
                    <button
                      onClick={() => handleCopy(fig.id, fig.legend)}
                      className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                        fig.copied
                          ? 'text-green-400 border-green-500/30 bg-green-900/20'
                          : 'text-slate-400 border-slate-700 hover:border-violet-500/50 hover:text-violet-400'
                      }`}
                    >
                      <i className={`fas ${fig.copied ? 'fa-check' : 'fa-copy'} text-[9px]`}></i>
                      {fig.copied ? '복사됨' : '복사'}
                    </button>
                  </div>
                  <div className="bg-slate-950 rounded-xl p-3 border border-emerald-500/20">
                    <pre className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-sans">
                      {fig.legend}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {figures.length === 0 && (
        <div className="text-center py-6 text-slate-600 space-y-2">
          <i className="fas fa-chart-bar text-3xl block"></i>
          <p className="text-xs">PPT 슬라이드에서 그림을 PNG/JPEG로 저장한 후<br />위 영역에 업로드하세요.</p>
        </div>
      )}
    </div>
  );
};

export default FigureLegendPanel;
