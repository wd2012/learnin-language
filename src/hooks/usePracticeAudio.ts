import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { recordingSession } from '../services/recorder';

export function usePracticeAudio() {
  const [recording, setRecording] = useState(false);
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const manager = useRef<ReturnType<typeof recordingSession> | null>(null);
  const player = useRef<ReturnType<typeof Taro.createInnerAudioContext> | null>(null);
  const active = useRef(false);
  const alive = useRef(false);
  const visible = useRef(true);
  const accepting = useRef(false);
  const authorizing = useRef(false);
  const files = useRef(new Set<string>());
  const sound = useRef('');
  const unlink = (path: string) => {
    if (path) Taro.getFileSystemManager().unlink({ filePath: path, fail: () => undefined });
  };
  const discard = () => {
    for (const path of files.current) unlink(path);
    files.current.clear();
    if (alive.current) setFile('');
  };
  const stop = () => {
    if (active.current) manager.current?.stop();
  };
  const suspend = () => {
    visible.current = false;
    accepting.current = false;
    stop();
    player.current?.stop();
    discard();
    unlink(sound.current);
    sound.current = '';
  };
  useDidHide(suspend);
  useDidShow(() => { visible.current = true; });
  useEffect(() => {
    alive.current = true;
    const audio = Taro.createInnerAudioContext();
    player.current = audio;
    const onStop = (result: { tempFilePath: string; duration: number }) => {
      active.current = false;
      if (alive.current) setRecording(false);
      if (!alive.current || !accepting.current) { unlink(result.tempFilePath); return; }
      discard();
      files.current.add(result.tempFilePath);
      setFile(result.tempFilePath);
    };
    const onError = () => {
      active.current = false;
      if (alive.current) { setRecording(false); setError('录音失败，请检查麦克风权限后重试'); }
    };
    const onAudioError = () => { if (alive.current) setError('音频播放失败，请重试'); };
    const recorder = recordingSession(onStop, onError);
    manager.current = recorder;
    audio.onError(onAudioError);
    return () => {
      alive.current = false;
      suspend();
      recorder.release();
      audio.offError(onAudioError);
      audio.destroy();
      manager.current = null;
      player.current = null;
    };
  }, []);
  const start = async () => {
    if (!visible.current || active.current || authorizing.current) return;
    authorizing.current = true;
    accepting.current = true;
    setError('');
    try {
      await Taro.authorize({ scope: 'scope.record' });
      if (!alive.current || !accepting.current) return;
      discard();
      active.current = true;
      manager.current?.start();
      setRecording(true);
    } catch {
      active.current = false;
      if (alive.current) { setRecording(false); setError('无法录音，请在小程序设置中允许麦克风权限'); }
    } finally { authorizing.current = false; }
  };
  const replay = () => {
    if (!file || !player.current) return;
    player.current.src = file;
    player.current.play();
  };
  const playTone = async (base64: string) => {
    if (!visible.current || !alive.current) return;
    const path = `${Taro.env.USER_DATA_PATH}/linguapath-mock-${Date.now()}.wav`;
    try {
      await new Promise<void>((resolve, reject) => Taro.getFileSystemManager().writeFile({ filePath: path, data: base64, encoding: 'base64', success: () => resolve(), fail: reject }));
      if (!alive.current || !visible.current) { unlink(path); return; }
      player.current?.stop();
      unlink(sound.current);
      sound.current = path;
      if (player.current) { player.current.src = path; player.current.play(); }
    } catch { unlink(path); throw new Error('无法保存或播放演示提示音'); }
  };
  return { recording, file, error, start, stop, replay, discard, playTone };
}
