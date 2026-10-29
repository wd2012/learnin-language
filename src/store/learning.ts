import Taro from '@tarojs/taro'; import { create } from 'zustand';
const KEY = 'linguapath-learning-v1'; type RecordMap = Record<string, string>;
interface LearningState { completed: RecordMap; finish: (id: string) => void; reset: () => void; }
function load(): RecordMap { try { return Taro.getStorageSync(KEY) || {}; } catch { return {}; } }
export const useLearning = create<LearningState>((set) => ({ completed: load(), finish: id => set(state => { const completed = {...state.completed,[id]:new Date().toISOString().slice(0,10)}; Taro.setStorageSync(KEY,completed); return {completed}; }), reset: () => set(() => { Taro.removeStorageSync(KEY); return {completed:{}}; }) }));
