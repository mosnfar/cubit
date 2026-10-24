---
title: Operations
description: Run Quell, configure services, back up local data, and recover from resets or task changes.
---

## Install, build, and run

Use Node.js 24 (the version documented in the README) and pnpm 10.12.4 (pinned in `package.json`). Run the following commands from the repository root:

```sh
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env  # first setup only; then edit the key
pnpm build
```

Set `MUBIT_API_KEY` in `apps/api/.env` before starting the API. The API loads that file at runtime; exported process environment takes precedence. Web configuration is separate: `NEXT_PUBLIC_API_URL` is embedded during the web build. For example, for a public deployment build the web app with the full base URL (including `/api`, without a trailing slash):

```sh
NEXT_PUBLIC_API_URL=https://chat.example/api pnpm --filter @quell/web build
```

Build the shared package before building API or web independently (`pnpm build:shared`). Root `pnpm build` already builds shared, API, then web.

Run API and web as separate processes (two terminals for a manual deployment, or a supervisor). In the first terminal:

```sh
NODE_ENV=production pnpm --filter @quell/api start
```

In the second terminal:

```sh
NODE_ENV=production pnpm --filter @quell/web start
```

API listens on `0.0.0.0:4000`; web listens on port 3100. For local development, `pnpm dev` builds shared and starts both development servers; `pnpm dev:api` and `pnpm dev:web` start one side each. By default the browser constructs the API URL from its own protocol and hostname on port 4000, useful for LAN phones.

Health check without paid model calls:

```sh
curl -fsS http://localhost:4000/api/state >/dev/null && echo API-ready
curl -N --max-time 20 http://localhost:4000/api/stream
```

The second command should show metrics and a `ping` within 15 seconds; curl's timeout exit code (28) is expected after 20 seconds. There is no dedicated health endpoint. Do not use `/api/eval` as a health check: it makes external model calls.

## Environment variables

| Variable | Default / requirement | Purpose |
| --- | --- | --- |
| `MUBIT_API_KEY` | Required | API credential; startup fails if absent. |
| `MUBIT_BASE_URL` | `https://api.mubit.ai` | Mubit base URL; one trailing slash is removed. |
| `MOD_MODEL` | `gpt-6-luna` | Recorded moderation model; part of task fingerprint. |
| `SWARM_MODEL` | `gpt-4.1-mini` | Unrecorded swarm, feed, and evaluation-set generation model. Scripted demo beats are fixed local content. |
| `MOD_CONCURRENCY` | `16` | Moderation worker concurrency; set a positive finite integer. The app does not validate it. |
| `PORT` | `4000` | API listening port. |
| `WEB_ORIGIN` | `http://localhost:3100` | Additional exact browser origin allowed by CORS. |
| `NEXT_PUBLIC_API_URL` | Browser derives host and port 4000 | Complete API base including `/api`; public and build-time. |
| `GPT_PRICE_IN`, `GPT_PRICE_OUT` | Unset | Both are needed for GPT eval cost; USD per million tokens. |
| `EVAL_OPEN_MODEL` | `qwen/qwen3-30b-a3b-instruct-2507` | OpenRouter comparison model, requested through Mubit. |
| `ALLOW_TASK_CHANGE` | Unset | Exactly `1` bypasses task-lock mismatch on startup; it does not rewrite the lock. |

The optional screenshot helper also reads `WEB_URL` (default `http://localhost:3100`), `API_URL` (default `http://localhost:4000/api`), and `CHROME_PATH` (otherwise probes standard macOS/Linux Chrome paths). These do not configure the running applications.

There is no configurable data-directory setting. Persistent data is under `apps/api/data`; mount durable storage there in a deployment. CORS permits the configured `WEB_ORIGIN` and HTTP origins matching localhost/127.0.0.1, 192.168.x.x, or 10.x.x.x with an explicit port. This is a permissive LAN-oriented list, not a security boundary. No proxy trust is configured; behind a proxy, client IP throttling may collapse callers to the proxy IP.

## Persistence and backup/restore

SQLite at `apps/api/data/quell.db` stores complete message JSON, rules, counters, and bans. WAL mode is not explicitly enabled by the application. There is no age-based retention. On startup the newest 4,000 messages are loaded into memory; rows left queued become error and are not retried. All rules, counters, and bans are loaded. `/api/state` exposes at most 250 messages; message-ID operations cannot find older rows once evicted from memory.

`evalset.json` and `eval.json` hold the generated held-out set and evaluation progress/results. They are tracked in Git in this repository, so review changes before committing. `task.lock` stores the task fingerprint. `feed-sent.json` stores feed message texts. These are not included in the SQLite reset. Avoid accidental commits of evaluation content/results and feed history if they contain data you do not intend to publish.

