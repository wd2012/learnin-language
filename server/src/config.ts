export interface Settings {
  monthlyBudgetMicros: number;
  requestsPerMinute: number;
  providerTimeoutMs: number;
}
function integer(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}
export function settings(): Settings {
  if ((process.env.PROVIDER_MODE ?? 'mock') !== 'mock') throw new Error('Only mock providers are supported');
  if (process.env.NODE_ENV === 'production') throw new Error('Mock session authentication is development-only');
  return {
    monthlyBudgetMicros: integer('MOCK_MONTHLY_BUDGET_MICROS', 20000000, 1000000000000),
    requestsPerMinute: integer('REQUESTS_PER_MINUTE', 30, 1000),
    providerTimeoutMs: integer('PROVIDER_TIMEOUT_MS', 5000, 30000),
  };
}
