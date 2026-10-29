# 真实语音与模型服务：开通、配置及验证

## 当前交付与授权范围

用户已确认候选方案为腾讯云 ASR／TTS、阿里云百炼 LLM，本次真实验证预算上限5元人民币；随后指定本轮先完成代码与配置指引，稍后再执行真实验证。因此本轮真实付费调用0次、实际API费用0元，没有开通或购买云资源。

已实现腾讯云一句话识别、语音合成、百炼 OpenAI 兼容协议适配器，以及英日各5轮的独立验证入口。适配器默认关闭付费调用，只有验证命令显式传入 `--allow-paid` 才会授权该进程的实际请求。密钥、模型、单价、音色均不写死在代码中。

现有 Nest HTTP 服务和 Taro 页面继续注册 Mock；设置 `PROVIDER_MODE=real` 仍会拒绝启动，避免在只有模拟预算／本地开发鉴权的接口上意外计费。下面的真实验证是本机独立执行的 ASR→LLM→TTS链路，不是微信真机端到端验收。通过验证后仍需接入真实费用账本、鉴权与合法域名，再把真实 Provider 接到小程序。

## 1. 开通服务，不购买云主机或资源包

1. 登录腾讯云控制台，完成账户要求的实名验证，开通语音识别和语音合成。选择按量使用，不购买资源包、云主机或其他资源；检查余额与账单告警。
2. 在 API 调试工具中确认一句话识别 `SentenceRecognition` 的英语、日语引擎与地域。本次锁定的官方 SDK 声明列出 `16k_en` 和 `16k_ja`，但这只证明接口声明包含这些值，不能代替你的账户、地域和音频效果实测。
3. 查腾讯云官方音色列表，分别选择**已明确支持英语和日语**的音色并核实单价。音色ID必须手动配置，不能把中文音色当作日语。当前 SDK 的 `PrimaryLanguage` 只列出1（中文）和2（英文），不要虚构日语枚举。日语默认不发送该参数，实际行为必须按选定音色验证；若没有适用日语音色，先暂停日语 TTS，不能静默换中文或换供应商计费。
4. 在腾讯云访问管理中创建专用子用户／短期凭据，仅授予一句话识别、语音合成所需操作；资源范围能力以当前官方策略为准。不要使用主账号长期密钥做日常开发。
5. 登录阿里云百炼／Model Studio，完成账户要求并开通模型服务。选择中国大陆可用地域，核实支持 `response_format=json_object` 的模型及输入／输出单价。创建专用 API Key，记录控制台准确的模型标识。本适配器仅实现北京接入域名；其他地域需要另行核实并修改受控端点，不能混用不同地域的Key。
6. 在两个平台设置账单／用量告警。若5元提醒不受支持，记录平台实际最小值；**通知不是硬封顶**，云端账单可能延迟。不要开通额外自动购买、资源续费或其他付费功能来完成验证。

参考入口（本轮环境无法访问官网正文，需你在浏览器核对最新说明）：

