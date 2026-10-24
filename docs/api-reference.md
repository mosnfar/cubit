---
title: API reference
description: HTTP endpoints, request and response fields, errors, rate limits, and server-sent events.
---

The NestJS service uses the `/api` prefix. Examples use `http://localhost:4000/api`; substitute the origin your client can reach. There is no authentication or authorization on any route. CORS is not an access boundary: any client that can reach the API can read state and stream events, post, correct, ban, reset, or run evaluations.

Send JSON request bodies with `Content-Type: application/json`. Successful POSTs normally return **201** (Nest default); GET and DELETE return **200**. Nest errors usually have `{"statusCode":400,"message":"…","error":"Bad Request"}`. There is no full schema-validation pipe or app-specific body-size override; framework body-parser defaults still apply, and malformed field types can produce 500s.

## Shared response fields

Enums: actions `allow | flag | remove | redact`; reasons `ok | spam | scam | harassment | off_topic | personal_info | slur`; confidence `low | medium | high`; message sources `crowd | swarm | mod`; message status `queued | done | error`.

| Shape | Fields |
| --- | --- |
| `LiveState` | `messages` (`ModeratedMessage[]`), `rules` (`Rule[]`), `metrics` (`Metrics`), `swarm` (`SwarmState`), `task` (`model`, `fingerprint`), `evaluation` (`EvalRun` or `null`), `bans` (`Ban[]`). |
| `ModeratedMessage` | Required: `id`, `channel`, `author`, raw `text`, `source`, `createdAt` (Unix ms), `status`. Optional: `persona`, `expected` (`action`, `reason`), `device`, `decision` (`action`, `reason`, `redact[]`, `confidence`), `display`, `latencyMs`, `safetyNet`, `cached`, `error`, `correction`, `rejudged`. Moderator messages have `status:"done"` and no `decision`. |
| `correction` | `action`, `reason`, `at` (ms), optional `ruleId`, optional `redact[]`. |
| `rejudged` | `at` (ms), `before` (previous decision). |
| `Rule` | `id`, `text`, `createdAt`, optional `fromMessageId`, `examples` (successful replay calls counted locally). |
| `Ban` | `id`, `author`, `at` (ms), `until` (ms or `null` for indefinite). |
| `SwarmState` | `running`, `rate` (messages/second), `scamWave`, `buffered`, `generating`. |
| `EvalRun` | `id`, `startedAt`, optional `finishedAt`, `status` (`preparing`, `running`, `done`, or `error`), `size`, `results[]`, optional `error`. |
| `EvalResult` | `id`, `label`, `model`, `rules`, `done`, `total`, `errors`, `agreement`, `wronglyBlocked`, `scamsCaught`, `scamsTotal`, `piiHidden`, `piiTotal`, `latencyP50`, `latencyP95`, `tokensPerMessage`, `costPer1k`. Nullable measurements are `null` until measurable/known. |
| `Metrics` | `moderated`, `cached`, `autoHandled`, `needsReview`, `autoRate`, `minutesSaved`, `queued`, `errors`, `byAction` (count for each action), `latencyP50`, `latencyP95`, `throughputPerMin`, `tokensIn`, `tokensOut`, `graded`, `accuracy`, `wrongfulRemovals`, `scamsCaught`, `scamsTotal`, `piiRedacted`, `piiTotal`, `corrections`, `trainingExamples`, `rules`, `accuracySeries[]`. Nullable rates/latencies may be `null`. |

Latency values are milliseconds. `autoRate`, `accuracy`, `agreement`, and `accuracySeries` use fractions from 0 to 1; `costPer1k` is USD per 1,000 messages. Counts are numbers. Live accuracy compares model actions against synthetic messages' expected actions; corrections are counted separately. Examples use illustrative IDs, timestamps, and counts.

## Routes

### `GET /state`

Snapshot with up to 250 messages (oldest first), plus rules, metrics, swarm, task model/fingerprint, latest evaluation, and active bans. Example:

```sh
curl -s http://localhost:4000/api/state
```

To inspect only compact top-level fields while keeping the output valid JSON, use `curl -s http://localhost:4000/api/state | jq '{messageCount:(.messages|length), ruleCount:(.rules|length), task, evaluation, bans}'`. Full fields are defined above.

### `GET /stream` (SSE)

Use `EventSource` or `curl -N http://localhost:4000/api/stream`. Event names: `message`, `rule`, `rule-removed`, `bans`, `metrics`, `swarm`, `replay`, `eval`, `reset`, `ping`. `data:` is the JSON encoding of the payload directly, not a `{type,data}` wrapper. Example valid wire event:

```text
event: message
data: {"id":"m-1","channel":"#general","author":"sam","text":"hello","source":"crowd","createdAt":1792850944549,"status":"queued"}

```

`message` carries a full moderated message; `rule` a Rule; `rule-removed` is `{"id":"…"}`; `bans` an array of Ban; `metrics` a Metrics; `swarm` a SwarmState; `replay` is `{"ruleId":"…","sent":3}`; `eval` an EvalRun; `reset` and `ping` are `{}`. Ping is emitted every 15 seconds and metrics about every second. The server has no event history or `Last-Event-ID` replay. Fetch `/state` on initial connection and after reconnect/reset.

Upsert `message` and `rule` events by ID; they can update previously received objects. Replace the ban list and latest metrics/swarm/evaluation with each corresponding payload. Buffer events while fetching a snapshot, then apply them after it; see the [web client](../apps/web/src/lib/useLive.ts). Snapshot recovery covers the recent window, not a durable history of every event.

### `POST /ingest`

```sh
curl -i -X POST http://localhost:4000/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"author":"sam","text":"hello chat","device":"phone-123"}'
```

