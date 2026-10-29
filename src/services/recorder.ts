import Taro from '@tarojs/taro';

type Result = { tempFilePath: string; duration: number };
interface Owner { stopped: (result: Result) => void; failed: () => void }
let recorder: ReturnType<typeof Taro.getRecorderManager> | undefined;
let owner: Owner | undefined;

function sharedRecorder() {
  if (!recorder) {
    recorder = Taro.getRecorderManager();
    // Taro 4.1 types do not expose recorder offStop/offError. Register once,
    // retain callbacks only during a recording, and release them on completion.
    recorder.onStop(result => {
      const recipient = owner;
      owner = undefined;
      if (recipient) recipient.stopped(result);
      else Taro.getFileSystemManager().unlink({ filePath: result.tempFilePath, fail: () => undefined });
    });
    recorder.onError(() => { const recipient = owner; owner = undefined; recipient?.failed(); });
  }
  return recorder;
}

export function recordingSession(stopped: Owner['stopped'], failed: Owner['failed']) {
  const recipient = { stopped, failed };
  return {
    start() {
      const manager = sharedRecorder();
      if (owner) throw new Error('另一段录音正在结束，请稍后重试');
      owner = recipient;
      try { manager.start({ duration: 60000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 }); }
      catch (error) { owner = undefined; throw error; }
    },
    stop() { if (owner === recipient) recorder?.stop(); },
    release() {
      if (owner !== recipient) return;
      // Keep a draining owner until onStop/onError arrives, so a late stop from
      // this recording cannot be delivered to a newly mounted page.
      owner = {
        stopped: result => { Taro.getFileSystemManager().unlink({ filePath: result.tempFilePath, fail: () => undefined }); },
        failed: () => undefined,
      };
      recorder?.stop();
    },
  };
}
