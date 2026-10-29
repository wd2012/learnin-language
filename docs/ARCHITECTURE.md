# LinguaPath 技术架构

## 1. 技术路线
前端：微信小程序、Taro 4、React 18、TypeScript、Zustand、Taro Storage；本地优先。
后端（AI阶段才引入）：NestJS + TypeScript。服务端作为语音识别、语音合成、AI模型、词典服务的统一代理，不将API密钥传给小程序。

## 2. 分层
- pages：home / course / practice / progress，后续扩充 listening / dictionary / chat。
- components：AudioPlayer、RecordButton、Transcript、VocabCard、LessonCard。
- features：lessons、listening、speaking、dictionary、review、progress。
- services：storage、recorder、audio、lessonRepository、dictionaryClient；与组件分离。
- store：用户本地进度、收藏单词、每日任务状态，不存储长期敏感录音。
- data：本地授权的课程和词汇资源；课程音频来源和许可须记录。

## 3. 音频与语音流程
- 听力：课程音频元数据→播放器→字幕段落同步→答题→保存进度。远程音频须符合微信小程序域名配置。
- 跟读：用户触发录音→申请权限→录音临时文件→播放回听→用户选择保存/清除。停止、退后台、卸载组件要释放录音及播放器资源。
- AI逐轮：用户主动提交录音→后端上传接口→ASR→对话/纠错模型→TTS（可选）→返回文本、音频播放链接和结构化反馈。失败与超时要单独处理。
- 实时对话是后续探索，先验证微信基础库网络、音频和实际服务端实时流能力，不承诺立即支持。

## 4. API设计草案（未实现）
- POST /api/speech/transcribe：音频上传并获得转写。
- POST /api/conversation/turn：传入场景、历史对话、文本，返回AI回复及语言纠错结构。
- POST /api/speech/synthesize：文本转语音。
- GET /api/dictionary/search?q=&lang=：词汇查询；必须标明来源并尊重授权。
以上仅为待实现协议，不应把未实现接口当作已存在。

## 5. 数据结构建议
- Lesson(id, language, level, title, segments[], vocabIds[], tasks[])。
- TranscriptSegment(id, startMs, endMs, text, translation, audioUrl?)。
- VocabularyEntry(id, headword, language, pronunciation, meanings[], examples[], source?)。
- ReviewRecord(vocabId, dueAt, intervalDays, repetitions, ease?, lastReviewedAt?)。
- ConversationTurn(role, text, createdAt, feedback?, audioUrl?)。
- LearningProgress(lessonId, status, completedAt?, durationSeconds?)。
为LocalStorage数据定义版本和迁移策略。

## 6. 安全、隐私及成本
- 微信 AppSecret、ASR、TTS、LLM 的私密凭据只放在后端环境变量或密钥管理服务，不能出现在前端仓库或客户端产物里。
- 微信小程序网络请求域名、文件上传地址、录音权限需要按平台规则配置；体验版也需实际验证。
- 设置录音大小、时长、格式和类型校验；限制 API 调用频率、开销和并发。
- 不将用户口语录音默认永久保存；提供上传前提示，后端日志避免记录完整音频或个人信息。
- AI返回内容使用明确的结构化格式并进行校验；发音评分必须由适当的语音评测服务承担。

## 7. 质量保证
1. npm install（注意锁文件一致性）。
2. npm run typecheck。
3. npm run build:weapp。
4. 微信开发者工具模拟器基础功能测试。
5. 真机检验麦克风权限、录音回放、音频控制和网络域名。
每轮提交记录实际测试的命令、结果及无法验证项。当前仓库尚未通过上述全部验证。
