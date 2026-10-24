import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Ip,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { Observable, map, merge, interval } from 'rxjs';
import type { CorrectionInput, LiveState, SwarmState } from '@quell/shared';
import { CHANNEL } from './core/community';
import { EventsService } from './core/events.service';
import { StoreService } from './core/store.service';
import { CorrectionsService } from './moderation/corrections.service';
import { EvalService } from './moderation/eval.service';
import { TASK_FINGERPRINT, TASK_MODEL } from './moderation/frozen';
import { MetricsService } from './moderation/metrics.service';
import { ModerationService } from './moderation/moderation.service';
import { SwarmService } from './swarm/swarm.service';

const CROWD_GAP_MS = 2500;
const MAX_LENGTH = 300;

@Controller()
export class ApiController {
  private readonly lastPost = new Map<string, number>();
  // Hard block-list for crowd input: abusive text never reaches the screen.
  private readonly profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

  constructor(
    private readonly store: StoreService,
    private readonly events: EventsService,
    private readonly moderation: ModerationService,
    private readonly corrections: CorrectionsService,
    private readonly metrics: MetricsService,
    private readonly swarm: SwarmService,
    private readonly evals: EvalService,
  ) {}

  @Get('state')
  state(): LiveState {
    return {
      messages: this.store.recent(250),
      rules: this.store.rules,
      metrics: this.metrics.compute(),
      swarm: this.swarm.snapshot,
      task: { model: TASK_MODEL, fingerprint: TASK_FINGERPRINT },
      evaluation: this.evals.latest,
    };
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const events = this.events.stream.pipe(map((e) => ({ type: e.type, data: e.data }) as MessageEvent));
    // Comment-style heartbeat keeps proxies from closing an idle stream.
    const heartbeat = interval(15_000).pipe(map(() => ({ type: 'ping', data: {} }) as MessageEvent));
    return merge(events, heartbeat);
  }

  @Post('ingest')
  ingest(@Body() body: { author?: string; text?: string }, @Ip() ip: string) {
    const text = (body.text ?? '').trim();
    const author = (body.author ?? '').trim().slice(0, 24) || 'guest';
    if (!text) throw new BadRequestException('Message is empty.');
    if (text.length > MAX_LENGTH) throw new BadRequestException(`Keep it under ${MAX_LENGTH} characters.`);
    const last = this.lastPost.get(ip) ?? 0;
    if (Date.now() - last < CROWD_GAP_MS) {
      throw new HttpException('Slow down a little.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.lastPost.set(ip, Date.now());
    if (this.profanity.hasMatch(text) || this.profanity.hasMatch(author)) {
      throw new BadRequestException('That one was blocked before it reached the channel.');
    }
    const m = this.moderation.submit({
      id: randomUUID(),
      channel: CHANNEL,
      author,
      text,
      source: 'crowd',
      createdAt: Date.now(),
    });
    return { id: m.id };
  }

  @Post('messages/:id/correct')
  correct(@Param('id') id: string, @Body() body: CorrectionInput) {
    return this.corrections.correct(id, body);
  }

  @Delete('rules/:id')
  removeRule(@Param('id') id: string) {
    this.corrections.removeRule(id);
    return { ok: true };
  }

  @Post('swarm')
  updateSwarm(@Body() body: Partial<Pick<SwarmState, 'running' | 'rate' | 'scamWave'>>) {
    return this.swarm.update(body);
  }

  /** Scores GPT before and after corrections, and an untrained open model, on the held-out set. */
  @Post('eval')
  evaluate() {
    return this.evals.start();
  }

  @Post('swarm/raid')
  raid(@Body() body: { count?: number }) {
    const count = Math.max(10, Math.min(500, Number(body?.count) || 150));
    return { posted: this.swarm.raid(count) };
  }
}
