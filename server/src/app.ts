import 'reflect-metadata';
import { Body, Controller, Get, Module, Post, UploadedFile, UseGuards, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { json } from 'express';
import { LanguageDto, SynthesizeDto, TurnDto } from './dto';
import { settings } from './config';
import { MockAsrProvider, MockLlmProvider, MockTtsProvider, ASR, LLM, TTS } from './providers';
import { PracticeService } from './practice.service';
import { ApiGuard, RateLimiter, SessionService } from './security';
import { UsageService } from './usage';

@Controller('api')
@UseGuards(ApiGuard)
class ApiController {
  constructor(private readonly practice: PracticeService, private readonly usage: UsageService, private readonly sessions: SessionService) {}
  @Post('session') session() { return this.sessions.create(); }
  @Get(['usage', 'usage/monthly']) stats() { return this.usage.snapshot(); }
  @Post('speech/transcribe')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1, fieldSize: 100 } }))
  transcribe(@UploadedFile() file: Express.Multer.File, @Body() input: LanguageDto) { return this.practice.transcribe(file, input.language); }
  @Post('conversation/turn') turn(@Body() input: TurnDto) { return this.practice.turn(input); }
  @Post('speech/synthesize') synthesize(@Body() input: SynthesizeDto) { return this.practice.synthesize(input); }
}

export async function createApp() {
  const config = settings();
  @Module({
    controllers: [ApiController],
    providers: [
      { provide: ASR, useClass: MockAsrProvider }, { provide: LLM, useClass: MockLlmProvider }, { provide: TTS, useClass: MockTtsProvider },
      { provide: SessionService, useFactory: () => new SessionService() },
      { provide: RateLimiter, useFactory: () => new RateLimiter(config) },
      { provide: UsageService, useFactory: () => new UsageService(config) },
      { provide: PracticeService, useFactory: (asr: MockAsrProvider, llm: MockLlmProvider, tts: MockTtsProvider, usage: UsageService) => new PracticeService(asr, llm, tts, usage, config), inject: [ASR, LLM, TTS, UsageService] },
      ApiGuard,
    ],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  app.use(json({ limit: '64kb' }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  return app;
}
