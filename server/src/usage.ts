import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Settings } from './config';

export type Operation = 'asr' | 'llm' | 'tts';
export const SIMULATED_PRICE_MICROS: Record<Operation, number> = { asr: 1000, llm: 2000, tts: 1000 };
type Counts = Record<Operation, number>;
export interface Quantities { asrDurationMs: number; llmInputTokensEstimate: number; llmOutputTokensEstimate: number; ttsCharacters: number }
interface Month { month: string; simulatedMicros: number; reservedMicros: number; counts: Counts; quantities: Quantities; failed: number }
function empty(month: string): Month { return { month, simulatedMicros: 0, reservedMicros: 0, counts: { asr: 0, llm: 0, tts: 0 }, quantities: { asrDurationMs: 0, llmInputTokensEstimate: 0, llmOutputTokensEstimate: 0, ttsCharacters: 0 }, failed: 0 }; }

@Injectable()
export class UsageService {
  private state: Month;
  constructor(private readonly config: Settings, private readonly now: () => number = Date.now) { this.state = empty(this.month()); }
  private month() {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(this.now());
    return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
  }
  private current() { if (this.state.month !== this.month()) this.state = empty(this.month()); return this.state; }
  snapshot() {
    const s = this.current();
    return {
      month: s.month, timezone: 'Asia/Shanghai', currency: 'CNY', mock: true, actualCostMicros: 0,
      simulatedCostMicros: s.simulatedMicros, reservedMicros: s.reservedMicros,
      budgetMicros: this.config.monthlyBudgetMicros,
      reminder: s.simulatedMicros >= this.config.monthlyBudgetMicros ? 'exhausted' : s.simulatedMicros >= this.config.monthlyBudgetMicros * 0.8 ? 'warning' : 'ok',
      operations: { ...s.counts }, quantities: { ...s.quantities }, tokenMeasurement: 'mock-character-estimate', failed: s.failed, scope: 'local-server', persistence: 'memory',
    };
  }
  reserve(operation: Operation) {
    const state = this.current();
    const cost = SIMULATED_PRICE_MICROS[operation];
    if (state.simulatedMicros + state.reservedMicros + cost > this.config.monthlyBudgetMicros)
      throw new HttpException('本月模拟预算已用尽；未调用任何付费 API', HttpStatus.TOO_MANY_REQUESTS);
    state.reservedMicros += cost;
    let finished = false;
    return (success: boolean, quantities: Partial<Quantities> = {}) => {
      if (finished) return;
      finished = true;
      state.reservedMicros -= cost;
      if (success) {
        state.simulatedMicros += cost; state.counts[operation]++;
        for (const key of Object.keys(quantities) as (keyof Quantities)[]) state.quantities[key] += quantities[key] ?? 0;
      } else state.failed++;
    };
  }
}
