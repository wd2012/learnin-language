import { realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realProviderConfig } from './config';
import { CompatibleLlmProvider } from './llm';
import { PaidCallGate } from './policy';
import { TencentAsrProvider, TencentTtsProvider } from './tencent';
import { readVerificationPlan, VerificationBudget, VerificationEvent, verifyPipeline } from './verification';

export async function verifyMain(args: string[]) {
  const allowed = new Set(['--manifest', '--output', '--budget-cny', '--allow-paid', '--dry-run']);
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) throw new Error('未知验证参数');
    if (['--manifest', '--output', '--budget-cny'].includes(args[index])) index++;
  }
  const argument = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`请提供 ${name}`);
    return args[index + 1];
  };
  const dryRun = args.includes('--dry-run');
  if (!dryRun && !args.includes('--allow-paid')) throw new Error('未提供 --allow-paid，不发送付费请求；可先使用 --dry-run');
  const budget = new VerificationBudget(Number(argument('--budget-cny')) * 1000000);
  const plan = await readVerificationPlan(resolve(argument('--manifest')));
  if (dryRun) {
    console.log(JSON.stringify({ mode: 'dry-run', paidCalls: 0, languages: plan.cases.map(item => item.language), rounds: 10, plannedCalls: 30, budgetCny: budget.limitMicros / 1000000, note: '只校验单价配置和本地录音，不读取凭据，不验证云服务，不代表费用报价' }));
    return;
  }
  // Never place private recordings, transcripts or generated audio in the checkout.
  const output = realpathSync(argument('--output'));
  const checkout = realpathSync(resolve(__dirname, '../../../..'));
  const local = relative(checkout, output);
  if (!local || (!isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep))) throw new Error('输出目录必须位于仓库之外，且已由你创建');
  const config = realProviderConfig();
  const gate = new PaidCallGate(true); // Reached only after the explicit CLI flag and all preflight checks.
  const report: { status: string; authorizedBudgetCny: number; estimatedUpperMicros: number; actualCloudBill: null; events: VerificationEvent[]; turns: unknown[]; failure?: string } = {
    status: 'running', authorizedBudgetCny: budget.limitMicros / 1000000, estimatedUpperMicros: 0, actualCloudBill: null, events: [], turns: [],
  };
  const reportPath = resolve(output, 'verification-report.json');
  // An existing report may include billed/uncertain work; refuse silent reruns.
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  const save = () => {
    report.estimatedUpperMicros = budget.usedMicros;
    const temporary = reportPath + '.tmp';
    writeFileSync(temporary, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, reportPath);
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    await verifyPipeline(plan, { asr: new TencentAsrProvider(config.tencent, gate), llm: new CompatibleLlmProvider(config.llm, gate), tts: new TencentTtsProvider(config.tencent, gate) }, budget, {
      event: event => { report.events.push(event); save(); },
      turn: (language, round, transcript, reply, audioBase64) => {
        const audioFile = `${language}-${round}.wav`;
        writeFileSync(resolve(output, audioFile), Buffer.from(audioBase64, 'base64'), { flag: 'wx', mode: 0o600 });
        report.turns.push({ language, round, transcript, reply, audioFile }); save();
      },
    }, controller.signal);
    report.status = 'completed'; save();
    console.log(`验证完成：${report.turns.length}轮；估算预留 ¥${(budget.usedMicros / 1000000).toFixed(4)}。实际账单需在供应商后台核对，音频需人工回听。报告已保存在指定的私有目录。`);
  } catch (error) {
    report.status = 'stopped';
    report.failure = error instanceof Error ? error.message : '验证中止'; save();
    throw error;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}

if (require.main === module) verifyMain(process.argv.slice(2)).catch(error => {
  // Adapters sanitize errors; never dump error objects/stacks/request payloads.
  console.error(error instanceof Error ? error.message : '验证失败'); process.exitCode = 1;
});
