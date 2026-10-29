import { Injectable } from '@nestjs/common';

export type Language = 'en' | 'ja';
export type Scene = 'interview' | 'daily';
export interface Message { role: 'user' | 'assistant'; text: string }
export interface Feedback { correction: string; naturalRewrite: string; example: string; explanation: string; encouragement: string }
export interface Reply { text: string; feedback: Feedback; mock: boolean }
export interface Audio { audioBase64: string; mimeType: 'audio/wav' | 'audio/mpeg'; kind: 'mock-tone' | 'speech'; mock: boolean }
// Future providers must support cancellation; no paid implementation is registered.
export interface AsrProvider {
  transcribe(audio: Buffer, language: Language, signal: AbortSignal): Promise<{ text: string; mock: boolean }>;
}
export interface LlmProvider {
  reply(input: { language: Language; scene: Scene; text: string; history: Message[] }, signal: AbortSignal): Promise<Reply>;
}
export interface TtsProvider {
  synthesize(text: string, language: Language, signal: AbortSignal): Promise<Audio>;
}
export const ASR = Symbol('ASR');
export const LLM = Symbol('LLM');
export const TTS = Symbol('TTS');

@Injectable()
export class MockAsrProvider implements AsrProvider {
  async transcribe(_audio: Buffer, language: Language, signal: AbortSignal) {
    signal.throwIfAborted();
    return { text: language === 'en' ? 'I build web applications with React.' : 'こんにちは。日本語を勉強しています。', mock: true as const };
  }
}

@Injectable()
export class MockLlmProvider implements LlmProvider {
  async reply(input: { language: Language; scene: Scene; text: string; history: Message[] }, signal: AbortSignal): Promise<Reply> {
    signal.throwIfAborted();
    const round = input.history.filter(message => message.role === 'user').length + 1;
    const questions = input.language === 'en'
      ? input.scene === 'interview'
        ? ['What did you build?', 'How did you choose the architecture?', 'How did you test it?', 'What challenge did you solve?', 'What would you improve?']
        : ['How was your day?', 'What did you do today?', 'What food do you like?', 'Where would you like to go?', 'What are your plans for tomorrow?']
      : input.scene === 'daily'
        ? ['今日は何をしましたか。', '好きな食べ物は何ですか。', '週末は何をしますか。', 'どこに行きたいですか。', '明日は何をしますか。']
        : ['自己紹介をお願いします。', 'どんな仕事をしていますか。', '何を作りましたか。', 'どんな問題がありましたか。', 'これから何を学びたいですか。'];
    return {
      text: questions[(round - 1) % questions.length], mock: true,
      feedback: {
        correction: input.text,
        naturalRewrite: input.text,
        example: input.language === 'en' ? 'For example, I wrote tests for the login flow.' : '例えば、今日は日本語を10分間勉強しました。',
        explanation: `第 ${round} 轮演示：Mock 仅回显原句，不判断语法，也不提供发音评分。`,
        encouragement: '已完成本轮表达，请尝试补充一个具体例子。',
      },
    };
  }
}

@Injectable()
export class MockTtsProvider implements TtsProvider {
  async synthesize(_text: string, _language: Language, signal: AbortSignal): Promise<Audio> {
    signal.throwIfAborted();
    // Original generated 220 Hz tone, not speech or a copyrighted recording.
    const samples = 4000;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 220 * i / 16000)), 44 + i * 2);
    return { audioBase64: wav.toString('base64'), mimeType: 'audio/wav', kind: 'mock-tone', mock: true };
  }
}
