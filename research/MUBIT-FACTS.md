# Mubit: everything the docs say (read in full, 23 Oct 2026)

Source: https://docs.mubit.ai/llms-full.txt (every page, 141 KB), saved in `docs/`.
Marked **[NEW]** where it corrects or adds to the handoff doc.
Marked **[PROBE]** where `probes.py` checks it against the live API.

---

## 0. The goal (read this first)

The brief, in the event's words: *"Build a product that routes its LLM calls through Mubit and turns your corrections into model updates for a recurring task."*

| Part | What it means |
|---|---|
| **A product** | Something a real person would use (e.g. a moderator's mod queue) |
| **A recurring task** | The same AI job over and over (e.g. labelling every chat message) |
| **Corrections become model updates** | A human fixes the AI, Mubit trains a new small model, and the AI gets better |

The judges want to **see that loop live**: *a human correction turning into a model update* (25% of the score, "Use of Mubit").

### The dataset is scaffolding, not the goal
Mubit only learns after seeing the job many times:
- **25 kept examples** before the first adapter trains;
- **~700–1,000 calls of one task** before the adapter answers live calls (silent test needs ~50 graded copies at a 10% copy rate, then a 100-call partial rollout; see §9d).

A hackathon has no real users, so a **replay script plays pretend users**: realistic messages from public datasets plus our own examples, fed into the product. That gives Mubit enough calls to train. It's what makes the demo work, not what's judged. Say it out loud in the demo ("this is a replay of public data").
- 1,000 calls × ~300 tokens ≈ 300k tokens. Trivial for the starter credit.
- At 3 calls/s that's ~6 minutes of replay. **The slow parts are Mubit's reviewer (≤200 new calls per task per day) and the go-live steps**, so start replaying early (Saturday morning at the latest).
- LLM calls used only to *generate* replay data still go through Mubit, but with `x-middleware-record: off` so they don't form a task.

### What the judges should see
1. **The product working:** inputs flowing in, the AI labelling them.
2. **A human correcting it:** one click in the product's normal flow.
3. **Mubit updating the model:** a new adapter version, trained on those corrections.
4. **The improvement:** next time the AI gets it right, and the cheap Qwen adapter answers instead of GPT (Requests → Served by).

### Evidence that a feedback route exists
- The event page says Mubit *"generates lightweight model updates from your calls **and feedback**"*.
- Settings → Advanced has **`feedback.outcome: off`** (§9d).
- → Ask how to send feedback so it reaches training. **Max, the AI on the event Discord (#night-shift-info), answers questions**, or ask at Mubit office hours on Saturday:
  > *"How do we send human feedback or corrections to Mubit so they reach training? Can `feedback.outcome` be turned on for our project?"*
- Until that's answered, the documented route is: the correction becomes a rule or example in the **user message**, GPT then answers correctly, and that recorded call is the kept example that trains the next version.

---

## 1. What Mubit is, in one paragraph

A **gateway (proxy)**. Your app calls Mubit instead of OpenAI / Anthropic / Gemini.
Mubit swaps your Mubit key for a provider key, forwards the request **unchanged**,
returns the provider's answer **unchanged**, and records both. In the background it
groups recorded calls into **tasks**, picks **kept examples**, and trains an
**adapter** (a small open model) per task that imitates the provider's answers.
You can compare a passing adapter with the provider in the console's **Try models**.

The public API is **only the provider pass-through**. There is no documented API
for tasks, adapters, ratings, training or routing. Everything else is the console.

---

## 2. Connecting

| Provider | Base URL for the SDK | Key header |
|---|---|---|
| OpenAI (Chat Completions, Responses, Embeddings, Models) | `https://api.mubit.ai/openai/v1` | `Authorization: Bearer mbt_…` |
| Anthropic (Messages, count_tokens, Models) | `https://api.mubit.ai/anthropic` (no `/v1`) | `x-api-key` or `Authorization: Bearer` |
| Gemini (generateContent, streamGenerateContent) | `https://api.mubit.ai/gemini` (no `/v1beta`) | `x-goog-api-key` (never `?key=`) |
| OpenAI SDK on Gemini | `https://api.mubit.ai/gemini/v1beta/openai` (refused on starter credit) | Bearer |
| OpenAI-compatible | `https://api.mubit.ai/compat/{openrouter,groq,together,mistral}/v1` | Bearer |

- Mubit keys start with `mbt_`. **Send only the Mubit key.** Any other credential beside it is a 401. **[PROBE]**
- **Server-side only.** No CORS, so a browser can't call it. **[NEW]**
- Use the base URL the console's **Connect** page shows (there's a `wrong_region` error, so regions exist). **[NEW]**
- Works through env vars: `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GOOGLE_GEMINI_BASE_URL`.
- Also documented: Vercel AI SDK, LangChain, OpenAI Agents SDK (**turn tracing off**, or it sends your Mubit key to OpenAI), Claude Code, Codex, Gemini CLI, Aider.

### The starter credit
- Example models in the docs: **`gpt-6-luna`**, **`claude-haiku-4-5`**, **`gemini-3.8-flash`**. Any other model gets `400 starter_credit_model`, and **the message lists the models it serves**. **[PROBE]**
- Refused on the starter credit: hosted web search, file search, code execution, image generation, hosted MCP, background mode, some options, bodies over 8 MiB.
- Concurrency limit: `429 starter_credit_busy` says how many calls you can have in flight at once. **[PROBE, opt-in]**
- With your own provider key (console → Provider keys), any model your account has works.

---

## 3. What Mubit records

- Request and reply by default (up to 32 MiB of request, the first 4 MiB plus last 256 KiB of answer).
- Shown in **Requests**: Time, Task, Model asked, **Served by**, Response time, Status, **Rating**.
- Call panel: Status, Response, Tokens, Request (**last user message only**), Reply, **Where the time went** (Mubit vs model), **Rate this reply: Good / Bad**, Session ID.
- **[NEW] "Served by"** is a column and a filter: "who answered each call". That only makes sense if something other than the provider can answer, i.e. an adapter. **Strong hint that serving by adapters exists or is coming.** Ask the Mubit team.
- Every answer has `x-middleware-request-id: mreq_<32 hex>`. IDs sort by time. **[PROBE]**
- Not listed: model-list calls, calls refused before reaching the provider, and calls with `store:false` or `record: metadata/off`.

### Headers that reduce what's kept (never forwarded to the provider)
| Header | Effect |
|---|---|
| `x-middleware-store: false` (`0`, `off`, `no`) | Keeps a record **without** request/answer → never a kept example, **not listed in Requests** |
| `x-middleware-record: full / metadata / off` | `metadata` = same as store false. **`off` also drops the task fingerprint** **[NEW]** |
Lowest value wins. They can only lower what's kept, never raise it. **[PROBE]**

---

## 4. Tasks

A task = same **instructions + tools + tool choice + output format + model**.
- Instructions = system prompt (`system` on Anthropic; `system`/`developer` messages on Chat Completions; `instructions` + system/developer items on Responses; `systemInstruction` on Gemini).
- **Ignored:** user/assistant messages, `temperature`, `max_tokens`.
- Whitespace runs count as one space. **Numbers, dates, times, IDs don't split. Other changing words do.** **[PROBE: grouping]**
- Model is read **without date suffix or `-latest`** (`claude-haiku-4-5-20251001` = `claude-haiku-4-5`). **[NEW]**
- Task name = first words of the instructions. **[PROBE]** uses a `PROBE …` prefix so its tasks are easy to spot.

### Sessions **[NEW: matters for training]**
- **"Mubit sets a task's test cases aside by session."** Held-back test cases are chosen **per session**.
  → If all your calls share one session, Mubit may not be able to hold any back (`Waiting for more examples: k of need`). **Give independent examples different session IDs.**
- Session comes from the first of: `metadata.thread_id`, `metadata.session_id`, `metadata.conversation_id`, Anthropic `metadata.user_id`, Responses `prompt_cache_key`. Otherwise from instructions + first user message.
- On Anthropic, an end-user ID in `metadata.user_id` merges all of that user's conversations into one session.

---

## 5. Training and adapters

- Training must be **switched on for your workspace**. Until then the console has **no Adapters page**. **[NEW]** Check this first.
- First training at **25 kept examples** by default (the console count is authoritative). The docs' own example sends **40 calls**.
- Status: `Collecting examples (12 of 25)` → `Reviewing examples` → `Training` → `Testing`.
- Waits: `today's training limit` (resets **00:00 UTC**), `the pause between trainings`, `Waiting for more examples: k of need` (not enough to hold back test cases), `Waiting for new examples` (after a failure).
- Can't train: too few examples, **examples too long**, training run failed, first training stopped.
- **No retry button.** It retries only when new examples arrive.
- After a failed version: `Next: a new version after {need} new examples`, or `Next: retraining paused: {reason}`.
- The docs **don't say** what triggers a new version after one **passes**, or how long training takes.

### Test results per version (Adapters → History)
| Result | Meaning |
|---|---|
| `Passed` | Close enough to the provider. Overview: `v1 passed its tests` |
| `Below target` | `Matched {a}% … needs {need}%`, or `Passed {a}% of {n} required test cases · needs 100%` |
| `Malformed tool calls` | `{k} of {n} tool calls were malformed · needs 0`, so **adapters do tool calls** |
| **`Prompt only`** **[NEW]** | The **base model with your prompt did as well as the adapter**. Not offered in Try models. → Your task is too easy to need an adapter |
| `Not tested` | No result |
While grading: `Waiting for grading on {k} test cases`. While the newest is below target: `Not ready yet`.

### Try models
- **Compare with your provider** → side by side, **you type only the user message**; Mubit adds the task's instructions.
- `not stored · trains nothing`.
- **[NEW] Daily limits:** a number of Try models calls per org per day (the page shows how many are left), and **3 adapter starts per org per UTC day**. First start takes a few minutes; the page retries every 15 s for up to 20 min.
- Can be unavailable: `Not in Try models yet` (workspace can't run adapters yet), `base model isn't served here`, `Try models is off`.

### Using an adapter from your app
- **"There is no Mubit model ID: you can't send a call to an adapter by naming it as the model."**
- No documented routing. But see **Served by** (§3) and the admin **Settings** page that appears "once training is on". Settings may hold the switch. Ask.

---

## 6. Projects, keys, people

- **[NEW] One workspace = one project.** You can't add a second project or delete it. → **Probes and your real product share one project.** That's why every probe prompt starts with `PROBE`, and nothing in the probe kit trains unless you pass `--allow-train`.
- Two key types: **Inference** (sends calls) and **Read only: reads its records**. The read-only key implies a **records-reading API exists but isn't documented**. Ask.
- Only admins: create/rotate/revoke keys, provider keys, import past calls, change Settings, rename the project.
- The console can't invite or remove people. Ask Mubit.
- **Console signs you out after 15 minutes idle.** Annoying on stage: keep the tab active before the demo. **[NEW]**
- Key rotation kills the old secret within ~30 s. Revocation within a minute.

## 7. Import past calls
Langfuse / Braintrust / Pydantic Logfire with a read-only key, 7/14/30-day window, **only calls from before the project's first live call**. Admin only.

## 8. Limits and errors
- Connect 10 s (one retry), first byte 610 s, silence 15 min, total 60 min.
- Mubit retries only if nothing was sent. `x-should-retry: false` on unfixable errors, `retry-after` on 429/503.
- Mubit's own errors have type `middleware_gateway_error` and a `code`. Provider errors pass through unchanged.

---

## 9. What this changes in our plans

1. **The "teacher endpoint" (Plan A) is not possible as documented.** OpenAI-compatible means four fixed services, and any other name gets `404 unknown_provider`. You can't point Mubit at your own server. Corrections can only reach training by **getting the provider to produce the corrected answer** (rules or examples in the user message), unless Mubit shows us an undocumented route.
2. **Sessions drive the test split.** Give each independent example its own `session_id`.
3. **`Prompt only` is a real risk for easy tasks** (yes/no gates, simple classification). The base model may already do as well, and then there's nothing to show in Try models. Make the task need the team-specific learning.
4. **Budget the daily limits:** training (00:00 UTC), Try models calls, **3 adapter starts a day**. Don't waste starts rehearsing.
5. **Ask about "Served by", the Settings page and the read-only key's API.** Those are where routing and correction APIs would live.
6. **Check training is switched on for your workspace** (an Adapters page exists) before planning anything around adapters.

## 9b. Confirmed live by the probes (23 Oct, 23:12–23:13, runs a7bc4d and 0c19b5)

- **Starter credit, OpenAI:** gpt-6-sol, gpt-6.1-sol, gpt-6-luna, gpt-6-astra, gpt-5.5, gpt-4o-mini, gpt-4.1-mini (plus dated IDs).
- **Starter credit, Anthropic:** claude-opus-5-5, claude-sonnet-5-5, claude-haiku-4-5.
- **Gemini works on the starter credit** (gemini-3.8-flash answered).
- OpenRouter, Groq, Together and Mistral: `403 provider_key_missing` until a key is added in the console.
- Chat, streaming, Responses, Anthropic Messages, count_tokens, embeddings, strict json_schema and forced tool calls all pass through.
- **gpt-6-luna is a reasoning model.** It takes only `temperature: 1`, needs `max_completion_tokens` (not `max_tokens`), and refuses function tools on Chat Completions unless `reasoning_effort: "none"` (or use Responses). These are OpenAI's rules; Mubit passes the errors through.
- **`metadata.session_id` can't be used on Chat Completions on the starter credit.** OpenAI requires `store: true` for metadata, and the starter credit refuses `store`. Use the **Responses API `prompt_cache_key`**, Anthropic `metadata.user_id`, or rely on the default (instructions + first user message, so distinct messages are distinct sessions).
- All 7 error checks returned the documented codes, with `x-should-retry: false`.
- **No extra Mubit response header**: only `x-middleware-request-id`. Nothing in the headers says what served a call.
- Latency is small. Gateway refusals take about 250 ms round trip. Answered calls took 0.9–2 s, most of it the model.

## 9c. Seen in the console (screenshots, 23 Oct ~23:25)

- **Routing exists.** Overview shows **"Routed requests 0.0%: adapter or base under task rules"**, **"Adapters serving 0"**, and a **Request routing** panel (Task rules / Other requests / Errors). → Live calls *can* be answered by an adapter, **or by the base open model**, when a **task rule** says so. That answers the "can the app use the adapter?" question: yes, through task rules. How a rule is made is still unknown (probably once a version passes, on the task or in Settings).
- **Tasks tabs: All, Live, Needs review, Learning.** "Live" is probably tasks being served by an adapter. "Needs review" is unknown.
- **A "Learnings" page** in the sidebar, not in the docs. Possibly where corrections or lessons live (the old SDK's word was "lessons"). **Check it.**
- **Requests filters: Route, Task, Served by, Errors only, "Include copies".** "Copies" isn't documented: maybe shadow calls sent to an adapter for comparison.
- Every probe call so far: **Served by = "Your provider"**.
- Provider errors (the 400s) are recorded and counted under Errors.
- Task names get a number when they clash: the "PROBE grouping A" prompt became task **"PROBE grouping 2"**. The task panel says why calls are one task ("Grouped: same instructions and tools") and has **"Try its samples"**.
- New tasks show "Reviewing examples · 0 of 25" and "kind not known yet". Kept-example counting seems to happen after a delay.
- **The Adapters page exists**, so training is on for this workspace.
- The console's internal product name shows as **"Middleware"** ("Every call through Middleware"). The project is labelled **Production**, and there's a **Dev** item under Workspace.

## 9d. Read in the console myself (23 Oct ~23:32, engine 0.14.0)

### Going live is automatic: how an adapter starts answering your calls
Settings → **Going live** (all "Set by Middleware" unless noted):
1. **Approval: automatically, once it passes.** No button to press.
2. **Silent test:** the new version answers **copies** of 10% of calls (up to 100 a day). Users never see these replies. (Requests → "Include copies" = *"Silent-test and spot-check copies of calls"*.)
3. **Partial rollout:** then it answers **10% of real calls, for at least 100 calls**.
4. **Live:** then it answers the task's calls. Requests' **Served by** changes from "Your provider".
5. **Spot checks while live:** the provider re-answers **2%** of the adapter's calls (min 10, max 500 a day) and a grader compares them. Safety checks can pull a version.
- Quality bar: **90%** of test cases like your provider. The pass rate on real calls a rollout step needs is 0.9, with a cautious-estimate floor of 0.75.
- A step needs **≥50 graded spot checks from ≥10 sessions** (`promotion.min_pairs`, `min_sessions`). → Seeing an adapter go live needs **hundreds of calls** of one task (at 10% shadow, ~500 calls for 50 pairs), plus 100 canary calls.
- `promotion.allow_rules_only: true`: a **"prompt only" version (the base model plus your prompt) may also go live**. That's the "adapter **or base**" on the Overview.
- Routes look like `mw-auto/gpt-6-luna-9a7e60/<task key>`. Each task is a route.

### Training (admin-editable values in bold)
- **New versions after 25 new examples** (editable). Retraining also needs new examples ≥ 50% of the live version's (`adapters.refresh.min_new_fraction`).
- **Longest example: 256 KB** (editable). Longer ones are left out.
- **Training limit: "No daily limit"** for this org, and `cooldown_minutes: 0`. The daily limit and pause in the docs may not bite here.
- A training run takes **at most 250 examples, newest first**. 10% of earlier examples are replayed. No warm start: each version retrains from the base model.
- **The reviewer reads at most 200 new calls per task per day** (`adapters.rate.max_per_day`). Reviewing is slow: 13 minutes after our probe calls, the task showed "9 waiting for review · 1 running · 0 kept".
- **Base models: `Qwen/Qwen3-4B-Instruct-2507`, `Qwen/Qwen3-8B`** (reference: `Qwen/Qwen3-1.7B`).
- Test-case kinds: contains, regex, number, figures_in_input, tool_call, json_schema, and the grader.
- **Grader: `gemini-3.1-flash-lite`** (judge id `j1-2026-10-10-lite-rc-rule+flash-rd`), with a pair check on `gemini-3.8-flash`.

### Tests and pass bar (admin-editable)
- **Pass bar: within 5 points** of your provider model's score (10 more when test cases can't tell them apart).
- **Live needs 20 judged test cases.**

### Data
- Calls kept **90 days** (training examples and versions keep theirs).
- `data.train_opt_out`: routes whose calls never train.
- **"Tasks with their own settings: Add one…"**: per-task overrides of all of the above.

### The memory engine is still inside
Settings → Advanced lists the old SDK's engine (`distill.*`, `gate.*`, `inject.*`, `attribute.*`):
- lesson types **success, failure, observation, rule, preference**;
- injection of lessons/rules/procedures/facts into prompts (`inject.budget_tokens 2048`);
- a gate that promotes lessons at **0.6** and rejects at **0.25** (the same numbers as the old `record_outcome` docs);
- **`feedback.outcome: off`**: an outcome-feedback path exists but is switched off. **Ask the Mubit team whether it can be switched on**: it's the most likely route for human corrections.
- `adapters.distill_rules: true` and `promotion.allow_rules_only`: lessons can apparently become rules in a prompt-only version.
- The **Learnings** page ("formed from this project's calls") is empty so far.

### Other
- **Projects: "1 of 5 projects in Dev" with a "New project…" button.** The docs say one project, but this org can have **up to 5**. → **Make a separate project for the real product** and keep probes here.
- Overhead measured: a call spent **6 ms in Middleware, 557 ms at the provider**.
- Grouping experiment, confirmed: base, settings changes and whitespace = **one task** ("PROBE grouping 2", 11 calls). json_object = its own task ("PROBE grouping"). Tool = its own task ("PROBE grouping 3"). Numbers (B) and dates (C) = one task each. Names (D) = **two tasks** ("D" and "D 2"). OpenAI and Anthropic calls with the same prompt are separate tasks ("stream"/"stream 2", "sessions"/"sessions 2"). **Embeddings made no task.**
- Provider errors (400s) count as calls of the task.
- "Figures unavailable" on task pages is a console permission bug ("metrics needs manager"). Task details still load.
- Billing page exists (`/console/billing`).
- **Projects now:** `dev-1792780471338405713` (slug `ws-04e74808ba664368`) = **probes only**. `nightshift-product` (slug `ws-d4892b2965d62736`, created 23 Oct ~23:40, no key yet) = **the real product**. Same default settings. Starter credit and Try models calls are **shared** between projects. Keys work for one project only, so `.env` (probe key) must not be used for the product.
- **Provider keys are per project too** ("These keys are used by nightshift-product only"). The **OpenRouter key was added to nightshift-product** on 24 Oct, so OpenRouter models (e.g. `typesafe/jev-1.14`) only work with the nightshift-product Mubit key.
- **Jev (TypeSafe):** its native API is `POST api.typesafe.ai/v1/systemone` with `state` + `questions` (types noul/choice/score/box), rate-limited per org (429 on excess). Through Mubit it's only reachable as OpenRouter **chat completions** (Mubit's `/compat` serves `/chat/completions`, `/embeddings`, `/models`). Plan: use it as a **comparison baseline**, not the teacher (§ chat-mod notes).
- **Tested 24 Oct 10:25: Jev can't go through Mubit.** Via `/compat/openrouter/v1/chat/completions`, OpenRouter answers `400`: *"typesafe/jev-1.14 is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead."* Mubit refuses that path (`404 unknown_route`, for both `/compat/openrouter/v1/decisions` and `/compat/openrouter/api/alpha/decisions`). Since every call must go through Mubit, **Jev is out**, even as a baseline. A chat model on OpenRouter (e.g. an open Qwen3-4B, the same family as the adapter base) would work as the "generic fast model" baseline instead.
- The key in `MUBIT_API_KEY` reached OpenRouter, so it works with the project that holds the OpenRouter key.
- **Speed test, 24 Oct 10:26: `qwen/qwen3-30b-a3b-instruct-2507` via OpenRouter through Mubit** (no small Qwen3-4B/8B on OpenRouter; this is the same Instruct-2507 generation, ~3B active parameters, no thinking). Chat-mod prompt, JSON reply, `x-middleware-record: off`:

  | At once | Wall time | OK | p50 | p95 | Throughput |
  |---|---|---|---|---|---|
  | 1 | 1.4 s | 1/1 | — | — | — |
  | 10 | 2.0 s | 10/10 | 1.7 s | 2.0 s | ~5 msg/s |
  | 50 | 4.5 s | 50/50 | 1.4 s | 2.6 s | ~11 msg/s |
  | 100 | 4.6 s | 100/100 | 1.1 s | 2.0 s | ~22 msg/s |

  - **No rate-limit errors at 100 at once.** Throughput grew with concurrency, so the limit wasn't reached.
  - **Pushed further (10:27): 200 at once → 7.8 s, 200/200 ok, p50 1.6 s, p95 3.8 s (~26 msg/s). 300 at once → 7.8 s, 300/300 ok, p50 1.5 s, p95 3.0 s (~39 msg/s).** Still no errors from Mubit, OpenRouter or the provider. Wall time (7.8 s) was well above the slowest calls' p95, so **our test client is probably now the bottleneck** (plain urllib, a new TLS connection per call, Python threads). A real server with connection reuse (httpx/aiohttp) should do better. The true break point is above 300 at once and not yet found.
  - Cost from OpenRouter's usage field: **~$0.000011 per message (~$0.011 per 1,000)** at ~95 tokens a call.
  - Rough projection (not measured): 1,000 messages ≈ 45 s at 100 at once; faster only with more parallel calls, if limits allow.
  - The generic model's answers show the gap corrections should fix: "DM me for the airdrop, 3x your ETH" → **flag / spam** (not remove / scam); "FREE USDT claim now" → flag / spam; "this project is trash lol" → flag / harassment; "gm frens", "wagmi" → allow.

## 9e. Answers from the Mubit team (Discord #general, 24 Oct ~12:00)

Shankha (Mubit tech support), replying to another team:
- *"Currently our auto router handles which reqs go where. We will push an update later which allows you to put adapter id in header to specify which adapter the req should go to."*
- *"If the adapter is good enough it will start serving traffic automatically. The explicit serving option is not GA as of now."*

What this settles:
- **Serving is automatic only.** You can't send a call to a chosen adapter yet. Seeing "Served by: adapter" requires the adapter to pass its tests and the go-live steps (§9d): enough recorded traffic of one task.
- **An adapter-id header is coming "later"**, maybe during the event. If it arrives, a demo could call v1 and v2 explicitly.
- **Still unanswered:** (1) a supported way to send human corrections or ratings directly (`feedback.outcome`, Good/Bad); (2) whether calls sent with `x-middleware-store: false` can be served by a live adapter.
- Submission is **Sunday** (code freeze 10:00), per the channel.

## 10. Questions the docs can't answer (ask at the Mubit desk)
1. What does **Good / Bad** do to kept examples and test cases?
2. Any way to send a **human-corrected reply** as an example?
3. What can **Served by** show besides the provider? Can live calls be served by a passing adapter? Is that in **Settings**?
4. What API does a **read-only key** read?
5. How long does a training run take? Our workspace's daily training limit and pause length? What triggers a new version after a **passing** one?
6. Which **base model**? What are the adapter's cost and latency?
7. Is the old `mubit-sdk` (remember/recall, still on PyPI at 0.13.2) supported for this event?
8. Is training switched on for every hacker workspace?
