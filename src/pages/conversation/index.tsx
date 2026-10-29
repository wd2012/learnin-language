import React, { useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Textarea, View } from '@tarojs/components';
import { Language } from '../../types';
import { ConversationClient, Message, Scene, SpeechResult, TurnResult, Usage } from '../../services/conversation';
import { usePracticeAudio } from '../../hooks/usePracticeAudio';

export default function Conversation() {
  const client = useRef(new ConversationClient());
  const alive = useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const audio = usePracticeAudio();
  const [language, setLanguage] = useState<Language>('en');
  const [scene, setScene] = useState<Scene>('interview');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState('');
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<Message[]>([]);
  const [reply, setReply] = useState<TurnResult | null>(null);
  const [tone, setTone] = useState<SpeechResult | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const run = async (label: string, action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(label); setError('');
    try { await action(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败，请手动重试'); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  };
  const connect = () => run('连接中', async () => {
    const stats = await client.current.connect();
    if (alive.current) { setUsage(stats); setConnected(true); }
  });
  const change = (nextLanguage: Language, nextScene: Scene) => {
    audio.stop(); audio.discard(); setLanguage(nextLanguage); setScene(nextScene);
    setDraft(''); setHistory([]); setReply(null); setTone(null); setError('');
  };
  const upload = () => run('上传并模拟识别中', async () => {
    const consent = await Taro.showModal({ title: '确认上传录音', content: '录音将发送到你启动的本地 Mock 服务，仅在内存处理，不保存、不调用付费 API。ASR 返回固定演示文本，不是真实识别结果。', confirmText: '同意上传' });
    if (!consent.confirm) return;
    const result = await client.current.transcribe(language, audio.file);
    if (alive.current) { setDraft(result.text); setUsage(result.usage); audio.discard(); }
  });
  const send = () => run('生成 Mock 回复中', async () => {
    const text = draft.trim();
    if (!text) return;
    const result = await client.current.turn(language, scene, text, history);
    if (alive.current) {
      setHistory([...history, { role: 'user', text }, { role: 'assistant', text: result.text }]);
      setReply(result); setTone(null); setUsage(result.usage); setDraft('');
    }
  });
  return <View className='container'>
    <View className='hero'><View className='title'>逐轮口语练习 · Mock</View><View className='subtitle'>实际费用为零；不识别语音、不判断语法、不提供发音评分</View></View>
    <View className='card'>
      <View className='muted'>先在电脑启动 NestJS 服务。此入口仅用于微信开发者工具的本地联调；真机与真实 Provider 尚未接入。</View>
      <Button className='btn' disabled={!!busy || audio.recording} onClick={connect}>{connected ? '重新连接本地服务' : '连接本地 Mock 服务'}</Button>
      <Button disabled={!!busy || audio.recording} onClick={() => change(language === 'en' ? 'ja' : 'en', language === 'en' ? 'daily' : 'interview')}>语言：{language === 'en' ? '英语' : '日语'}（切换清空对话）</Button>
      <Button disabled={!!busy || audio.recording} onClick={() => change(language, scene === 'interview' ? 'daily' : 'interview')}>场景：{scene === 'interview' ? '技术面试' : '日常生活'}</Button>
      <View className='muted'>已完成 {history.length / 2} 轮；最近 10 轮作为上下文。文本与录音不自动上传。</View>
    </View>
    <View className='card'>
      <Button className='btn' disabled={!!busy} onClick={audio.recording ? audio.stop : audio.start}>{audio.recording ? '停止录音' : '开始录音（最长60秒）'}</Button>
      <Button disabled={!audio.file || !!busy || audio.recording} onClick={audio.replay}>回放自己的录音</Button>
      <Button disabled={!audio.file || !connected || !!busy || audio.recording} onClick={upload}>确认后上传，生成演示转写</Button>
      <Button disabled={!audio.file || !!busy} onClick={audio.discard}>删除本地录音</Button>
      <View className='muted'>可直接输入文本，或编辑演示转写后发送。离开页面会清理录音和播放器。</View>
      <Textarea value={draft} maxlength={2000} disabled={!!busy || audio.recording} placeholder={language === 'en' ? 'Tell me about your project.' : '今日は何をしましたか。'} onInput={event => setDraft(event.detail.value)} />
      <Button className='btn' disabled={!connected || !!busy || !draft.trim() || audio.recording} onClick={send}>发送文本并继续下一轮</Button>
      {busy && <View role='status'>{busy}…</View>}
      {(error || audio.error) && <View className='muted'>{error || audio.error}（失败不会自动重试）</View>}
    </View>
    {history.map((message, index) => <View className='card' key={index}><View className='card-title'>{message.role === 'user' ? '我的表达' : 'Mock 练习伙伴'}</View><View>{message.text}</View></View>)}
    {reply && <View className='card'>
      <View className='card-title'>本轮演示反馈</View><View>原句回显：{reply.feedback.correction}</View>
      <View>改写字段演示（仍为原句）：{reply.feedback.naturalRewrite}</View>
      <View>固定示例：{reply.feedback.example}</View>
      <View className='muted'>{reply.feedback.explanation}</View><View>{reply.feedback.encouragement}</View>
      <Button disabled={!!busy || audio.recording || !connected} onClick={() => run('生成演示提示音中', async () => {
        const result = tone || await client.current.synthesize(language, reply.text);
        if (alive.current) { if (!tone) { setUsage(result.usage); setTone(result); } await audio.playTone(result.audioBase64); }
      })}>播放 Mock TTS 提示音（不是语音）</Button>
    </View>}
    {usage && <View className='card'>
      <View className='card-title'>本地服务用量 · {usage.month}（北京时间）</View>
      <View>ASR {usage.operations.asr} 次 · LLM {usage.operations.llm} 次 · TTS {usage.operations.tts} 次</View>
      <View>实际费用 ¥0；模拟费用 ¥{(usage.simulatedCostMicros / 1000000).toFixed(3)} / 月度模拟预算 ¥{(usage.budgetMicros / 1000000).toFixed(3)}</View>
      <View className='muted'>ASR {(usage.quantities.asrDurationMs / 1000).toFixed(1)} 秒 · 模拟输入／输出 Token {usage.quantities.llmInputTokensEstimate}／{usage.quantities.llmOutputTokensEstimate}（字符估算）· TTS {usage.quantities.ttsCharacters} 字符</View>
      <View className='muted'>{usage.reminder === 'warning' ? '提醒：已使用至少80%的月度模拟预算。' : usage.reminder === 'exhausted' ? '月度模拟预算已用尽，服务端将拒绝后续生成请求。' : '达到80%时提醒，超过预算时阻止请求。'}统计保存在服务内存，重启清零；不是持久化账单。</View>
      <Button disabled={!connected || !!busy || audio.recording} onClick={() => run('刷新用量中', async () => { const stats = await client.current.usage(); if (alive.current) setUsage(stats); })}>刷新用量与预算状态</Button>
    </View>}
  </View>;
}
