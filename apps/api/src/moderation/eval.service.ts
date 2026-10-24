import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, EvalResult, EvalRun } from '@quell/shared';
import { CHANNEL, COMMUNITY } from '../core/community';
import { config } from '../core/config';
import { EventsService } from '../core/events.service';
import { MubitService } from '../core/mubit.service';
import { StoreService } from '../core/store.service';
import { PERSONAS } from '../swarm/personas';
import { TASK_MODEL } from './frozen';
import { type Judgement, ModerationService } from './moderation.service';

/** How many held-out messages to write per persona. */
const SET_SIZES: Record<string, number> = {
  regular: 18,
  dark_humor: 14,
  helper: 12,
  banter: 14,
  troll: 14,
  harasser: 10,
  scammer: 14,
  raider: 6,
  doxxer: 12,
};

const SET_FILE = join(config.dataDir, 'evalset.json');
const RUN_FILE = join(config.dataDir, 'eval.json');

interface Setup {
  id: string;
  label: string;
  model: string;
  withRules: boolean;
  openRouterModel?: string;
  price?: { inPerM: number; outPerM: number } | null;
}

/**
 * Scores model setups on a fixed, labelled set of messages that never appear in
 * live chat. Calls go through Mubit unrecorded, so evaluating can't train the
 * task or leak into its test cases.
 */
@Injectable()
export class EvalService {
  private readonly log = new Logger(EvalService.name);
  private run: EvalRun | null = null;

  constructor(
    private readonly mubit: MubitService,
    private readonly moderation: ModerationService,
    private readonly store: StoreService,
    private readonly events: EventsService,
  ) {
    if (existsSync(RUN_FILE)) {
      try {
        this.run = JSON.parse(readFileSync(RUN_FILE, 'utf8')) as EvalRun;
        if (this.run.status !== 'done') this.run.status = 'error';
      } catch {
        this.run = null;
      }
    }
  }

  get latest(): EvalRun | null {
    return this.run;
  }

  start(): EvalRun {
    if (this.run && (this.run.status === 'running' || this.run.status === 'preparing')) {
      throw new ConflictException('An evaluation is already running.');
    }
    const setups = this.setups();
    this.run = {
      id: randomUUID(),
      startedAt: Date.now(),
      status: 'preparing',
      size: 0,
      results: setups.map((s) => emptyResult(s)),
    };
    this.publish();
    void this.execute(setups).catch((err: Error) => {
      this.log.error(`evaluation failed: ${err.message}`);
      if (this.run) Object.assign(this.run, { status: 'error', error: err.message, finishedAt: Date.now() });
      this.publish(true);
    });
    return this.run;
  }

  private setups(): Setup[] {
    const gptPrice =
      process.env.GPT_PRICE_IN && process.env.GPT_PRICE_OUT
        ? { inPerM: Number(process.env.GPT_PRICE_IN), outPerM: Number(process.env.GPT_PRICE_OUT) }
        : null;
    const openModel = process.env.EVAL_OPEN_MODEL ?? 'qwen/qwen3-30b-a3b-instruct-2507';
    return [
      { id: 'gpt-before', label: 'GPT, before corrections', model: TASK_MODEL, withRules: false, price: gptPrice },
      { id: 'gpt-after', label: 'GPT + your corrections', model: TASK_MODEL, withRules: true, price: gptPrice },
      { id: 'open-after', label: 'Open Qwen3, untrained', model: openModel, withRules: true, openRouterModel: openModel },
    ];
  }

  private async execute(setups: Setup[]): Promise<void> {
    const set = await this.evalSet();
    const run = this.run!;
    run.size = set.length;
    run.status = 'running';
    this.publish(true);

    const rules = this.store.rules.map((r) => r.text);
    for (const [i, setup] of setups.entries()) {
      const outcomes: { m: ChatMessage; j: Judgement }[] = [];
      let errors = 0;
      await Promise.all(
        set.map(async (m) => {
          try {
            const j = await this.moderation.evaluate(m, {
              rules: setup.withRules ? rules : [],
              recent: [],
              openRouterModel: setup.openRouterModel,
            });
            outcomes.push({ m, j });
          } catch {
            errors++;
          }
          run.results[i] = score(setup, outcomes, errors, set.length, setup.withRules ? rules.length : 0);
          this.publish();
        }),
      );
    }
    run.status = 'done';
    run.finishedAt = Date.now();
    this.publish(true);
  }

