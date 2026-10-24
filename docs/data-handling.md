---
title: Data handling
description: What Quell stores and sends, how recording works, and what local deletion does.
---

This guide describes the current code paths, not provider-side retention or training policies. Check the terms and account controls of each external service before sending real personal data.

## Data sent to services

LLM and embedding requests use configured Mubit endpoints. `x-middleware-record: off` expresses the app's request that a call not be recorded as a task example; it does not establish zero provider retention. The service also calls Mubit’s OpenRouter-compatible endpoint for the third evaluation setup.

| Activity | Data sent |
| --- | --- |
| Live crowd moderation | Raw message text, author, channel, community description, up to three recent raw messages selected from the latest twelve, detected URLs/wallets/emails/phones/addresses, and up to 40 current rules. |
| Correction similarity | Corrected raw message, rule text, and up to 300 recent completed uncorrected messages sent to `text-embedding-3-small` for embeddings with recording disabled. No vectors are persisted locally. If embedding fails, local lexical matching is used. |
| Correction replay | Corrected message plus up to 24 similar targets are re-judged with current rules as recorded moderation calls. This can send a message to the service again. |
| Swarm generation | Community/persona prompts, character voices, topics, and up to 15 visible chat lines selected from the latest 60 messages are sent using `SWARM_MODEL`. Each line includes its author and `display` text when present, otherwise raw text. The prompt also includes up to 20 recent generated lines for that persona to avoid repetition. The generated messages are posted locally and pass through recorded moderation. Generation is marked unrecorded. |
| Scripted demo | Fixed local demo beats; no text-generation request. Messages posted into chat may receive the usual moderation calls. |
| Evaluation | The held-out set and, for rule-aware setups, current rules are sent to the moderation model and OpenRouter model with recording disabled. If no set exists, `SWARM_MODEL` generates one and it is saved locally. Existing rules can include real text quoted from user corrections, so eval calls can contain user-originated text even when test messages are synthetic. |
| Feed script | The script directly calls Mubit `/openai/v1/chat/completions`: `SWARM_MODEL` generates candidate messages with recording disabled; then each message is sent as a recorded moderation task call with recent context and rules. It does not call `/ingest` and does not store feed messages in the app's SQLite message table. Successfully sent texts are appended to local `feed-sent.json`. `--dry-run` still makes remote generation calls and prints a prompt/request snippet; it is not offline. |
| Moderator message | Not sent in its own direct model call. It can appear later in moderation context, swarm-generation context, or the correction candidate pool. |

Device IDs and client IP addresses are not part of the live moderation model payload. Device IDs are saved with local crowd messages for device bans; IP is used for the ingest cooldown. The model receives scanner hints including URLs and wallet addresses. The deterministic safety net masks detected emails, phones, and postal addresses in the display text; it does not guarantee all personal details are detected. Redaction does not remove the original raw message.

## Local storage and exposure

`apps/api/data/quell.db` stores complete message JSON (including raw text, decisions, device IDs, corrections, and error strings), rules, counters, and bans. There is no age-based retention or deletion sweeper. SQLite holds rows without a fixed cap; only the newest 4,000 messages are loaded into memory, `/api/state` returns at most 250, and the browser viewer retains up to 400 displayed messages. Old rows can remain on disk while becoming unavailable to message-ID operations.

`evalset.json` contains generated evaluation messages, `eval.json` contains scores/progress and possible errors, and `feed-sent.json` contains successfully sent feed text. `task.lock` contains a fingerprint rather than chat content. Evaluation files are currently tracked in Git, so generated changes can accidentally be committed. Logs, crash reports, terminal output, backups, screenshots, and exports may also contain user content.

The unauthenticated `/api/state` and `/api/stream` expose raw message text and device IDs to every reachable client. Frontend hiding/masking is presentation behavior only: it does not change stored raw text or SSE payloads. `/api/info` returns LAN IPv4 addresses. CORS is not authorization; protect network access to the API itself.

The join page stores display name, generated device ID, and up to 200 recent message IDs in browser local storage (`quell-name`, `quell-device`, `quell-mine`). Changing the name clears only the name. Clear the site's browser storage and close its tabs to remove those browser-side values.

## Recording, cache, and deletion

Normal moderation and correction replay use the recorded path. Duplicate crowd messages may reuse a local decision instead of making another provider call: normalized identical text under the same rule set can reuse a recent result for ten minutes, and concurrent copies wait for the same judgement. The cache is in memory and has no periodic expiry cleanup; old entries are only bypassed by age checks or cleared by reset/restart. The per-IP cooldown map also has no TTL cleanup and is cleared on process restart.

A correction creates a persistent rule and rejudges selected messages. For a redact correction, the code infers spans from detected personal information and the model's previous spans; there is no explicit span field in the request. The original text stays in storage and can be used in later context/replay. Generated rule wording can quote a snippet of up to 90 characters; custom rule text is persisted and sent in future prompts. `Rule.examples` and `metrics.trainingExamples` count successful replay calls locally; they do not prove a remote model deployment, provider retention duration, or external training job status. There is no training launch/poll API. Deleting a local rule does not remove messages, undo rejudgements, or retract examples already sent remotely.

There is no per-person or per-message deletion endpoint. The demo reset clears local session rows, rules, bans, counters, completed duplicate cache, and swarm/scam-wave flags, but does not cancel queued/active work, evaluations, in-flight calls, or delayed demo timers. Stop the API for a clean local purge.

For local cleanup, stop the API/feed processes, run `pnpm reset` at the repository root to remove SQLite database and sidecars, then separately remove evaluation/feed files, logs, exports, backups, and browser storage as appropriate. Evaluation set regeneration makes remote generation calls; deleting files/database does not guarantee secure erasure from storage media or backups. Local deletion does not request or verify deletion by Mubit, OpenAI-compatible underlying model providers, or other external services. Use the relevant provider's documented controls for remote deletion requests.

For backup and restore steps, see [Operations](operations.md). For endpoint behavior, see the [API reference](api-reference.md).
