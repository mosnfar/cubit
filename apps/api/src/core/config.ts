import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy apps/api/.env.example to apps/api/.env.`);
  return value;
}

export const config = {
  mubitKey: required('MUBIT_API_KEY'),
  mubitBase: (process.env.MUBIT_BASE_URL ?? 'https://api.mubit.ai').replace(/\/$/, ''),
  modModel: process.env.MOD_MODEL ?? 'gpt-6-luna',
  swarmModel: process.env.SWARM_MODEL ?? 'gpt-4.1-mini',
  concurrency: Number(process.env.MOD_CONCURRENCY ?? 16),
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3100',
  dataDir: join(__dirname, '..', '..', 'data'),
};
