# Quell

Live-chat moderation that learns your community from every correction.

Every message in the channel is judged by one fixed moderation task routed through
[Mubit](https://mubit.ai). When a moderator corrects a call, the correction becomes a
community rule, and the corrected message plus similar recent ones are re-judged with
that rule. Mubit records those re-judged calls as kept examples, and trains a Qwen3
adapter on them that takes over the task once it passes its tests.

## Run it

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # then set MUBIT_API_KEY
pnpm dev                                  # API on :4000, web on :3100
```

- Console: http://localhost:3100
- Crowd page (phones on the same Wi-Fi): `http://<laptop-ip>:3100/join`
- Clean slate before a demo: `pnpm reset` (keeps `apps/api/data/task.lock`)

## How it fits together

| Part | Where | Notes |
|---|---|---|
| Moderation task | `apps/api/src/moderation/frozen.ts` | Model, system prompt and JSON schema define the Mubit task. They are fingerprinted; the API refuses to start if they change, because that would start a new task and reset its examples. |
| Worker pool | `moderation.service.ts` | One message = one recorded call. `MOD_CONCURRENCY` bounds bursts. A regex safety net always redacts personal information. |
| Corrections | `corrections.service.ts` | Correction → rule → embeddings find similar messages → re-judged as recorded calls (training examples). |
| Swarm | `apps/api/src/swarm` | Personas with ground-truth labels play the community. A generator model tops up their messages; those calls carry `x-middleware-record: off` so they never train. |
| Metrics | `metrics.service.ts` | Agreement with the community's real norms, wrongly blocked, scams caught, personal info hidden, latency. |
| Web | `apps/web` | Next.js 15, Tailwind v4, Motion. Live over server-sent events. |

## Two-minute demo

1. **Go live** at 3/s. The channel fills; agreement sits around 90%.
2. Point at a mistake: trolling allowed, or a harmless dev joke ("kill -9 the intern's process") flagged.
3. Correct it in **Review**: edit the rule, **Teach the model**. Watch the rule appear, the training counter climb, and similar messages re-judged.
4. **New scam wave** for fresh scams; **Raid** for a 150-message burst cleared in seconds.
5. Open the Mubit console: the `moderation_decision` task, its kept examples, and the adapter's progress.
