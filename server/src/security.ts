import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { Settings } from './config';

@Injectable()
export class SessionService {
  private sessions = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  create() {
    for (const [token, expires] of this.sessions) if (expires <= this.now()) this.sessions.delete(token);
    if (this.sessions.size >= 100) throw new HttpException('本地会话数已达上限', 429);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, this.now() + 3600000);
    return { token, expiresInSeconds: 3600, mock: true, developmentOnly: true };
  }
  verify(header?: string) {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const expiry = this.sessions.get(token);
    if (!expiry || expiry <= this.now()) { this.sessions.delete(token); throw new UnauthorizedException('本地会话已过期，请重新连接'); }
  }
}

@Injectable()
export class RateLimiter {
  private count = 0;
  private resetAt = 0;
  constructor(private readonly config: Settings, private readonly now: () => number = Date.now) {}
  consume() {
    if (this.now() >= this.resetAt) { this.count = 0; this.resetAt = this.now() + 60000; }
    if (++this.count > this.config.requestsPerMinute) throw new HttpException('请求过于频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class ApiGuard implements CanActivate {
  constructor(private readonly sessions: SessionService, private readonly limiter: RateLimiter) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    // One shared limiter includes session creation; rotating tokens cannot bypass it.
    try { this.limiter.consume(); } catch (error) { response.setHeader('Retry-After', '60'); throw error; }
    if (request.path !== '/api/session') this.sessions.verify(request.headers.authorization);
    return true;
  }
}
