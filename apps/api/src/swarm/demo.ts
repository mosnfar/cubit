import type { Verdict } from '@quell/shared';

// Scripted moments for a live demo. Each "teach" message breaks a house rule a
// generic model can't know (Shipyard is stricter than most servers), so the
// model reliably allows it. The moderator corrects it; the "again" message is a
// new look-alike posted afterwards to show the correction carried over.
export interface DemoBeat {
  /** What this community wants done; the model is never told. */
  expected: Verdict;
  teach: { author: string; text: string };
  again: { author: string; text: string };
}

export const DEMO_BEATS: DemoBeat[] = [
  {
    // House rule: bait about the project being dead is held for a moderator.
    expected: { action: 'flag', reason: 'off_topic' },
    teach: { author: 'xX_real_Xx', text: 'vercel is better, this project is dead' },
    again: { author: 'just_asking', text: 'honestly shipyard is dead, everyone moved to fly.io lol' },
  },
  {
    // House rule: no buying or selling in #general.
    expected: { action: 'remove', reason: 'spam' },
    teach: { author: 'tix4u', text: 'selling 2 spare ShipyardConf tickets, £50 each, DM me 🎟️' },
    again: { author: 'gpu_dealer', text: 'anyone want my old RTX 3080? 200 quid, can post it, DM' },
  },
  {
    // House rule: job posts go to #jobs, not chat.
    expected: { action: 'flag', reason: 'off_topic' },
    teach: { author: 'recruiter_kim', text: "we're hiring senior devops engineers at a stealth startup, DM me for a referral 💼" },
    again: { author: 'talent_dan', text: 'Looking for a platform engineer, fully remote, great pay. Message me!' },
  },
  {
    // House rule: self-promotion belongs in #showcase.
    expected: { action: 'flag', reason: 'off_topic' },
    teach: { author: 'devtube', text: 'new video: deploying with shipyard in 5 minutes 👉 youtube.com/watch?v=sh1pyard' },
    again: { author: 'streamer_ash', text: 'going live on twitch in 10 min doing a shipyard speedrun, come hang twitch.tv/ash' },
  },
];

/** Gap between scripted messages, so the room can read each one land. */
export const DEMO_GAP_MS = 1400;
