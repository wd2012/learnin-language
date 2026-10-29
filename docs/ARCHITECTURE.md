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
语音转写、对话和合成接口现已实现本地 Mock 版本，并新增 `/api/session` 与 `/api/usage/monthly`。词典接口仍待实现；真实服务商适配器已添加独立验证入口，但尚未接入HTTP服务或通过真实服务验证；不要将 Mock 接口等同于真实语音和 AI 能力。详见 [Mock 口语练习说明](MOCK_SPEAKING.md)。

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
每轮提交记录实际测试的命令、结果及无法验证项。当前安装、类型检查、微信构建和本地 Mock 自动化测试已通过；开发者工具交互与真机验证仍未完成。


## 8. 中国大陆优先：国内AI与语音架构
- 前端仍为微信小程序 Taro + React + TypeScript + Zustand；新增国内可用的 NestJS 服务端，处理 ASR、TTS、LLM，绝不在小程序中存储服务商密钥。
- 候选方案：腾讯云语音识别ASR（逐项验证英语/日语引擎）、腾讯云或其他国内服务商 TTS（逐项验证英日音色及接口）、阿里云百炼文本模型（验证国内地域、网络及费用）。这只是待验证的初选，不代表已完成采购或接入。
- 实现适配器层：SpeechToTextProvider、TextToSpeechProvider、ChatProvider，包含 mock 实现，便于在没有密钥时开发与自动化测试。
- 接口设计：POST /api/speech/transcribe（multipart，音频、语言、大小和时长校验）；POST /api/conversation/turn（语言、场景、可修正的识别文本、有限历史，返回结构化纠错及追问）；POST /api/speech/synthesize（当前为语言、文本；音色待真实适配时添加）；GET /api/usage/monthly（用量、估算金额、预算提示）。当前这些接口仅有本地 Mock 实现，纠错字段回显原句，TTS返回提示音，金额与Token为演示估算。
- 逐轮链路：小程序录音 → 安全HTTPS上传 → ASR → 用户核对/可修改识别文本 → LLM纠错及追问 → TTS语音 → 小程序播放。错误降级：ASR失败可手动输入，TTS失败展示文本，LLM失败仍可离线学习。
- 预算：目标20–50元/月。分别计量ASR时长、LLM输入输出token、TTS字数/时长，限制单次时长、请求频率和token数量；实现每月应用层软预算和提醒；另在云厂商侧设账单告警。应用层软限额不等于绝对硬封顶，还要计入服务器、域名、流量费用。
- 安全与合规：后端鉴权、限流、上传格式/大小验证、私有配置、HTTPS、最少必要日志和语音数据留存周期。体验版同样要验证合法请求/上传/下载域名、微信权限、国内服务器及域名备案要求。
- 禁止未经同意上传录音；默认不永久存储录音或个人对话正文。不要硬编码供应商价格、模型版本、AppID、AppSecret。供应商接入前需要用英语和日语真实录音验证效果、时延和成本。


## 9. 真实 Provider 准备阶段

`server/src/provider-adapters/` 包含腾讯云 ASR／TTS、百炼兼容 LLM 适配器，默认禁止付费请求。当前HTTP应用继续注册Mock；独立验证入口在显式 `--allow-paid`、本机安全凭据、已核实的模型／音色／单价和外部私有录音清单都齐备后，才能执行英日各5轮验证。用户已授权本次验证不超过5元，随后指定先完成代码与开通指引，因此本轮真实调用为0。当前步骤、未验证项与预算算法边界见 [真实 Provider 指引](REAL_PROVIDERS.md)。
