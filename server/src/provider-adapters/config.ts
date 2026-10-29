import type { LlmConfig } from './llm';
import type { TencentConfig } from './tencent';

export function realProviderConfig(environment: NodeJS.ProcessEnv = process.env): { tencent: TencentConfig; llm: LlmConfig } {
  const required = (name: string) => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`缺少服务端配置：${name}（不要在聊天中发送凭据）`);
    return value;
  };
  const voice = (language: 'EN' | 'JA') => {
    const id = Number(required(`TENCENT_TTS_VOICE_${language}`));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`无效音色配置：TENCENT_TTS_VOICE_${language}`);
    const primary = environment[`TENCENT_TTS_PRIMARY_LANGUAGE_${language}`];
    if (primary && !['1', '2'].includes(primary)) throw new Error(`无效主语言参数：TENCENT_TTS_PRIMARY_LANGUAGE_${language}`);
    return { id, ...(primary ? { primaryLanguage: Number(primary) as 1 | 2 } : {}) };
  };
  const maxTokens = Number(environment.LLM_MAX_OUTPUT_TOKENS ?? 512);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) throw new Error('LLM_MAX_OUTPUT_TOKENS 必须为1–1024');
  return {
    tencent: {
      secretId: required('TENCENT_SECRET_ID'), secretKey: required('TENCENT_SECRET_KEY'), sessionToken: environment.TENCENT_SESSION_TOKEN,
      region: required('TENCENT_REGION'),
      engines: { en: required('TENCENT_ASR_ENGINE_EN'), ja: required('TENCENT_ASR_ENGINE_JA') },
      voices: { en: voice('EN'), ja: voice('JA') },
    },
    llm: { apiKey: required('DASHSCOPE_API_KEY'), model: required('DASHSCOPE_MODEL'), maxTokens,
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
  };
}