- [腾讯云一句话识别](https://cloud.tencent.com/document/product/1093/37823)
- [腾讯云音色列表](https://cloud.tencent.com/document/product/1073/92668)
- [腾讯云语音合成购买指南](https://cloud.tencent.com/document/product/1073/34112)
- [百炼 OpenAI 兼容调用](https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api)
- 官方 `tencentcloud-sdk-nodejs-asr`、`tencentcloud-sdk-nodejs-tts` 已锁定4.1.335，接口字段依据包内类型声明；没有因此认定云服务已验收。

## 2. 密钥只放在本机服务端环境

推荐在你自己的电脑运行验证。不要在聊天、Git、截图、PR、清单或前端环境中保存密钥。可使用操作系统凭据管理器或终端不回显输入，将值注入当前服务端进程；结束后清理当前会话变量。

本轮云环境未配置任何腾讯云／百炼凭据。腾讯云 SDK 在本地执行 TC3 签名，需要真实 SecretKey；HTTPS代理占位变量不能用于计算签名。若之后改为由云环境执行，先提供支持安全注入原始签名凭据的运行环境，不能把密钥放进聊天或把占位值当作真实凭据。百炼 Bearer Key 可以使用匹配域名的受支持代理注入，仍需实际验证。

| 服务端变量 | 内容 | 是否秘密 |
| --- | --- | --- |
| `TENCENT_SECRET_ID` | 专用腾讯云 SecretId | 是 |
| `TENCENT_SECRET_KEY` | TC3签名所需 SecretKey | 是 |
| `TENCENT_SESSION_TOKEN` | 使用短期凭据时的Token，可选 | 是 |
| `TENCENT_REGION` | 控制台核实的地域 | 否 |
| `TENCENT_ASR_ENGINE_EN` / `TENCENT_ASR_ENGINE_JA` | 已核实的引擎标识 | 否 |
| `TENCENT_TTS_VOICE_EN` / `TENCENT_TTS_VOICE_JA` | 已核实且价格明确的正整数音色ID | 否 |
| `TENCENT_TTS_PRIMARY_LANGUAGE_EN` | 若音色要求，可设置2；可选 | 否 |
| `TENCENT_TTS_PRIMARY_LANGUAGE_JA` | 默认不设置，勿填虚构枚举 | 否 |
| `DASHSCOPE_API_KEY` | 百炼当前地域的专用API Key | 是 |
| `DASHSCOPE_MODEL` | 已核实的模型标识，无默认值 | 否 |
| `LLM_MAX_OUTPUT_TOKENS` | 默认512，最大1024 | 否 |

例如在 Bash 中，可通过 `read -rs` 安全输入一个值并导出，输入内容不会出现在命令历史；不要开启 `set -x`：

```bash
read -rs -p 'Tencent SecretId: ' TENCENT_SECRET_ID; echo
export TENCENT_SECRET_ID
read -rs -p 'Tencent SecretKey: ' TENCENT_SECRET_KEY; echo
export TENCENT_SECRET_KEY
read -rs -p 'DashScope API key: ' DASHSCOPE_API_KEY; echo
export DASHSCOPE_API_KEY
# 在同一终端设置表中的非秘密参数，值以控制台核实结果为准。
```

程序不输出凭据、完整上游错误或请求对象。若配置不完整，只报告缺少的变量名；HTTP服务仍不使用这些变量发起真实调用。

## 3. 准备私有音频和价格清单

在**仓库外**创建私有工作目录，例如电脑上的 `~/linguapath-private`。将 `server/verification.example.json` 复制到该目录，重命名为 `plan.json`；录音放在旁边的 `audio/`。不要将录音或填好的配置提交Git。

每种语言准备5段不同的真人录音，每段不超过10秒，MP3／WAV／AAC且不超过2MiB。原始录音由你明确运行付费验证命令后上传给腾讯云。可以使用以下自编短句，或录制你自己的内容：

| 英语 | 日语 |
| --- | --- |
| I build web applications with React. | こんにちは。日本語を勉強しています。 |
| I use TypeScript to catch errors early. | 今日は家で仕事をしました。 |
| I write tests for important user flows. | 週末に公園へ行きたいです。 |
| I discuss trade-offs with my team. | 好きな食べ物はうどんです。 |
| I want to improve my English speaking. | 明日は友達と買い物をします。 |

预录样例用于连续验证5轮接口与上下文，不代表用户已经能自然回答模型动态追问。真实口语交互质量还需手机验收。

清单内所有价格默认 `null`，必须根据所选引擎、音色、模型的官方最新单价填写正数，不能直接使用Mock费率。单位为**微元人民币**，1元=1,000,000微元：

- ASR `asrMicrosPerSecond`：元／小时 ×1,000,000÷3600，或元／分钟 ×1,000,000÷60；英日分别填。
- TTS `ttsMicrosPerCharacter`：元／万字符 ×1,000,000÷10000；英日音色分别填。若音色实际按其他单位计费，不要强行套用此字段，先调整预算算法。
- LLM `llmInputMicrosPerToken`、`llmOutputMicrosPerToken`：元／百万Token的数值，恰好等于微元／Token。输入、输出分别核实，缓存、阶梯价格或附加费用应按不享受优惠的保守上界处理。

费用策略：每次调用前预留估算金额，ASR按整分钟向上取整；LLM用UTF-8字节数加4096系统／聊天开销估算输入上界，输出按1024 Token预留；TTS按返回问题字符数和所选音色单价预留。该策略需与实际计费单位、模型分词及附加费用核对，**不是云账单的绝对保证**。费用不明、单位不匹配或无法核实价格时不要启动付费验证。

## 4. 先执行零付费预检

在仓库根目录安装并编译：

```bash
npm ci
npm --prefix server ci
npm run typecheck
npm test
npm run server:test
npm run build:weapp
```

然后仍在仓库根目录运行（将路径改成你实际的私有目录）：

```bash
npm --prefix server run providers:verify -- \
  --manifest "$HOME/linguapath-private/plan.json" \
  --budget-cny 5 --dry-run
```

预检只读取本地清单、价格和10段录音，不读取服务凭据、不创建供应商客户端请求、不调用付费API。它会确认两种语言各5段录音、格式可解析、时长／体积限制及单价配置；不能证明音色、Key、网络、模型或最终费用可用。

## 5. 准备好后再执行真实验证

本轮按你的选择尚未运行此命令。确定服务、价格、凭据、告警和录音都准备好后，在同一服务端终端运行：

```bash
# 先在仓库外新建一个私有、空的结果目录
mkdir -m 700 "$HOME/linguapath-private/run-01"

npm --prefix server run providers:verify -- \
  --manifest "$HOME/linguapath-private/plan.json" \
  --budget-cny 5 --allow-paid \
  --output "$HOME/linguapath-private/run-01"
```

命令最多按清单执行30次请求：英／日各5轮，每轮一次ASR、一次LLM、一次TTS。不会自动重试；预算不足、返回格式错误、缺少实际LLM用量或任一步失败即停止。单个调用20秒取消，腾讯SDK HTTP超时15秒；取消请求不保证供应商不会计费。

输出目录必须已经存在且在仓库外。它会保存包含转写、反馈、LLM实际Token和TTS音频的私有报告，文件权限600；报告创建后先记录每次费用预留，再发送请求。**失败或取消不退还预留估算**，避免把可能已计费的请求当作免费。已有报告时拒绝覆盖或自动续跑；重跑前先核对两个平台账单，将前次已用与未结算金额计入总授权5元。不要为了绕过预算提示随意换输出目录。

结果要人工核对：

1. 十段转写是否忠实反映原始录音；LLM纠错／改写是否合理，追问是否使用目标语言且没有虚构发音分数。
2. 回听十段生成WAV，分别确认英语／日语确实为目标语言、无明显截断；程序检查WAV结构不等于听力质量通过。
3. 报告是否有两种语言各5轮、全部阶段完成、时延与实际LLM Token；核对腾讯云和百炼最终账单，报告中的估算预留不是最终账单。
4. 只有上述真实验证通过，才能标记对应引擎／音色／模型通过；当前没有任何真实能力被标记通过。

## 网络、安全及未验证项

运行真实验证需要 HTTPS 访问 `asr.tencentcloudapi.com`、`tts.tencentcloudapi.com`、`dashscope.aliyuncs.com`。腾讯SDK显式继承 `HTTPS_PROXY`，百炼传输使用 `EnvHttpProxyAgent`，不关闭TLS校验、不绕过网络策略。当前云环境未开放这些目的地，也没有原始签名凭据；本机执行需遵守本机网络策略。

本轮官网文档访问被403拒绝；请求／响应字段已用官方SDK声明及本地测试替身验证，实时价格、账户权限、日语音色、百炼模型JSON模式、国内网络连通性、真人ASR准确性、TTS质量、云端计费与微信真机均未验证。

尚未实现的独立工作：真实Provider接入HTTP服务、小程序真实模式、微信登录、持久化真实费用账本、幂等计费、HTTPS和合法域名／备案适用要求。原有Mock预算仍只在内存；本轮没有把之前的持久化草稿混入此功能分支。

## 本轮实际测试结果

- `npm test`：前端6项通过。
- `npm run typecheck`、`npm run build:weapp`：通过，保留全部5个页面。
- `npm run server:test`：22项通过。包括原有8项、腾讯／百炼适配契约与零付费门禁、官方SDK和HTTP传输的离线拦截、英日各5轮适配器链路、预算不足／失败中止、清单预检和敏感错误脱敏。
- `npm --prefix server ci`：锁文件干净安装通过；`npm --prefix server audit --omit=dev`：0个已知漏洞。腾讯SDK间接依赖通过局部uuid 11.1.1 override修复，未修改原有Taro依赖。
- 实际云服务请求0次，付费金额0元；没有人工回听或微信真机结果。离线SDK／HTTP替身测试不能代替真实签名、权限、云接口兼容性、准确率或最终账单验证。
