
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DiaryEntry, AppView, MOODS } from './types';
import PasscodeLock from './components/PasscodeLock';
import Layout from './components/Layout';
import PaperWriter from './components/PaperWriter';
import { analyzeDiaryEntry } from './services/geminiService';
import { encryptData, decryptData } from './services/cryptoService';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.LOCK);
  const [showPaperWriter, setShowPaperWriter] = useState(false);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [currentEntry, setCurrentEntry] = useState<DiaryEntry | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passcode, setPasscode] = useState('1234');
  const [recoveryQuestion, setRecoveryQuestion] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // QR Code State
  const [showQR, setShowQR] = useState(false);
  const [manualURL, setManualURL] = useState('');
  const [copied, setCopied] = useState(false);

  // Initialize data
  useEffect(() => {
    const savedEntries = localStorage.getItem('moonlight_entries');
    if (savedEntries) setEntries(JSON.parse(savedEntries));

    const savedPass = localStorage.getItem('moonlight_pass');
    if (savedPass) setPasscode(savedPass);

    setRecoveryQuestion(localStorage.getItem('moonlight_q') || '');
    setRecoveryAnswer(localStorage.getItem('moonlight_a') || '');

    // Set initial manual URL if not a blob
    if (!window.location.href.startsWith('blob:')) {
      setManualURL(window.location.href);
    }
  }, []);

  const saveEntries = (newEntries: DiaryEntry[]) => {
    setEntries(newEntries);
    localStorage.setItem('moonlight_entries', JSON.stringify(newEntries));
  };

  const handleCreateNew = () => {
    const newId = Date.now().toString();
    const newEntry: DiaryEntry = {
      id: newId,
      date: new Date().toISOString(),
      title: '',
      content: '',
      mood: 'calm',
      tags: []
    };
    setCurrentEntry(newEntry);
    setView(AppView.EDITOR);
    setIsSearching(false);
    setSearchTerm('');
  };

  const handleSaveEntry = async (entry: DiaryEntry) => {
    setIsLoading(true);
    let finalEntry = { ...entry };

    if (!entry.aiAnalysis && entry.content.length > 10) {
      const analysis = await analyzeDiaryEntry(entry.content);
      if (analysis) {
        finalEntry = {
          ...finalEntry,
          title: entry.title || analysis.suggestedTitle,
          mood: analysis.mood || entry.mood,
          aiAnalysis: analysis.analysis
        };
      }
    }

    if (!finalEntry.title) {
        finalEntry.title = new Date(finalEntry.date).toLocaleDateString() + "의 일기";
    }

    const exists = entries.find(e => e.id === finalEntry.id);
    let updated;
    if (exists) {
      updated = entries.map(e => e.id === finalEntry.id ? finalEntry : e);
    } else {
      updated = [finalEntry, ...entries];
    }
    
    saveEntries(updated);
    setIsLoading(false);
    setView(AppView.LIST);
  };

  const handleDeleteEntry = (id: string) => {
    if (window.confirm("⚠️ 일기를 영구적으로 삭제하시겠습니까? 삭제된 일기는 복구할 수 없습니다.")) {
      const updated = entries.filter(e => e.id !== id);
      saveEntries(updated);
      setView(AppView.LIST);
    }
  };

  const handleBackup = async () => {
    try {
      const dataStr = JSON.stringify(entries);
      const encryptedBuffer = await encryptData(dataStr, passcode);
      const blob = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diary_backup_${new Date().toISOString().slice(0, 10)}.moonlight`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("백업 생성 중 오류가 발생했습니다.");
    }
  };

  const handleRestore = async (file: File) => {
    const inputPass = prompt("백업 파일을 암호화할 때 사용했던 비밀번호를 입력하세요.");
    if (!inputPass) return;

    try {
      const buffer = await file.arrayBuffer();
      const decryptedData = await decryptData(buffer, inputPass);
      const restoredEntries: DiaryEntry[] = JSON.parse(decryptedData);
      
      if (confirm(`성공적으로 복구되었습니다. 기존 일기에 ${restoredEntries.length}개의 항목을 병합할까요? (취소 시 기존 데이터는 유지됩니다)`)) {
        const merged = [...entries];
        restoredEntries.forEach(re => {
          if (!merged.find(me => me.id === re.id)) {
            merged.push(re);
          }
        });
        saveEntries(merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        alert("데이터가 병합되었습니다.");
      }
    } catch (e: any) {
      alert(e.message || "복구에 실패했습니다. 파일이 손상되었거나 비밀번호가 틀렸을 수 있습니다.");
    }
  };

  const handleResetPasscode = (newPass: string) => {
    setPasscode(newPass);
    localStorage.setItem('moonlight_pass', newPass);
  };

  const handleFactoryReset = () => {
    if(confirm("모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Filtered Entries for Search
  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) return entries;
    const lowerSearch = searchTerm.toLowerCase();
    return entries.filter(e => 
      e.title.toLowerCase().includes(lowerSearch) || 
      e.content.toLowerCase().includes(lowerSearch)
    );
  }, [entries, searchTerm]);

  if (!isUnlocked) {
    return (
      <PasscodeLock 
        savedPasscode={passcode} 
        recoveryQuestion={recoveryQuestion}
        recoveryAnswer={recoveryAnswer}
        onUnlock={() => {
          setIsUnlocked(true);
          setView(AppView.LIST);
        }} 
        onResetPasscode={handleResetPasscode}
        onFactoryReset={handleFactoryReset}
      />
    );
  }

  const isBlobURL = window.location.href.startsWith('blob:');
  const qrTargetURL = manualURL || (isBlobURL ? '' : window.location.href);

  // Show PaperWriter overlay
  if (showPaperWriter) {
    return <PaperWriter onBack={() => setShowPaperWriter(false)} />;
  }

  return (
    <>
      {view === AppView.LIST && (
        <Layout 
          title={isSearching ? "" : "써니의 달빛 일기장"} 
          rightAction={
            <div className="flex items-center gap-1">
              <button 
                onClick={() => {
                  setIsSearching(!isSearching);
                  if (isSearching) setSearchTerm('');
                }} 
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isSearching ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
              >
                <i className={`fas ${isSearching ? 'fa-times' : 'fa-search'}`}></i>
              </button>
              <button onClick={() => setView(AppView.SETTINGS)} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-800">
                <i className="fas fa-cog text-slate-400"></i>
              </button>
            </div>
          }
        >
          {isSearching && (
            <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="relative">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                <input 
                  autoFocus
                  type="text"
                  placeholder="제목이나 내용으로 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 pl-11 pr-4 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-4">
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                <i className={`fas ${searchTerm ? 'fa-search-minus' : 'fa-feather-pointed'} text-5xl mb-4 opacity-20`}></i>
                <p>{searchTerm ? '검색 결과가 없습니다' : '첫 일기를 작성해보세요'}</p>
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')}
                    className="mt-4 text-indigo-400 text-sm font-medium"
                  >
                    검색어 지우기
                  </button>
                )}
              </div>
            ) : (
              filteredEntries.map((entry) => (
                <div 
                  key={entry.id}
                  onClick={() => {
                    setCurrentEntry(entry);
                    setView(AppView.VIEWER);
                  }}
                  className="diary-card p-4 rounded-2xl border border-slate-800 hover:border-indigo-500/50 transition-all active:scale-[0.98]"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-medium text-slate-500">
                      {new Date(entry.date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                    </span>
                    <span className="text-xl">{MOODS[entry.mood]?.emoji}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-200 line-clamp-1 mb-1">{entry.title}</h3>
                  <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed">{entry.content}</p>
                </div>
              ))
            )}
          </div>

          {/* Diary new entry button */}
          <button
            onClick={handleCreateNew}
            className="fixed bottom-8 right-8 w-14 h-14 bg-indigo-600 rounded-full shadow-lg shadow-indigo-600/40 flex items-center justify-center active:scale-90 transition-transform z-40"
          >
            <i className="fas fa-plus text-white text-xl"></i>
          </button>

          {/* Paper Writer button */}
          <button
            onClick={() => setShowPaperWriter(true)}
            className="fixed bottom-8 left-8 w-14 h-14 bg-violet-700 rounded-full shadow-lg shadow-violet-700/40 flex items-center justify-center active:scale-90 transition-transform z-40"
            title="자동 논문 작성기"
          >
            <i className="fas fa-scroll text-white text-xl"></i>
          </button>
        </Layout>
      )}

      {view === AppView.EDITOR && currentEntry && (
        <EditorView 
          entry={currentEntry} 
          onSave={handleSaveEntry} 
          onBack={() => setView(AppView.LIST)} 
          isLoading={isLoading}
        />
      )}

      {view === AppView.VIEWER && currentEntry && (
        <ViewerView 
          entry={currentEntry} 
          onEdit={() => setView(AppView.EDITOR)}
          onDelete={() => handleDeleteEntry(currentEntry.id)}
          onBack={() => setView(AppView.LIST)} 
        />
      )}

      {view === AppView.SETTINGS && (
        <SettingsView 
          onBack={() => setView(AppView.LIST)}
          currentPasscode={passcode}
          onSavePasscode={handleResetPasscode}
          recoveryQuestion={recoveryQuestion}
          recoveryAnswer={recoveryAnswer}
          onSaveRecovery={(q, a) => {
            setRecoveryQuestion(q);
            setRecoveryAnswer(a);
            localStorage.setItem('moonlight_q', q);
            localStorage.setItem('moonlight_a', a);
            alert("보안 질문이 설정되었습니다.");
          }}
          onBackup={handleBackup}
          onRestore={handleRestore}
          onReset={handleFactoryReset}
          onShowQR={() => setShowQR(true)}
        />
      )}

      {/* QR Code Modal */}
      {showQR && (
        <div 
          className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300"
          onClick={() => setShowQR(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center space-y-6 animate-in zoom-in-95 duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-bold text-slate-100">앱 접속하기</h2>
              <button onClick={() => setShowQR(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 text-slate-400">
                <i className="fas fa-times"></i>
              </button>
            </div>
            
            <div className="relative group">
              <div className="bg-white p-5 rounded-3xl inline-block shadow-xl mx-auto border-4 border-indigo-500/20">
                {qrTargetURL ? (
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrTargetURL)}&bgcolor=ffffff&color=0f172a&margin=10&format=png&qzone=1`} 
                    alt="접속 QR 코드"
                    className="w-[200px] h-[200px] block"
                  />
                ) : (
                  <div className="w-[200px] h-[200px] flex flex-col items-center justify-center bg-slate-100 rounded-xl text-slate-300">
                    <i className="fas fa-qrcode text-5xl mb-2"></i>
                    <p className="text-[10px] font-bold">주소를 입력해주세요</p>
                  </div>
                )}
              </div>
              {isBlobURL && (
                <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg">
                  <i className="fas fa-flask mr-1"></i>테스트 모드
                </div>
              )}
            </div>

            <div className="space-y-4">
              {isBlobURL && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-left">
                  <div className="flex items-center gap-2 text-amber-500 text-[11px] font-bold mb-1">
                    <i className="fas fa-info-circle"></i>
                    <span>왜 Blob 주소가 나오나요?</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    지금 보시는 화면은 <b>임시 미리보기</b> 상태이기 때문입니다. <br/>
                    앱을 정식으로 배포하면 실제 주소가 자동으로 생성됩니다. <br/>
                    지금 테스트하려면 아래에 주소를 직접 입력해보세요!
                  </p>
                </div>
              )}

              <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800 text-left">
                <label className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 block font-bold">접속 URL 입력</label>
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <input 
                      type="text"
                      value={manualURL}
                      onChange={(e) => setManualURL(e.target.value)}
                      placeholder="https://를 포함한 실제 주소 입력"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-xs text-slate-100 outline-none focus:border-indigo-500 font-mono"
                    />
                    {!manualURL && isBlobURL && <span className="absolute right-3 top-3 animate-ping h-2 w-2 rounded-full bg-indigo-400 opacity-75"></span>}
                  </div>
                  <button 
                    onClick={() => copyToClipboard(qrTargetURL)}
                    disabled={!qrTargetURL}
                    className={`w-full py-2 rounded-xl text-xs font-bold transition-all ${copied ? 'bg-green-600/20 text-green-400' : 'bg-indigo-600 text-white disabled:opacity-30'}`}
                  >
                    <i className={`fas ${copied ? 'fa-check' : 'fa-copy'} mr-2`}></i>
                    {copied ? '복사 완료!' : '주소 복사하기'}
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm text-slate-300 font-medium flex items-center justify-center gap-2">
                  <i className="fas fa-mobile-screen text-indigo-400"></i>
                  카메라로 스캔하세요
                </p>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  * 주소를 입력하면 QR 코드가 실시간으로 바뀝니다.<br/>
                  * <b>배포 후</b>에는 이 과정 없이 바로 사용 가능합니다.
                </p>
              </div>
            </div>

            <button 
              onClick={() => setShowQR(false)}
              className="w-full py-4 bg-slate-800 text-slate-300 rounded-2xl font-bold active:scale-95 transition-all"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
};

