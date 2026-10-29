import React from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { lessons } from '../../data/lessons';
import { useLearning } from '../../store/learning';

export default function Home() {
  const completed = useLearning(state => state.completed);
  const done = Object.keys(completed).length;
  return <View className='container'>
    <View className='hero'>
      <View className='title'>每天进步一点点 ✨</View>
      <View className='subtitle'>英语技术表达 × 日语生活入门</View>
      <View className='subtitle'>已完成 {done} / {lessons.length} 节入门课程</View>
    </View>
    <View className='card'>
      <View className='card-title'>今日推荐 · 英语</View><Text className='muted'>练习用英语介绍自己的工程经历</Text>
      <Button className='btn' onClick={() => Taro.navigateTo({ url: '/pages/practice/index?id=en-intro' })}>开始20分钟口语练习</Button>
    </View>
    <View className='card'>
      <View className='card-title'>今日推荐 · 日语</View><Text className='muted'>从问候和简单自我介绍开始</Text>
      <Button className='btn secondary' onClick={() => Taro.navigateTo({ url: '/pages/practice/index?id=ja-greet' })}>开始15分钟日语练习</Button>
    </View>
    <View className='card'>
      <View className='card-title'>逐轮口语练习 · Mock</View><Text className='muted'>英语与日语文本对话、录音上传演示及月度模拟预算；不调用真实 AI。</Text>
      <Button className='btn' onClick={() => Taro.navigateTo({ url: '/pages/conversation/index' })}>打开 Mock 练习</Button>
    </View>
    <View className='card'><View className='card-title'>学习方式</View><Text className='muted'>① 阅读课程内容　② 朗读并录音　③ 回放检查　④ 完成打卡。课程数据与学习记录均保存在本机。</Text></View>
  </View>;
}