Returns `{"id":"<uuid>"}` immediately; moderation completes asynchronously. Observe the `message` event or `/state` for its later `status` and decision. The route does not accept an idempotency key: retrying a successful request creates a new message. `text` is trimmed and must be 1–300 UTF-16 code units (JavaScript string `.length`). `author` is trimmed, truncated to 24 code units, defaults to `guest`; string `device` is truncated to 64. The per-IP 2.5-second gap is in memory. Profanity rejection occurs after timestamp update, so it consumes the gap too. Errors: 400 empty/too long/profanity, 403 active ban, 429 cooldown.

### `POST /mod/say`

Request `{"text":"Welcome!"}`; returns `{"id":"<uuid>"}`. Text has the same trim/300-code-unit limit. This is stored and broadcast as `source:"mod"`, `status:"done"`, without a direct moderation call or decision. It can still later appear in context or correction matching.

### `POST /messages/:id/ban`

Request `{"minutes":10}`; returns a Ban, for example `{"id":"device:phone-123","author":"sam","at":1792850944549,"until":1792851544549}`. A positive value is capped at 1,440 minutes; omitted/null/zero/negative/nonnumeric means indefinite (`until:null`). The value is numerically coerced. Ban ID is `device:<device>` when available, else `name:<lowercase-author>`. Missing/evicted message returns 404; moderator message returns 400. Emits `bans` with the active-ban list.

### `DELETE /bans/:id`

URI-encode the full ID, e.g. `DELETE /api/bans/device%3Aphone-123`. Returns `{"ok":true}` or 404.

### `POST /messages/:id/correct`

Request `{"action":"remove","reason":"scam","ruleText":"Remove impersonation links."}`; response example:

```json
{"rule":{"id":"r-1","text":"Remove impersonation links.","createdAt":1792850944549,"fromMessageId":"m-1","examples":0},"replaying":4}
```

`ruleText` is optional and trimmed; otherwise wording is generated from the message (including a snippet of up to 90 code units). Action and reason are validated independently; combinations are not cross-validated. There is no explicit redaction-span input: for `redact`, spans are inferred from detected personal information and prior model spans, falling back to the whole message. Embedding search runs before response; at most 25 targets (the corrected message plus up to 24 matches) are replayed asynchronously. `replaying` is the target count, not a completion guarantee. Follow `replay`, `rule`, and `message` events. Missing/evicted message is 404; unknown enum is 400.

### `DELETE /rules/:id`

Returns `{"ok":true}` or 404 and emits `rule-removed` with the ID. This removes the rule from future local prompts; it does not undo corrections/replays or retract remote examples.

### `POST /swarm`

Example request `{"running":true,"rate":4,"scamWave":false}`; response example `{"running":true,"rate":4,"scamWave":false,"buffered":0,"generating":false}`. Rate clamps to 0.2–30. Emits `swarm` on changes.

### `POST /swarm/raid`

Request `{"count":150}`; returns `{"posted":150}` (actual posted count can differ). Count is coerced, defaults to 150 when falsy, then clamps to 10–500.

### `POST /demo/:stage`

`teach` and `again` return `{"posted":4}` and schedule four fixed scripted local beats 1,400 ms apart; they do not generate model-written text. No request body is needed. Unknown stage returns 400. `reset` returns `{"ok":true}`, clears persisted session rows and completed duplicate cache, stops swarm and scam-wave flags, and emits `reset`. It does not cancel active/queued moderation or replay, running evaluations, in-flight calls, or delayed demo timers, so data can return after reset.

### `POST /eval`

Starts evaluation asynchronously and returns an initial EvalRun, for example `{"id":"e-1","startedAt":1792850944549,"status":"preparing","size":0,"results":[{"id":"gpt-before","label":"GPT, before corrections","model":"gpt-6-luna","rules":0,"done":0,"total":0,"errors":0,"agreement":null,"wronglyBlocked":0,"scamsCaught":0,"scamsTotal":0,"piiHidden":0,"piiTotal":0,"latencyP50":null,"latencyP95":null,"tokensPerMessage":null,"costPer1k":null}]}`. Other result fields/setups may be omitted from this example. Track `eval` events or `/state`; a preparing/running job returns 409. Errors appear in run status/error. Evaluation scoring calls are unrecorded; creating a missing held-out set makes separate generation calls.

### `GET /info`

Returns non-loopback IPv4 addresses, e.g. `{"lan":["192.168.1.20"]}`. This discloses LAN addresses.

## Limits and implementation notes

Only `/ingest` has an app-level rate limit (per IP, in-memory, 2.5 seconds). There is no authentication or general throttling. No proxy trust is configured, so deployments behind a proxy may see all callers as one IP. `MOD_CONCURRENCY` controls the moderation worker count but must be a positive finite integer; configuration is not validated. The API stores up to 4,000 messages in memory; lookup/correction/ban by message ID fails after eviction even if older rows remain in SQLite. The browser viewer keeps up to 400 displayed messages.

An ingest cooldown response is `{"statusCode":429,"message":"Slow down a little."}`; the application does not set `Retry-After`. Wait at least 2.5 seconds from the previous attempt. A valid POST response confirms submission, not successful provider moderation: later failures appear as message `status:"error"` and `error` text. Invalid model JSON can instead become a low-confidence `flag` decision.

Implementation references: [controller routes and limits](../apps/api/src/api.controller.ts), [shared data types](../packages/shared/src/index.ts), [moderation and duplicate cache](../apps/api/src/moderation/moderation.service.ts), [correction/replay behavior](../apps/api/src/moderation/corrections.service.ts), and [SSE event source](../apps/api/src/core/events.service.ts).
