import Taro from '@tarojs/taro';
import { Language } from '../types';

export interface Message { role: 'user' | 'assistant'; text: string }
export type Scene = 'interview' | 'daily';
export interface Usage {
  month: string;
  actualCostMicros: number;
  simulatedCostMicros: number;
  budgetMicros: number;
  reminder: 'ok' | 'warning' | 'exhausted';
  operations: { asr: number; llm: number; tts: number };
  quantities: { asrDurationMs: number; llmInputTokensEstimate: number; llmOutputTokensEstimate: number; ttsCharacters: number };
}
export interface TurnResult {
  text: string;
  mock: true;
  feedback: { correction: string; naturalRewrite: string; example: string; explanation: string; encouragement: string };
  usage: Usage;
}
export interface SpeechResult { audioBase64: string; mimeType: 'audio/wav'; kind: 'mock-tone'; mock: true; usage: Usage }

function fail(status: number, data: unknown): never {
  const message = (data as { message?: string | string[] })?.message;
  throw new Error(status === 401 ? '会话过期，请重新连接（当前对话保留）' :
    Array.isArray(message) ? message.join('；') : message || `请求失败（${status}），请手动重试`);
}

// Local development API only. No shared secret or provider credential in the client.
export class ConversationClient {
  private token = '';
  private readonly base = 'http://127.0.0.1:3000/api';
  private async request<T>(path: string, data?: object): Promise<T> {
    try {
      const result = await Taro.request<T>({
        url: this.base + path, method: data ? 'POST' : 'GET', data,
        timeout: 10000, header: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      });
      if (result.statusCode < 200 || result.statusCode >= 300) fail(result.statusCode, result.data);
      return result.data;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('无法连接本地 Mock 服务，请先启动服务端；不会自动重发请求');
    }
  }
  async connect() {
    const session = await this.request<{ token: string }>('/session', {});
    this.token = session.token;
    return this.usage();
  }
  usage() { return this.request<Usage>('/usage/monthly'); }
  turn(language: Language, scene: Scene, text: string, history: Message[]) {
    return this.request<TurnResult>('/conversation/turn', { language, scene, text, history: history.slice(-20) });
  }
  synthesize(language: Language, text: string) { return this.request<SpeechResult>('/speech/synthesize', { language, text }); }
  async transcribe(language: Language, filePath: string) {
    try {
      const result = await Taro.uploadFile({
        url: this.base + '/speech/transcribe', filePath, name: 'audio', formData: { language },
        header: { Authorization: `Bearer ${this.token}` }, timeout: 10000,
      });
      let data: { text: string; mock: true; usage: Usage };
      try { data = JSON.parse(result.data); } catch { throw new Error('服务端返回格式错误，请手动重试'); }
      if (result.statusCode < 200 || result.statusCode >= 300) fail(result.statusCode, data);
      return data;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('录音上传失败，请检查本地服务并手动重试');
    }
  }
}
