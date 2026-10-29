# LinguaPath · 英语与日语学习微信小程序

基于 Taro + React + TypeScript 的个人语言学习项目，目标为提高英语和日语的听力、口语与词汇能力。

## 项目状态

已有课程样例、录音回放和本地打卡，并新增 NestJS Mock 逐轮口语练习基础流程；真实 AI、完整学习功能和真机验证仍待完成。

## 本地开发

使用 Node.js 22.8+（当前验证版本 24.19.0）：

```bash
npm ci
npm --prefix server ci
npm run typecheck
npm test
npm run server:test
npm run build:weapp
```

两个终端分别运行 `npm run server:dev` 和 `npm run dev:weapp`。微信开发者工具导入仓库根目录，在首页打开“逐轮口语练习 · Mock”，连接本地服务。服务端仅监听本机，不支持直接在手机上联调。

安装、接口、模拟费用、测试范围与中国大陆上线前检查见 [Mock 口语练习说明](docs/MOCK_SPEAKING.md)。本次没有调用真实付费 API，也没有购买云资源。

真实腾讯云 ASR／TTS 和百炼 LLM 适配器、零付费预检、服务开通与5元额度内的独立验证步骤见 [真实 Provider 指引](docs/REAL_PROVIDERS.md)。现有小程序和HTTP服务继续使用Mock；真实验证命令默认不发送付费请求。

## 功能规划

- 英语日常交流、技术英语、软件工程师面试练习
- 日语五十音、N5入门及赴日生活场景训练
- 逐句听力、循环、变速、听写与字幕
- 录音回放、语音识别、AI逐轮对话与纠错（后续需服务端）
- 英日词典、发音、例句、生词本和间隔复习
- 每日学习任务、打卡和进度统计

请阅读 [产品需求](docs/PRD.md)、[技术架构](docs/ARCHITECTURE.md) 与 [Codex 指令](AGENTS.md)。

> 不要将微信 AppSecret、AI API Key 或私人音频上传到仓库。