For a consistent backup, stop the API and any feed writer, then copy the entire data directory. Choose an absolute destination outside the repository; do not overwrite an existing backup. Example using a timestamped new directory:

```sh
(
  set -eu
  umask 077
  backup_dir="/absolute/path/to/backups/quell-$(date -u +%Y%m%dT%H%M%SZ)"
  test ! -e "$backup_dir"
  mkdir -p "$backup_dir"
  cp -Rp apps/api/data "$backup_dir/data"
  git rev-parse HEAD > "$backup_dir/git-revision.txt"
  printf 'Backup saved to %s\n' "$backup_dir"
)
```

This copies SQLite sidecars if present along with task/evaluation/feed files. Keep the backup protected like the source data. If `sqlite3` is installed, check the copied database:

```sh
sqlite3 /absolute/path/to/the-backup/data/quell.db 'PRAGMA integrity_check;'
```

Restore only while API/feed are stopped. First move the current directory aside to a new path, then copy a known backup into place; check that the source has `quell.db` before proceeding. Example, with paths set explicitly by the operator:

```sh
(
  set -eu
  restore_from="/absolute/path/to/the-backup/data"
  saved_data="/absolute/path/to/backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  test -f "$restore_from/quell.db"
  test -d "$(dirname "$saved_data")"
  test ! -e "$saved_data"
  test -d apps/api/data
  mv apps/api/data "$saved_data"
  cp -Rp "$restore_from" apps/api/data
)
```

An integrity check should return `ok`. Start with compatible code/configuration afterward. Preserve deployment configuration separately, including model and Mubit project identity; the data backup does not include `.env` or credentials. Keep the moved-aside directory in protected backup storage outside the repository. Retain or dispose of old backups according to your retention needs; restoring local data does not revert remote provider state.

## Task fingerprint recovery

The fingerprint is the first 16 hexadecimal characters of SHA-256 over the moderation model name, system prompt, and response schema. The shared action/reason/confidence enums affect that schema. A mismatch blocks startup to prevent accidental task changes.

For an accidental change, restore the intended task source, shared enums, and `MOD_MODEL`, then run `pnpm build:shared` and `pnpm --filter @quell/api build` before restarting. Check the startup fingerprint against the existing `apps/api/data/task.lock`.

For an intentional change, stop the API and feed, back up the data and old task identity, and review the model/prompt/schema change. Rebuild shared and API as above, unset `ALLOW_TASK_CHANGE`, then remove only `apps/api/data/task.lock` and start the API. Startup writes the new lock; review its Git diff with the task changes because the lock is tracked. A new remote task does not migrate or erase examples belonging to the old remote task. Changing the Mubit base URL or project key also requires checking the intended remote project; neither is covered by this local fingerprint. `ALLOW_TASK_CHANGE=1` only bypasses the mismatch and never rewrites an existing lock.

## Reset and recovery

Stop API and feed processes before destructive local reset. Root `pnpm reset` removes `quell.db` and its `-wal`/`-shm` files, but keeps `task.lock`, evaluation files, feed history, logs, and browser storage. `POST /api/demo/reset` clears session rows and memory, completed duplicate-decision cache, and swarm/scam-wave flags; it does not cancel active/queued moderation or replay, evaluations, in-flight calls, or delayed demo timers. Use a stopped-process reset for a clean session.

On restart, queued messages become `error`; no automatic retry occurs. An unfinished evaluation is restored as `error`. Check `GET /api/state` and `/api/stream`; provider error strings may appear in stored rows and logs. The feed script calls Mubit directly and can write remote recorded calls; `--dry-run` still calls the generation model and prints a request snippet, so it is not offline. The screenshot helper `scripts/screenshots.mjs` posts reset, starts swarm, creates corrections, and sends a viewer message, potentially causing model calls. Use it only against isolated demo data. The join QR is built from LAN addresses returned by `/api/info`; for public use, distribute the actual public `/join` URL.

The service has no authentication, deployment manifests, or multi-process coordination. In-memory event delivery, throttling, queues, and cache are process-local. Keep one API instance. If deployed behind TLS termination, configure the proxy to pass SSE through without buffering and with an idle timeout longer than the 15-second heartbeat. Restrict network access to the whole API; CORS alone does not protect it.

Implementation references: [runtime config](../apps/api/src/core/config.ts), [API bootstrap and CORS](../apps/api/src/main.ts), [SQLite store](../apps/api/src/core/store.service.ts), [task fingerprint](../apps/api/src/moderation/frozen.ts), [feed script](../apps/api/scripts/feed.mjs), and [screenshot helper](../scripts/screenshots.mjs).

See the [API reference](api-reference.md) for requests and events, and [Data handling](data-handling.md) for retention and deletion boundaries.
