
import React, { useState } from 'react';

interface PasscodeLockProps {
  onUnlock: () => void;
  savedPasscode: string;
  recoveryQuestion?: string;
  recoveryAnswer?: string;
  onResetPasscode: (newPass: string) => void;
  onFactoryReset: () => void;
}

const PasscodeLock: React.FC<PasscodeLockProps> = ({ 
  onUnlock, 
  savedPasscode, 
  recoveryQuestion, 
  recoveryAnswer,
  onResetPasscode,
  onFactoryReset
}) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassInput, setNewPassInput] = useState('');
  const [step, setStep] = useState<'answer' | 'new_pass'>('answer');

  const handleKeypad = (num: string) => {
    if (input.length < 4) {
      const newInput = input + num;
      setInput(newInput);
      if (newInput.length === 4) {
        if (newInput === savedPasscode) {
          onUnlock();
        } else {
          setError(true);
          setTimeout(() => {
            setInput('');
            setError(false);
          }, 600);
        }
      }
    }
  };

  const handleBackspace = () => {
    setInput(input.slice(0, -1));
  };

  const handleRecoverySubmit = () => {
    if (recoveryInput.trim() === recoveryAnswer) {
      setStep('new_pass');
    } else {
      alert("정답이 일치하지 않습니다.");
    }
  };

  const handlePassReset = () => {
    if (newPassInput.length === 4) {
      onResetPasscode(newPassInput);
      alert("비밀번호가 재설정되었습니다.");
      setIsRecovering(false);
      setStep('answer');
      setRecoveryInput('');
      setNewPassInput('');
    }
  };

  if (isRecovering) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50 p-6 animate-in fade-in duration-300">
        <div className="w-full max-w-sm bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-100">비밀번호 찾기</h2>
            <button onClick={() => setIsRecovering(false)} className="text-slate-500 hover:text-slate-300">
              <i className="fas fa-times"></i>
            </button>
          </div>

          {!recoveryQuestion ? (
            <div className="text-center space-y-6">
              <i className="fas fa-exclamation-triangle text-4xl text-amber-500 opacity-50"></i>
              <p className="text-sm text-slate-400 leading-relaxed">
                설정된 보안 질문이 없습니다. <br/>
                보안을 위해 데이터를 초기화한 후 <br/>
                새로 시작해야 합니다.
              </p>
              <button 
                onClick={onFactoryReset}
                className="w-full py-4 bg-red-600/20 text-red-400 rounded-2xl font-bold border border-red-500/20 active:bg-red-600 active:text-white transition-all"
              >
                모든 데이터 초기화
              </button>
            </div>
          ) : (
            <>
              {step === 'answer' ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-indigo-400 uppercase tracking-wider">보안 질문</label>
                    <p className="text-lg font-medium text-slate-200">{recoveryQuestion}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">답변 입력</label>
                    <input 
                      type="text"
                      value={recoveryInput}
                      onChange={(e) => setRecoveryInput(e.target.value)}
                      placeholder="정답을 입력하세요"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 outline-none focus:border-indigo-500 transition-all"
                    />
                  </div>
                  <button 
                    onClick={handleRecoverySubmit}
                    disabled={!recoveryInput.trim()}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-600/20 active:scale-95 transition-all disabled:opacity-50"
                  >
                    확인
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-center space-y-2">
                    <i className="fas fa-check-circle text-3xl text-green-500"></i>
                    <p className="text-slate-200">정답입니다! <br/>새 비밀번호를 입력해주세요.</p>
                  </div>
                  <input 
                    type="password"
                    maxLength={4}
                    value={newPassInput}
                    onChange={(e) => setNewPassInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="새 비밀번호 4자리"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 text-center text-2xl tracking-[1em] outline-none focus:border-indigo-500 transition-all"
                  />
                  <button 
                    onClick={handlePassReset}
                    disabled={newPassInput.length !== 4}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-600/20 active:scale-95 transition-all disabled:opacity-50"
                  >
                    비밀번호 변경 완료
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50 p-6">
      <div className="mb-12 text-center">
        <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mb-6 mx-auto shadow-lg shadow-indigo-500/20">
          <i className="fas fa-moon text-3xl text-white"></i>
        </div>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">[써니의 달빛 일기장]</h1>
        <p className="text-slate-400">비밀번호를 입력하세요</p>
      </div>

      <div className={`flex gap-4 mb-12 transition-transform ${error ? 'animate-bounce' : ''}`}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
              input.length > i 
                ? 'bg-indigo-500 border-indigo-500 scale-110' 
                : 'border-slate-700'
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6 max-w-xs w-full">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onClick={() => handleKeypad(num.toString())}
            className="w-16 h-16 rounded-full bg-slate-900 text-2xl font-medium text-slate-200 active:bg-indigo-600 active:scale-95 transition-all flex items-center justify-center"
          >
            {num}
          </button>
        ))}
        <div className="w-16 h-16"></div>
        <button
          onClick={() => handleKeypad('0')}
          className="w-16 h-16 rounded-full bg-slate-900 text-2xl font-medium text-slate-200 active:bg-indigo-600 active:scale-95 transition-all flex items-center justify-center"
        >
          0
        </button>
        <button
          onClick={handleBackspace}
          className="w-16 h-16 rounded-full text-slate-400 active:text-slate-100 transition-colors flex items-center justify-center"
        >
          <i className="fas fa-backspace text-xl"></i>
        </button>
      </div>
      
      <button 
        onClick={() => setIsRecovering(true)}
        className="mt-12 text-slate-500 text-sm font-medium hover:text-indigo-400 transition-colors"
      >
        비밀번호를 잊으셨나요?
      </button>

      {error && <p className="mt-8 text-red-500 animate-pulse absolute bottom-10">틀린 비밀번호입니다</p>}
    </div>
  );
};

export default PasscodeLock;
