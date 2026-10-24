import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { config } from './config';

/**
 * Every LLM call goes through Mubit. `recorded` calls are what Mubit groups
 * into tasks and trains on; unrecorded ones (swarm generation, evals) carry
 * `x-middleware-record: off` so they never form a task or a kept example.
 */
@Injectable()
export class MubitService {
  readonly client = new OpenAI({
    apiKey: config.mubitKey,
    baseURL: `${config.mubitBase}/openai/v1`,
    maxRetries: 3,
    timeout: 60_000,
  });

  static readonly UNRECORDED = { 'x-middleware-record': 'off' } as const;
}
