
import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children, title, onBack, rightAction }) => {
  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto bg-slate-950 shadow-2xl relative overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md px-4 h-16 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-800 active:scale-90 transition-all">
              <i className="fas fa-chevron-left text-lg"></i>
            </button>
          )}
          {title && <h1 className="text-lg font-bold truncate max-w-[200px]">{title}</h1>}
        </div>
        <div>
          {rightAction}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 pb-24 overflow-y-auto">
        {children}
      </main>

      {/* Background Decor */}
      <div className="fixed top-20 -right-20 w-64 h-64 bg-indigo-900/10 rounded-full blur-[100px] -z-10 pointer-events-none" />
      <div className="fixed bottom-20 -left-20 w-80 h-80 bg-purple-900/10 rounded-full blur-[100px] -z-10 pointer-events-none" />
    </div>
  );
};

export default Layout;
