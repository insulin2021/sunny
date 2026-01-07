
export interface DiaryEntry {
  id: string;
  date: string;
  title: string;
  content: string;
  mood: string;
  aiAnalysis?: string;
  tags: string[];
}

export enum AppView {
  LOCK = 'LOCK',
  LIST = 'LIST',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
  SETTINGS = 'SETTINGS'
}

export interface MoodInfo {
  emoji: string;
  label: string;
  color: string;
}

export const MOODS: Record<string, MoodInfo> = {
  happy: { emoji: '😊', label: '행복', color: 'bg-yellow-400' },
  sad: { emoji: '😢', label: '슬픔', color: 'bg-blue-400' },
  angry: { emoji: '😠', label: '화남', color: 'bg-red-400' },
  calm: { emoji: '😌', label: '평온', color: 'bg-green-400' },
  excited: { emoji: '🤩', label: '신남', color: 'bg-pink-400' },
  tired: { emoji: '😴', label: '피곤', color: 'bg-purple-400' },
  anxious: { emoji: '😰', label: '불안', color: 'bg-orange-400' },
};