// ... (Rest of the EditorView, ViewerView, SettingsView remains unchanged)

// Sub-component: EditorView
const EditorView: React.FC<{ entry: DiaryEntry, onSave: (e: DiaryEntry) => void, onBack: () => void, isLoading: boolean }> = ({ entry, onSave, onBack, isLoading }) => {
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [mood, setMood] = useState(entry.mood);
  const [aiAnalysis, setAiAnalysis] = useState(entry.aiAnalysis || '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleManualAnalyze = async () => {
    if (content.length < 10) {
      alert("일기 내용이 너무 짧아요! 조금 더 적어주세요.");
      return;
    }
    setIsAnalyzing(true);
    try {
      const result = await analyzeDiaryEntry(content);
      if (result) {
        if (!title) setTitle(result.suggestedTitle);
        setMood(result.mood);
        setAiAnalysis(result.analysis);
      }
    } catch (e) {
      alert("AI 분석 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Layout 
      onBack={onBack} 
      title="기록하기"
      rightAction={
        <div className="flex gap-2">
           <button 
            onClick={handleManualAnalyze} 
            disabled={isAnalyzing || content.length < 10}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-30"
            title="AI에게 물어보기"
          >
            <i className={`fas fa-wand-magic-sparkles ${isAnalyzing ? 'animate-pulse' : ''}`}></i>
          </button>
          <button 
            onClick={() => onSave({ ...entry, title, content, mood, aiAnalysis })} 
            disabled={isLoading || isAnalyzing || !content}
            className="px-4 py-2 bg-indigo-600 rounded-xl text-sm font-bold disabled:opacity-50 transition-opacity"
          >
            {isLoading ? <i className="fas fa-spinner fa-spin"></i> : "저장"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full gap-4">
        <div className="flex gap-2 overflow-x-auto py-2 no-scrollbar">
          {Object.entries(MOODS).map(([key, info]) => (
            <button
              key={key}
              onClick={() => setMood(key)}
              className={`flex-shrink-0 px-4 py-2 rounded-2xl flex items-center gap-2 border transition-all ${
                mood === key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <span>{info.emoji}</span>
              <span className="text-xs">{info.label}</span>
            </button>
          ))}
        </div>

        {aiAnalysis && (
          <div className="p-4 bg-indigo-950/30 rounded-2xl border border-indigo-500/20 animate-in fade-in slide-in-from-top-4 duration-500">
             <div className="flex justify-between items-start mb-1">
                <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">AI 달빛 요정의 코멘트</h4>
                <button onClick={() => setAiAnalysis('')} className="text-slate-500 hover:text-slate-300">
                  <i className="fas fa-times text-xs"></i>
                </button>
             </div>
             <p className="text-sm italic text-indigo-200">"{aiAnalysis}"</p>
          </div>
        )}

        <input
          type="text"
          placeholder="제목을 입력하세요 (선택)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-transparent text-xl font-bold border-none placeholder:text-slate-700"
        />

        <textarea
          placeholder="오늘 어떤 일이 있었나요? 마음껏 적어보세요..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 bg-transparent resize-none leading-loose text-slate-300 placeholder:text-slate-800 min-h-[400px]"
        />
        
        <p className="text-[10px] text-slate-600 text-center mt-4">
          * 상단 요술봉 아이콘을 누르면 AI가 기분 분석과 위로를 전해줍니다.
        </p>
      </div>
    </Layout>
  );
};

// Sub-component: ViewerView
const ViewerView: React.FC<{ entry: DiaryEntry, onEdit: () => void, onDelete: () => void, onBack: () => void }> = ({ entry, onEdit, onDelete, onBack }) => {
  const moodInfo = MOODS[entry.mood];
  
  return (
    <Layout 
      onBack={onBack} 
      title=""
      rightAction={
        <div className="flex gap-2">
          <button onClick={onEdit} className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-900 text-slate-300">
            <i className="fas fa-edit"></i>
          </button>
          <button onClick={onDelete} className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-900 text-red-400">
            <i className="fas fa-trash"></i>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-slate-500 font-medium">
              {new Date(entry.date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="text-2xl font-bold serif text-slate-100">{entry.title}</h1>
          </div>
          <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center ${moodInfo?.color || 'bg-slate-800'}`}>
            <span className="text-2xl">{moodInfo?.emoji}</span>
          </div>
        </div>

        <div className="p-6 bg-slate-900/50 rounded-3xl border border-slate-800/50">
          <p className="text-lg leading-relaxed text-slate-300 whitespace-pre-wrap serif">
            {entry.content}
          </p>
        </div>

        {entry.aiAnalysis && (
          <div className="p-5 bg-indigo-950/30 rounded-3xl border border-indigo-500/20 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <i className="fas fa-wand-magic-sparkles text-4xl"></i>
            </div>
            <h4 className="text-xs font-bold text-indigo-400 mb-2 uppercase tracking-wider flex items-center gap-2">
              <i className="fas fa-sparkles text-[10px]"></i> AI 달빛 요정의 메시지
            </h4>
            <p className="text-sm italic text-indigo-200 leading-relaxed">
              "{entry.aiAnalysis}"
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
};

// Sub-component: SettingsView
const SettingsView: React.FC<{ 
  onBack: () => void, 
  currentPasscode: string, 
  onSavePasscode: (p: string) => void, 
  recoveryQuestion: string,
  recoveryAnswer: string,
  onSaveRecovery: (q: string, a: string) => void,
  onBackup: () => void,
  onRestore: (file: File) => void,
  onReset: () => void,
  onShowQR: () => void
}> = ({ onBack, currentPasscode, onSavePasscode, recoveryQuestion, recoveryAnswer, onSaveRecovery, onBackup, onRestore, onReset, onShowQR }) => {
  const [newPass, setNewPass] = useState(currentPasscode);
  const [newQ, setNewQ] = useState(recoveryQuestion);
  const [newA, setNewA] = useState(recoveryAnswer);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Layout onBack={onBack} title="설정">
      <div className="space-y-8">
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1">보안 설정</h3>
          <div className="bg-slate-900 rounded-2xl p-4 space-y-6 border border-slate-800">
            {/* Passcode Section */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-500 uppercase">잠금 비밀번호 (4자리)</label>
              <div className="flex gap-2">
                <input 
                  type="password" 
                  maxLength={4}
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value.replace(/[^0-9]/g, ''))}
                  className="bg-slate-800 rounded-xl px-4 py-2 flex-1 border border-slate-700 outline-none focus:border-indigo-500"
                />
                <button 
                  onClick={() => onSavePasscode(newPass)}
                  disabled={newPass.length !== 4 || newPass === currentPasscode}
                  className="bg-indigo-600 rounded-xl px-4 py-2 font-bold disabled:opacity-30 transition-all"
                >
                  변경
                </button>
              </div>
            </div>

            {/* Recovery Question Section */}
            <div className="flex flex-col gap-3 pt-4 border-t border-slate-800">
              <label className="text-xs font-bold text-slate-500 uppercase">비밀번호 찾기 질문 및 답변</label>
              <input 
                type="text" 
                placeholder="예: 가장 좋아하는 노래는?"
                value={newQ}
                onChange={(e) => setNewQ(e.target.value)}
                className="bg-slate-800 rounded-xl px-4 py-3 border border-slate-700 outline-none focus:border-indigo-500 text-sm"
              />
              <input 
                type="text" 
                placeholder="답변 입력"
                value={newA}
                onChange={(e) => setNewA(e.target.value)}
                className="bg-slate-800 rounded-xl px-4 py-3 border border-slate-700 outline-none focus:border-indigo-500 text-sm"
              />
              <button 
                onClick={() => onSaveRecovery(newQ, newA)}
                disabled={!newQ.trim() || !newA.trim() || (newQ === recoveryQuestion && newA === recoveryAnswer)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-indigo-400 rounded-xl px-4 py-3 font-bold border border-indigo-500/20 disabled:opacity-30 transition-all"
              >
                보안 질문 저장
              </button>
              <p className="text-[10px] text-slate-500 leading-relaxed px-1">
                * 비밀번호를 잊었을 때 본인 확인을 위한 질문입니다. 답변을 꼭 기억해 주세요.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1 text-indigo-400/80">앱 공유 및 연결</h3>
          <div className="bg-slate-900 rounded-2xl p-4 space-y-4 border border-slate-800">
            <button 
              onClick={onShowQR}
              className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 transition-all"
            >
              <div className="flex items-center gap-3">
                <i className="fas fa-qrcode text-indigo-400"></i>
                <span>QR 코드로 앱 공유하기</span>
              </div>
              <i className="fas fa-chevron-right text-xs opacity-50"></i>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1 text-indigo-400/80">데이터 백업 및 복구</h3>
          <div className="bg-slate-900 rounded-2xl p-4 space-y-4 border border-slate-800">
            <button 
              onClick={onBackup}
              className="w-full flex items-center justify-between p-2 rounded-xl bg-indigo-600/10 text-indigo-300 hover:bg-indigo-600/20 transition-all"
            >
              <div className="flex items-center gap-3">
                <i className="fas fa-file-export"></i>
                <span>암호화 백업 파일 생성</span>
              </div>
              <i className="fas fa-chevron-right text-xs opacity-50"></i>
            </button>

            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-between p-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-all"
            >
              <div className="flex items-center gap-3">
                <i className="fas fa-file-import"></i>
                <span>백업 파일에서 복구하기</span>
              </div>
              <i className="fas fa-chevron-right text-xs opacity-50"></i>
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".moonlight"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onRestore(file);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1">기타</h3>
          <div className="bg-slate-900 rounded-2xl p-4 space-y-4 border border-slate-800">
            <button 
              onClick={onReset}
              className="w-full flex items-center justify-between text-red-400/70 hover:text-red-400 transition-colors px-2"
            >
              <span>모든 데이터 초기화</span>
              <i className="fas fa-trash-alt"></i>
            </button>
          </div>
        </section>

        <div className="text-center pt-10 opacity-30">
          <i className="fas fa-moon text-2xl mb-2"></i>
          <p className="text-xs">Secret Moonlight Diary v1.3.5</p>
        </div>
      </div>
    </Layout>
  );
};

export default App;
