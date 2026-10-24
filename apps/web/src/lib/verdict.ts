import type { ModAction, ModReason } from '@quell/shared';

export const ACTION_LABEL: Record<ModAction, string> = {
  allow: 'Allowed',
  flag: 'Flagged',
  remove: 'Removed',
  redact: 'Redacted',
};

export const ACTION_TONE: Record<ModAction, { text: string; dot: string; soft: string; ring: string }> = {
  allow: { text: 'text-allow', dot: 'bg-allow', soft: 'bg-allow/10', ring: 'ring-allow/25' },
  flag: { text: 'text-flag', dot: 'bg-flag', soft: 'bg-flag/10', ring: 'ring-flag/25' },
  remove: { text: 'text-remove', dot: 'bg-remove', soft: 'bg-remove/10', ring: 'ring-remove/25' },
  redact: { text: 'text-redact', dot: 'bg-redact', soft: 'bg-redact/10', ring: 'ring-redact/25' },
};

export const REASON_LABEL: Record<ModReason, string> = {
  ok: 'OK',
  spam: 'Spam',
  scam: 'Scam',
  harassment: 'Harassment',
  off_topic: 'Off-topic',
  personal_info: 'Personal info',
  slur: 'Slur',
};

/** Stable, muted avatar hue per author. */
export function authorHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

// Twitch's default chat colours, lifted where needed so they read on a dark background.
const NAME_COLORS = [
  '#ff4a80', '#4f9bff', '#00c853', '#ff7f50', '#9acd32', '#ff6f3c', '#2ec4b6', '#daa520',
  '#e07a2f', '#5fb3b3', '#1e90ff', '#ff69b4', '#a970ff', '#00e58a', '#f5c518',
];

export function nameColor(name: string): string {
  return NAME_COLORS[authorHue(name) % NAME_COLORS.length];
}

export function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
