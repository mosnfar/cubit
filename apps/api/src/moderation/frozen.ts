import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, CONFIDENCE, REASONS } from '@quell/shared';
import { config } from '../core/config';

// Mubit groups calls into one task by model + system prompt + tools + output
// format. Everything in this file is part of that fingerprint: one changed
// word starts a new task and resets its kept-example count. Change it only on
// purpose, then delete data/task.lock.

export const SYSTEM_PROMPT = `You are the moderator for one online community's live chat.

For each message you receive a JSON object with:
- community: the community's name and what it is about
- channel: where the message was posted
- author: who posted it and whether they are new
- recent: the few messages just before it
- message: the message to judge
- detected: links, wallets, emails, phone numbers and addresses found by a scanner
- community_rules: rules the community's moderators have set. They override your own judgement. Follow them exactly.

Choose one action:
- allow: fine for this community, including its jokes, slang and banter
- flag: unclear; a human moderator should look
- remove: spam, scams, harassment or slurs
- redact: the message is fine except for part of it that must be hidden, such as someone's personal information

Choose the one reason that best explains the action: ok, spam, scam, harassment, off_topic, personal_info or slur. Use ok only with allow.

When the action is redact, list in "redact" the exact substrings to hide, copied character for character from the message. Otherwise "redact" is an empty list.

Set confidence to low, medium or high.`;

export const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'moderation_decision',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'reason', 'redact', 'confidence'],
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        reason: { type: 'string', enum: [...REASONS] },
        redact: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
      },
    },
  },
};

export const TASK_MODEL = config.modModel;

export const TASK_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify({ model: TASK_MODEL, system: SYSTEM_PROMPT, format: RESPONSE_FORMAT }))
  .digest('hex')
  .slice(0, 16);

/** Refuses to start if the task definition changed since it was first locked. */
export function assertTaskFrozen(): void {
  const lockPath = join(config.dataDir, 'task.lock');
  mkdirSync(config.dataDir, { recursive: true });
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, TASK_FINGERPRINT + '\n');
    return;
  }
  const locked = readFileSync(lockPath, 'utf8').trim();
  if (locked !== TASK_FINGERPRINT && process.env.ALLOW_TASK_CHANGE !== '1') {
    throw new Error(
      `The moderation task changed (lock ${locked}, now ${TASK_FINGERPRINT}). ` +
        'This would start a new Mubit task and reset its examples. Revert the change, ' +
        'or delete data/task.lock (or set ALLOW_TASK_CHANGE=1) if you mean it.',
    );
  }
}
