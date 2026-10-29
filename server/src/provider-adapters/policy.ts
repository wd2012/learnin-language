import { BadGatewayException, GatewayTimeoutException, HttpException, ServiceUnavailableException } from '@nestjs/common';

/** Construction does not authorize paid calls. The application uses Mock by default. */
export class PaidCallGate {
  constructor(private readonly explicitlyEnabled = false) {}
  assertAllowed(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.explicitlyEnabled) throw new ServiceUnavailableException('真实 Provider 尚未获准启用，未发送付费请求');
  }
}

export async function providerCall<T>(label: string, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  try { return await action(); }
  catch (error) {
    // Never surface upstream messages: they may contain credentials or user text.
    if (signal.aborted) throw new GatewayTimeoutException(`${label} 请求已取消或超时`);
    if (error instanceof HttpException) throw error;
    throw new BadGatewayException(`${label} 服务暂不可用，请稍后手动重试`);
  }
}

export function validText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new BadGatewayException(`${label} 返回内容不符合约定`);
  return value.trim();
}
