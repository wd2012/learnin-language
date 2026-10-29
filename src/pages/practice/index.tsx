import React from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { getLesson, lessons } from '../../data/lessons';
import { useLearning } from '../../store/learning';
import { usePracticeAudio } from '../../hooks/usePracticeAudio';

export default function Practice() {
  const router = useRouter();
  const lesson = getLesson(router.params.id || '') || lessons[0];
  const finish = useLearning(state => state.finish);
  const completed = useLearning(state => state.completed);
  const audio = usePracticeAudio();
  return <View className='container'>
    <View className='hero'><View className='title'>{lesson.title}</View><View className='subtitle'>{lesson.level} · {lesson.minutes}分钟</View></View>
    <View className='card'>
      <View className='card-title'>阅读与跟读</View>
      <View style={{ fontSize: '34rpx', lineHeight: '1.8' }}>{lesson.passage}</View>
      <View className='divider' /><Text className='muted'>{lesson.translation}</Text>
    </View>
    <View className='card'>
      <View className='card-title'>今日重点表达</View>
      {lesson.phrases.map(phrase => <View key={phrase} className='row'><Text>• {phrase}</Text></View>)}
    </View>
    <View className='card'>
      <View className='card-title'>独立表达任务</View><View className='muted'>{lesson.prompt}</View>
      <Button className='btn' onClick={audio.recording ? audio.stop : audio.start}>{audio.recording ? '■ 停止录音' : '● 开始录音（最长60秒）'}</Button>
      <Button className='btn secondary' disabled={!audio.file || audio.recording} onClick={audio.replay}>▶ 回放我的录音</Button>
      <Button disabled={!audio.file} onClick={audio.discard}>删除本地录音</Button>
      {audio.error && <View className='muted'>{audio.error}</View>}
      <Text className='muted'>录音不自动上传；离开页面会清理录音与播放器。暂不支持自动语音评分。</Text>
    </View>
    <Button className='btn' onClick={() => { finish(lesson.id); Taro.showToast({ title: '学习完成！', icon: 'success' }); }}>{completed[lesson.id] ? '✓ 已完成 · 再次打卡' : '✓ 完成今天的学习'}</Button>
  </View>;
}