  /** The held-out set: generated once, then reused so runs are comparable. */
  private async evalSet(): Promise<ChatMessage[]> {
    if (existsSync(SET_FILE)) return JSON.parse(readFileSync(SET_FILE, 'utf8')) as ChatMessage[];
    const set: ChatMessage[] = [];
    await Promise.all(
      PERSONAS.map(async (p) => {
        const n = SET_SIZES[p.id] ?? 8;
        const res = await this.mubit.client.chat.completions.create(
          {
            model: config.swarmModel,
            temperature: 1,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  `You write realistic live-chat messages for a Discord server: ${COMMUNITY.about} ` +
                  'Return JSON: {"messages":[{"author":"username","text":"message"}]}. Every message must be different. ' +
                  'Usernames are short and lowercase. Never use slurs. Any personal details must be invented.',
              },
              { role: 'user', content: `Write ${n} messages for an evaluation set, from ${p.brief}` },
            ],
          },
          { headers: MubitService.UNRECORDED },
        );
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as {
          messages?: { author?: string; text?: string }[];
        };
        for (const m of (parsed.messages ?? []).slice(0, n)) {
          if (!m.text?.trim()) continue;
          set.push({
            id: randomUUID(),
            channel: CHANNEL,
            author: m.author?.trim() || p.authors[0],
            text: m.text.trim().slice(0, 300),
            source: 'swarm',
            persona: p.id,
            expected: p.expected,
            createdAt: Date.now(),
          });
        }
      }),
    );
    writeFileSync(SET_FILE, JSON.stringify(set, null, 2));
    return set;
  }

  private lastPublish = 0;

  private publish(force = false): void {
    if (!this.run) return;
    const now = Date.now();
    if (!force && now - this.lastPublish < 400) return;
    this.lastPublish = now;
    writeFileSync(RUN_FILE, JSON.stringify(this.run));
    this.events.emit({ type: 'eval', data: this.run });
  }
}

function emptyResult(s: Setup): EvalResult {
  return {
    id: s.id,
    label: s.label,
    model: s.model,
    rules: 0,
    done: 0,
    total: 0,
    errors: 0,
    agreement: null,
    wronglyBlocked: 0,
    scamsCaught: 0,
    scamsTotal: 0,
    piiHidden: 0,
    piiTotal: 0,
    latencyP50: null,
    latencyP95: null,
    tokensPerMessage: null,
    costPer1k: null,
  };
}

function score(
  s: Setup,
  outcomes: { m: ChatMessage; j: Judgement }[],
  errors: number,
  total: number,
  rules: number,
): EvalResult {
  const n = outcomes.length;
  const agree = outcomes.filter(({ m, j }) => j.decision.action === m.expected!.action).length;
  const scams = outcomes.filter(({ m }) => m.expected!.reason === 'scam');
  const pii = outcomes.filter(({ m }) => m.expected!.action === 'redact');
  const lat = outcomes.map(({ j }) => j.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => (lat.length ? lat[Math.floor((lat.length - 1) * p)] : null);
  const tokens = outcomes.reduce((t, { j }) => t + j.usage.tokensIn + j.usage.tokensOut, 0);

  let costPer1k: number | null = null;
  if (n && s.openRouterModel) {
    const reported = outcomes.map(({ j }) => j.usage.costUsd).filter((c): c is number => c !== null);
    if (reported.length) costPer1k = (reported.reduce((a, b) => a + b, 0) / reported.length) * 1000;
  } else if (n && s.price) {
    const tin = outcomes.reduce((t, { j }) => t + j.usage.tokensIn, 0) / n;
    const tout = outcomes.reduce((t, { j }) => t + j.usage.tokensOut, 0) / n;
    costPer1k = ((tin * s.price.inPerM + tout * s.price.outPerM) / 1_000_000) * 1000;
  }

  return {
    ...emptyResult(s),
    rules,
    done: n + errors,
    total,
    errors,
    agreement: n ? agree / n : null,
    wronglyBlocked: outcomes.filter(
      ({ m, j }) => m.expected!.action === 'allow' && (j.decision.action === 'remove' || j.decision.action === 'flag'),
    ).length,
    scamsCaught: scams.filter(({ j }) => j.decision.action === 'remove').length,
    scamsTotal: scams.length,
    piiHidden: pii.filter(({ j }) => j.decision.action === 'redact').length,
    piiTotal: pii.length,
    latencyP50: pct(0.5),
    latencyP95: pct(0.95),
    tokensPerMessage: n ? Math.round(tokens / n) : null,
    costPer1k,
  };
}
