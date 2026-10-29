export type Language = 'en' | 'ja';
export interface Lesson { id: string; language: Language; title: string; level: string; minutes: number; summary: string; passage: string; translation: string; phrases: string[]; prompt: string; }
