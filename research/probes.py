#!/usr/bin/env python3
"""Mubit probe kit: exercise every documented part of the Mubit gateway.

Standard library only (Python 3.9+). Reads MUBIT_API_KEY from the environment
or from a .env file next to this script. Writes results/<run>.json and
results/<run>.md, including a checklist of what to look at in the console.

    python3 probes.py                 # all safe probes
    python3 probes.py grouping errors # chosen probes only
    python3 probes.py --list          # what each probe does

Safe by default: every probe's instructions start with "PROBE", and no task
gets near 25 examples. Probes that can train an adapter, burst the starter
credit or need the old SDK only run with their --allow-* flag.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN = time.strftime("%Y%m%d-%H%M%S")
TAG = uuid.uuid4().hex[:6]  # marks this run's calls so you can find them in Requests

# Response headers worth keeping. Anything starting with x- is kept too, so an
# undocumented Mubit header (for example one saying what served the call) shows up.
KEEP_HEADERS = {"retry-after", "content-type", "request-id"}


def load_env():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("'\""))


def mask(text, key):
    return text.replace(key, "mbt_****") if key else text


class Ctx:
    def __init__(self, key, base):
        self.key = key
        self.base = base.rstrip("/")
        self.openai_model = os.environ.get("MUBIT_OPENAI_MODEL", "gpt-6-luna")
        self.anthropic_model = os.environ.get("MUBIT_ANTHROPIC_MODEL", "claude-haiku-4-5")
        self.gemini_model = os.environ.get("MUBIT_GEMINI_MODEL", "gemini-3.8-flash")

    def auth(self, style="bearer", key=None):
        key = self.key if key is None else key
        if style == "bearer":
            return {"Authorization": f"Bearer {key}"}
        if style == "anthropic":
            return {"x-api-key": key, "anthropic-version": "2023-06-01"}
        if style == "gemini":
            return {"x-goog-api-key": key}
        return {}

    def call(self, method, path, body=None, headers=None, stream=False):
        """One HTTP call. Returns a summary dict; never raises on HTTP errors."""
        url = self.base + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("content-type", "application/json")
        for name, value in (headers or {}).items():
            req.add_header(name, value)
        started = time.monotonic()
        first_byte = None
        try:
            resp = urllib.request.urlopen(req, timeout=180)
            status = resp.status
            raw_headers = resp.headers
            if stream:
                chunks = []
                for line in resp:
                    if first_byte is None:
                        first_byte = time.monotonic()
                    chunks.append(line.decode(errors="replace"))
                text = "".join(chunks)
            else:
                text = resp.read().decode(errors="replace")
                first_byte = time.monotonic()
        except urllib.error.HTTPError as err:
            status = err.code
            raw_headers = err.headers
            text = err.read().decode(errors="replace")
        except urllib.error.URLError as err:
            return {"path": path, "status": None, "error": str(err.reason),
                    "ms": round((time.monotonic() - started) * 1000)}
        ended = time.monotonic()
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed = None
        kept = {k.lower(): v for k, v in raw_headers.items()
                if k.lower().startswith("x-") or k.lower() in KEEP_HEADERS}
        return {
            "path": path,
            "status": status,
            "ms": round((ended - started) * 1000),
            "ttfb_ms": round((first_byte - started) * 1000) if first_byte else None,
            "headers": kept,
            "json": parsed,
            "text": None if parsed is not None else mask(text[:4000], self.key),
        }

    def chat(self, system, user, extra=None, headers=None, model=None):
        body = {"model": model or self.openai_model,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}]}
        body.update(extra or {})
        h = self.auth()
        h.update(headers or {})
        return self.call("POST", "/openai/v1/chat/completions", body, h)


def error_code(res):
    """Mubit's error code from any of the three provider formats."""
    j = res.get("json") or {}
    err = j.get("error")
    if isinstance(err, dict):
        if isinstance(err.get("code"), str):
            return err["code"]
        for detail in err.get("details", []):
            if detail.get("reason"):
                return detail["reason"]
    return None


def error_message(res):
    j = res.get("json") or {}
    err = j.get("error")
    if isinstance(err, dict):
        return err.get("message")
    return res.get("text")


def reply_text(res):
    j = res.get("json") or {}
    try:
        return j["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        pass
    try:
        return "".join(b.get("text", "") for b in j["content"])
    except (KeyError, TypeError):
        pass
    try:
        return j["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        pass
    return None


def short(res):
    """One line describing a call."""
    bits = [f"HTTP {res.get('status')}", f"{res.get('ms')} ms"]
    code = error_code(res)
    if code:
        bits.append(f"code={code}")
    rid = (res.get("headers") or {}).get("x-middleware-request-id")
    if rid:
        bits.append(rid)
    return ", ".join(bits)


# ---------------------------------------------------------------- probes

PROBES = {}


def probe(name, needs_key=True, flag=None):
    def register(fn):
        PROBES[name] = {"fn": fn, "needs_key": needs_key, "flag": flag,
                        "doc": (fn.__doc__ or "").strip()}
        return fn
    return register


@probe("connect")
def p_connect(c, out):
    """Model lists for OpenAI and Anthropic (not recorded in Requests)."""
    for label, path, style in (("OpenAI", "/openai/v1/models", "bearer"),
                               ("Anthropic", "/anthropic/v1/models", "anthropic")):
        r = c.call("GET", path, headers=c.auth(style))
        out.calls.append(r)
        ids = [m.get("id") for m in ((r.get("json") or {}).get("data") or [])]
        out.find(f"{label} model list: {short(r)}; {len(ids)} models"
                 + (f": {', '.join(ids[:25])}" if ids else ""))
        if r.get("headers"):
            out.find(f"{label} response headers: {sorted(r['headers'])}")


@probe("starter_models")
def p_starter_models(c, out):
    """Name a model that doesn't exist: the starter credit's refusal lists the models it serves."""
    r = c.chat("PROBE starter models: reply ok.", "ok", model="probe-no-such-model")
    out.calls.append(r)
    out.find(f"OpenAI bogus model: {short(r)}")
    msg = error_message(r)
    if msg:
        out.find(f"OpenAI message: {msg}")
        models = sorted(set(re.findall(r"\b(?:gpt|o\d|chatgpt)[\w.\-]*", msg)))
        if models:
            out.find(f"OpenAI starter models seen: {models}")
    body = {"model": "probe-no-such-model", "max_tokens": 8,
            "system": "PROBE starter models: reply ok.",
            "messages": [{"role": "user", "content": "ok"}]}
    r = c.call("POST", "/anthropic/v1/messages", body, c.auth("anthropic"))
    out.calls.append(r)
    out.find(f"Anthropic bogus model: {short(r)}")
    if error_message(r):
        out.find(f"Anthropic message: {error_message(r)}")


@probe("chat_basic")
def p_chat_basic(c, out):
    """One Chat Completions call: reply, usage, latency, every x- response header."""
    r = c.chat("PROBE basic: Sort the message into billing, bug, account or other. "
               "Reply with the category only.",
               f"[{TAG}] I was charged twice for my October invoice.")
    out.calls.append(r)
    out.find(f"Chat: {short(r)}; reply={reply_text(r)!r}")
    out.find(f"Usage: {(r.get('json') or {}).get('usage')}")
    out.find(f"Response headers: {r.get('headers')}")
    out.console(f"Requests: find the call whose message starts with [{TAG}]. "
                "Write down Served by, Where the time went, and the task name.")


@probe("stream")
def p_stream(c, out):
    """Streaming on OpenAI and Anthropic: time to first byte vs total."""
    body = {"model": c.openai_model, "stream": True,
            "messages": [{"role": "system", "content": "PROBE stream: answer in three sentences."},
                         {"role": "user", "content": f"[{TAG}] Why do invoices get duplicated?"}]}
    r = c.call("POST", "/openai/v1/chat/completions", body, c.auth(), stream=True)
    out.calls.append({k: v for k, v in r.items() if k != "text"})
    out.find(f"OpenAI stream: {short(r)}; first byte {r.get('ttfb_ms')} ms")
    body = {"model": c.anthropic_model, "max_tokens": 200, "stream": True,
            "system": "PROBE stream: answer in three sentences.",
            "messages": [{"role": "user", "content": f"[{TAG}] Why do invoices get duplicated?"}]}
    r = c.call("POST", "/anthropic/v1/messages", body, c.auth("anthropic"), stream=True)
    out.calls.append({k: v for k, v in r.items() if k != "text"})
    out.find(f"Anthropic stream: {short(r)}; first byte {r.get('ttfb_ms')} ms")


@probe("responses_api")
def p_responses(c, out):
    """OpenAI Responses API through the same base URL."""
    body = {"model": c.openai_model,
            "instructions": "PROBE responses: reply with one word.",
            "input": f"[{TAG}] Say hello."}
    r = c.call("POST", "/openai/v1/responses", body, c.auth())
    out.calls.append(r)
    text = None
    for item in (r.get("json") or {}).get("output", []) or []:
        for part in item.get("content", []) or []:
            text = part.get("text") or text
    out.find(f"Responses: {short(r)}; reply={text!r}")


@probe("anthropic_basic")
def p_anthropic(c, out):
    """Anthropic Messages, plus count_tokens."""
    body = {"model": c.anthropic_model, "max_tokens": 16,
            "system": "PROBE anthropic: reply with the category only: billing, bug, account or other.",
            "messages": [{"role": "user", "content": f"[{TAG}] The export button errors."}]}
    r = c.call("POST", "/anthropic/v1/messages", body, c.auth("anthropic"))
    out.calls.append(r)
    out.find(f"Anthropic: {short(r)}; reply={reply_text(r)!r}")
    body.pop("max_tokens")
    r = c.call("POST", "/anthropic/v1/messages/count_tokens", body, c.auth("anthropic"))
    out.calls.append(r)
    out.find(f"count_tokens: {short(r)}; {r.get('json')}")


@probe("gemini_basic")
def p_gemini(c, out):
    """Gemini generateContent (403 provider_key_missing means no Gemini on the starter credit)."""
    body = {"system_instruction": {"parts": [{"text": "PROBE gemini: reply with one word."}]},
            "contents": [{"parts": [{"text": f"[{TAG}] Say hello."}]}]}
    r = c.call("POST", f"/gemini/v1beta/models/{c.gemini_model}:generateContent",
               body, c.auth("gemini"))
    out.calls.append(r)
    out.find(f"Gemini: {short(r)}; reply={reply_text(r)!r}")


@probe("compat")
def p_compat(c, out):
    """OpenAI-compatible services: an unknown service name lists the real ones."""
    r = c.call("POST", "/compat/probe-unknown/v1/chat/completions",
               {"model": "x", "messages": [{"role": "user", "content": "ok"}]}, c.auth())
    out.calls.append(r)
    out.find(f"Unknown service: {short(r)}; {error_message(r)}")
    for service in ("openrouter", "groq", "together", "mistral"):
        r = c.call("GET", f"/compat/{service}/v1/models", headers=c.auth())
        out.calls.append({k: v for k, v in r.items() if k != "json"})
        n = len(((r.get("json") or {}).get("data")) or [])
        out.find(f"{service} models: {short(r)}" + (f"; {n} models" if n else ""))


@probe("embeddings")
def p_embeddings(c, out):
    """Embeddings pass-through (do they form tasks? check Tasks afterwards)."""
    model = os.environ.get("MUBIT_EMBED_MODEL", "text-embedding-3-small")
    r = c.call("POST", "/openai/v1/embeddings",
               {"model": model, "input": f"[{TAG}] duplicated invoice"}, c.auth())
    out.calls.append({k: v for k, v in r.items() if k != "json"})
    data = (r.get("json") or {}).get("data") or []
    dims = len(data[0].get("embedding", [])) if data else 0
    out.find(f"Embeddings ({model}): {short(r)}; dims={dims}; {error_message(r) or ''}")
    out.console("Tasks: does an embeddings task appear? (tells you if embeddings can train)")


@probe("errors", needs_key=False)
def p_errors(c, out):
    """Mubit's own error codes: missing key, bad key, routes, paths, extra credentials."""
    msg = {"model": c.openai_model, "messages": [{"role": "user", "content": "ok"}]}
    cases = [
        ("no key", "POST", "/openai/v1/chat/completions", {}),
        ("bad key", "POST", "/openai/v1/chat/completions", c.auth(key="mbt_probe_invalid")),
        ("unknown route", "GET", "/probe/unknown", c.auth()),
        ("admin path", "GET", "/openai/v1/organization/users", c.auth()),
        ("invalid path", "GET", "/openai/v1/a;b", c.auth()),
        ("fake provider key", "POST", "/openai/v1/chat/completions",
         c.auth(key="sk-proj-probeFAKEprobeFAKEprobeFAKE")),
    ]
    if c.key:
        both = c.auth("anthropic")
        both["Authorization"] = "Bearer sk-ant-probeFAKE"
        cases.append(("extra credential", "POST", "/anthropic/v1/messages", both))
    for label, method, path, headers in cases:
        r = c.call(method, path, msg if method == "POST" else None, headers)
        out.calls.append(r)
        out.find(f"{label}: {short(r)}; should-retry={r.get('headers', {}).get('x-should-retry')}; "
                 f"{error_message(r)}")


@probe("store_headers")
def p_store(c, out):
    """x-middleware-store / -record: the call works, but should vanish from Requests."""
    system = "PROBE store: reply with one word."
    for header, value in (("x-middleware-store", "false"),
                          ("x-middleware-record", "metadata"),
                          ("x-middleware-record", "off"),
                          ("x-middleware-record", "full")):
        marker = f"[{TAG}-{header[13:]}-{value}]"
        r = c.chat(system, f"{marker} Say hi.", headers={header: value})
        out.calls.append(r)
        out.find(f"{header}: {value}: {short(r)}; marker {marker}")
    out.console(f"Requests: search for [{TAG}-. Only the '-record-full]' call should be listed.")


@probe("sessions")
def p_sessions(c, out):
    """metadata.session_id / thread_id on Chat Completions (OpenAI once needed store:true for metadata)."""
    system = "PROBE sessions: reply with one word."
    for field in ("session_id", "thread_id", "conversation_id"):
        sid = f"probe-{TAG}-{field}"
        r = c.chat(system, f"[{TAG}] Say hi.", extra={"metadata": {field: sid}})
        out.calls.append(r)
        out.find(f"metadata.{field}={sid}: {short(r)}; {error_message(r) or 'accepted'}")
    r = c.chat(system, f"[{TAG}] Say hi.",
               extra={"metadata": {"session_id": f"probe-{TAG}-store"}, "store": True})
    out.calls.append(r)
    out.find(f"metadata + store:true: {short(r)}; {error_message(r) or 'accepted'}")
    # The other documented session sources.
    body = {"model": c.openai_model, "instructions": system, "input": f"[{TAG}] Say hi.",
            "prompt_cache_key": f"probe-{TAG}-pck"}
    r = c.call("POST", "/openai/v1/responses", body, c.auth())
    out.calls.append(r)
    out.find(f"Responses prompt_cache_key=probe-{TAG}-pck: {short(r)}; {error_message(r) or 'accepted'}")
    body = {"model": c.anthropic_model, "max_tokens": 16, "system": system,
            "metadata": {"user_id": f"probe-{TAG}-anth"},
            "messages": [{"role": "user", "content": f"[{TAG}] Say hi."}]}
    r = c.call("POST", "/anthropic/v1/messages", body, c.auth("anthropic"))
    out.calls.append(r)
    out.find(f"Anthropic metadata.user_id=probe-{TAG}-anth: {short(r)}; {error_message(r) or 'accepted'}")
    out.console(f"Requests → Session filter: try probe-{TAG}-pck and probe-{TAG}-anth; each should "
                "find one call.")


GROUP_BASE = "PROBE grouping A: Say if the message is positive or negative. Reply with one word."
GROUP_EXPERIMENTS = [
    # (label, [(system, extra), ...], what the docs predict)
    ("A same prompt, different user messages", [(GROUP_BASE, {}), (GROUP_BASE, {})], "1 task"),
    # gpt-6-luna is a reasoning model: it takes only temperature 1 and max_completion_tokens.
    ("A + settings changes", [(GROUP_BASE, {"temperature": 1}),
                              (GROUP_BASE, {"max_completion_tokens": 300}),
                              (GROUP_BASE, {"reasoning_effort": "none"})],
     "same task as A"),
    ("A with extra spaces and line breaks", [(GROUP_BASE.replace(" ", "   ").replace(":", ":\n\n"), {})],
     "same task as A"),
    ("A + response_format json_object", [(GROUP_BASE, {"response_format": {"type": "json_object"}})],
     "new task (output format differs)"),
    # Chat Completions refuses function tools on gpt-6-luna unless reasoning_effort is none.
    ("A + a tool", [(GROUP_BASE, {"reasoning_effort": "none", "tools": [{"type": "function", "function": {
        "name": "label", "parameters": {"type": "object", "properties": {
            "sentiment": {"type": "string"}}}}}]})], "new task (tools differ)"),
    ("B numbers differ", [("PROBE grouping B: Ticket 1042. Reply with one word.", {}),
                          ("PROBE grouping B: Ticket 7731. Reply with one word.", {})],
     "1 task (numbers don't split)"),
    ("C dates differ", [("PROBE grouping C: Today is 2026-10-23. Reply with one word.", {}),
                        ("PROBE grouping C: Today is 2026-10-24. Reply with one word.", {})],
     "1 task (dates don't split)"),
    ("D names differ", [("PROBE grouping D: Customer is Alice. Reply with one word.", {}),
                        ("PROBE grouping D: Customer is Bob. Reply with one word.", {})],
     "2 tasks (words split)"),
]


@probe("grouping")
def p_grouping(c, out):
    """Task-grouping experiment: which prompt changes split a task (check Tasks afterwards)."""
    n = 0
    for label, variants, expect in GROUP_EXPERIMENTS:
        statuses = []
        for system, extra in variants:
            n += 1
            # "JSON" is in every user message because json_object mode requires the word,
            # and user messages don't affect grouping.
            r = c.chat(system, f"[{TAG}-g{n}] I love this product {n}. JSON is fine.", extra=extra)
            out.calls.append(r)
            statuses.append(str(r.get("status")))
        out.find(f"{label}: HTTP {'/'.join(statuses)}; docs predict {expect}")
    out.console("Tasks: list every task whose name starts 'PROBE grouping'. Compare with the "
                "predictions above. 'PROBE grouping A' should be ONE task holding the plain, "
                "temperature and whitespace calls.")


@probe("tools_structured")
def p_tools(c, out):
    """Forced tool call and strict json_schema output pass through unchanged."""
    tools = [{"type": "function", "function": {
        "name": "file_ticket", "description": "File a support ticket.",
        "parameters": {"type": "object", "required": ["category"], "properties": {
            "category": {"type": "string", "enum": ["billing", "bug", "account", "other"]}}}}}]
    r = c.chat("PROBE tools: file a ticket for the message.", f"[{TAG}] Charged twice.",
               extra={"tools": tools, "reasoning_effort": "none",
                      "tool_choice": {"type": "function", "function": {"name": "file_ticket"}}})
    out.calls.append(r)
    try:
        call = r["json"]["choices"][0]["message"]["tool_calls"][0]["function"]
    except (KeyError, IndexError, TypeError):
        call = None
    out.find(f"Tool call: {short(r)}; {call}")
    schema = {"type": "json_schema", "json_schema": {"name": "ticket", "strict": True, "schema": {
        "type": "object", "additionalProperties": False, "required": ["category", "urgent"],
        "properties": {"category": {"type": "string", "enum": ["billing", "bug", "account", "other"]},
                       "urgent": {"type": "boolean"}}}}}
    r = c.chat("PROBE structured: classify the message.", f"[{TAG}] Site is down for everyone!",
               extra={"response_format": schema})
    out.calls.append(r)
    out.find(f"json_schema: {short(r)}; reply={reply_text(r)!r}")


@probe("readonly_key")
def p_readonly(c, out):
    """With MUBIT_READONLY_KEY set: a read-only key must be refused for calls (403 key_permission)."""
    ro = os.environ.get("MUBIT_READONLY_KEY")
    if not ro:
        out.find("Skipped: set MUBIT_READONLY_KEY to a Read only key to run this.")
        return
    r = c.call("POST", "/openai/v1/chat/completions",
               {"model": c.openai_model, "messages": [{"role": "user", "content": "ok"}]},
               c.auth(key=ro))
    out.calls.append(r)
    out.find(f"Read-only key on chat: {short(r)}; {error_message(r)}")
    r = c.call("GET", "/openai/v1/models", headers=c.auth(key=ro))
    out.calls.append({k: v for k, v in r.items() if k != "json"})
    out.find(f"Read-only key on model list: {short(r)}")


@probe("burst", flag="allow_burst")
def p_burst(c, out):
    """12 calls at once: finds the starter credit's in-flight limit (429 starter_credit_busy)."""
    def one(i):
        return c.chat("PROBE burst: reply with one word.", f"[{TAG}-b{i}] Say hi.")
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(one, range(12)))
    out.calls.extend(results)
    codes = [error_code(r) or str(r.get("status")) for r in results]
    out.find(f"Burst of 12: {codes}")
    busy = [r for r in results if error_code(r) == "starter_credit_busy"]
    if busy:
        out.find(f"Busy message: {error_message(busy[0])}; retry-after="
                 f"{busy[0].get('headers', {}).get('retry-after')}")


JEV_SYSTEM = ("PROBE jev: You moderate a developer community's live chat. Classify the message. "
              'Reply with JSON only: {"action": "allow|flag|remove", '
              '"reason": "ok|spam|scam|harassment|off_topic"}')
JEV_MESSAGES = ["gm frens, ship it 🚢", "DM me for the airdrop, 3x your ETH",
                "anyone tried v0.3 yet?", "this project is trash lol",
                "FREE USDT claim now bit.ly/xyz", "wagmi 🚀🚀🚀"]


@probe("jev", flag="allow_jev")
def p_jev(c, out):
    """Jev (typesafe/jev-1.14) via OpenRouter through Mubit: reply shape, latency, 10/50/100 calls at once.
    Uses MUBIT_PRODUCT_KEY (the OpenRouter key lives in nightshift-product); nothing is recorded."""
    pk = os.environ.get("MUBIT_PRODUCT_KEY")
    if not pk:
        out.find("Skipped: set MUBIT_PRODUCT_KEY in .env to the nightshift-product key.")
        return
    model = os.environ.get("MUBIT_JEV_MODEL", "typesafe/jev-1.14")
    headers = c.auth(key=pk)
    headers["x-middleware-record"] = "off"  # measurement only: no task, no training

    def one(i):
        body = {"model": model, "messages": [
            {"role": "system", "content": JEV_SYSTEM},
            {"role": "user", "content": f"[{TAG}-j{i}] {JEV_MESSAGES[i % len(JEV_MESSAGES)]}"}]}
        return c.call("POST", "/compat/openrouter/v1/chat/completions", body, headers)

    first = one(0)
    out.calls.append(first)
    j = first.get("json") or {}
    out.find(f"Single call: {short(first)}; model={j.get('model')!r}; reply={reply_text(first)!r}; "
             f"usage={j.get('usage')}; {error_message(first) or ''}")
    if first.get("status") != 200:
        return
    levels = [int(x) for x in os.environ.get("MUBIT_JEV_LEVELS", "10,50,100").split(",")]
    for n in levels:
        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=n) as pool:
            results = list(pool.map(one, range(n)))
        wall = time.monotonic() - started
        ok = [r for r in results if r.get("status") == 200]
        ms = sorted(r["ms"] for r in ok)
        codes = {}
        for r in results:
            key = error_code(r) or str(r.get("status"))
            codes[key] = codes.get(key, 0) + 1
        p50 = ms[len(ms) // 2] if ms else None
        p95 = ms[int(len(ms) * 0.95) - 1] if ms else None
        out.calls.append({"concurrency": n, "wall_s": round(wall, 2), "codes": codes,
                          "p50_ms": p50, "p95_ms": p95})
        out.find(f"{n} at once: {wall:.1f} s wall, {len(ok)}/{n} ok, "
                 f"p50 {p50} ms, p95 {p95} ms, ~{len(ok) / wall:.0f} msg/s; {codes}")
    samples = [reply_text(r) for r in results[:6]]
    out.find(f"Sample replies: {samples}")


TRAIN_SYSTEM = ("PROBE train: Sort the support message into one category: "
                "billing, bug, account or other. Reply with the category only.")
TRAIN_TEMPLATES = [
    "I was charged twice for my {} plan this month.",
    "The {} dashboard shows an error when I export a report.",
    "How do I change the email address on my {} account?",
    "Can I get a refund for the {} plan I cancelled yesterday?",
    "The {} mobile app closes when I open settings.",
    "I can't reset the password for my {} account.",
    "Do you offer the {} plan to charities?",
    "Where can I download last month's invoice for the {} plan?",
]
TRAIN_PLANS = ["Starter", "Team", "Business", "Enterprise", "Education"]


@probe("train", flag="allow_train")
def p_train(c, out):
    """40 calls of one task, one session each, to see training end to end. USES THE DAILY TRAINING LIMIT."""
    started = time.strftime("%H:%M:%S")
    statuses = []
    for i, (tpl, plan) in enumerate((t, p) for t in TRAIN_TEMPLATES for p in TRAIN_PLANS):
        r = c.chat(TRAIN_SYSTEM, tpl.format(plan),
                   extra={"metadata": {"session_id": f"probe-train-{TAG}-{i}"}})
        statuses.append(r.get("status"))
    out.calls.append({"sent": len(statuses), "statuses": statuses})
    out.find(f"Sent {len(statuses)} calls at {started} (local); "
             f"{statuses.count(200)} answered 200.")
    out.console("Tasks → 'PROBE train': note the time of each status change "
                "(Collecting → Reviewing → Training → Testing) to learn how long training takes.")
    out.console("Adapters → History: note the test result, the matched %, and the 'Next:' line.")
    out.console("If it passes: Try models → Compare with your provider (uses 1 of the 3 daily "
                "adapter starts). Check whether Requests' Served by ever shows the adapter.")


@probe("old_sdk", flag="allow_old_sdk")
def p_old_sdk(c, out):
    """Old memory SDK (pip install mubit-sdk==0.13.2): is remember/recall still alive?"""
    try:
        from mubit import Client  # noqa: WPS433 (optional dependency)
    except ImportError:
        out.find("Skipped: run `pip install mubit-sdk==0.13.2` (needs Python 3.10+) first.")
        return
    endpoint = os.environ.get("MUBIT_ENDPOINT", c.base)
    try:
        client = Client(endpoint=endpoint, api_key=c.key, transport="http",
                        run_id=f"probe-{TAG}", timeout_ms=60000)
        client.remember(content=f"[probe-{TAG}] Probe lesson: invoices are billing.",
                        intent="lesson", lesson_scope="global", agent_id="probe",
                        upsert_key=f"probe:{TAG}", wait=True, timeout_ms=60000)
        found = client.recall(query="probe lesson invoices", limit=5, evidence_only=True)
        out.find(f"Old SDK works against {endpoint}: recall returned "
                 f"{len((found or {}).get('evidence') or [])} items.")
    except Exception as err:  # report whatever the SDK raises
        out.find(f"Old SDK failed against {endpoint}: {type(err).__name__}: {mask(str(err), c.key)}")


# ---------------------------------------------------------------- runner

class Out:
    def __init__(self, name):
        self.name = name
        self.findings = []
        self.console_checks = []
        self.calls = []

    def find(self, text):
        self.findings.append(text)
        print(f"  - {text}")

    def console(self, text):
        self.console_checks.append(text)


def write_report(ctx, outs, path_json, path_md):
    data = {"run": RUN, "tag": TAG, "base": ctx.base,
            "models": {"openai": ctx.openai_model, "anthropic": ctx.anthropic_model,
                       "gemini": ctx.gemini_model},
            "probes": [{"name": o.name, "findings": o.findings,
                        "console": o.console_checks, "calls": o.calls} for o in outs]}
    path_json.write_text(mask(json.dumps(data, indent=2, default=str), ctx.key))
    lines = [f"# Mubit probe run {RUN} (tag `{TAG}`)", "",
             f"Base `{ctx.base}` · models {data['models']}", ""]
    for o in outs:
        lines += [f"## {o.name}", ""] + [f"- {f}" for f in o.findings] + [""]
    checks = [(o.name, t) for o in outs for t in o.console_checks]
    if checks:
        lines += ["## Check in the console (app.mubit.ai)", ""]
        lines += [f"- [ ] **{n}**: {t}" for n, t in checks]
        lines += ["- [ ] **always**: is there an **Adapters** page? (no page = training is off for "
                  "your workspace)",
                  "- [ ] **always**: open **Settings** (admins): write down every option, "
                  "especially anything about serving or routing",
                  "- [ ] **always**: on any call, click **Rate this reply: Bad**. Does anything "
                  "change in Tasks (kept-example count)?", ""]
    path_md.write_text(mask("\n".join(lines), ctx.key))


def main():
    load_env()
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", nargs="*", help="probes to run (default: all safe ones)")
    parser.add_argument("--list", action="store_true", help="list probes and exit")
    parser.add_argument("--allow-train", action="store_true",
                        help="run 'train' (40 calls; uses today's training limit)")
    parser.add_argument("--allow-burst", action="store_true", help="run 'burst' (12 parallel calls)")
    parser.add_argument("--allow-old-sdk", action="store_true", help="run 'old_sdk'")
    parser.add_argument("--allow-jev", action="store_true",
                        help="run 'jev' (~160 OpenRouter calls on your OpenRouter key)")
    args = parser.parse_args()

    if args.list:
        for name, p in PROBES.items():
            gate = f" [needs --{p['flag'].replace('_', '-')}]" if p["flag"] else ""
            print(f"{name:17}{p['doc']}{gate}")
        return 0

    unknown = [n for n in args.names if n not in PROBES]
    if unknown:
        parser.error(f"unknown probe(s): {unknown}; see --list")
    key = os.environ.get("MUBIT_API_KEY", "")
    ctx = Ctx(key, os.environ.get("MUBIT_BASE_URL", "https://api.mubit.ai"))
    chosen = args.names or [n for n, p in PROBES.items()
                            if not p["flag"] or getattr(args, p["flag"])]
    for name in chosen:
        flag = PROBES[name]["flag"]
        if flag and not getattr(args, flag):
            parser.error(f"'{name}' needs --{flag.replace('_', '-')}")
    if not key:
        keyless = [n for n in chosen if not PROBES[n]["needs_key"]]
        print("MUBIT_API_KEY is not set (put it in .env next to this script). "
              f"Running only the probes that need no key: {keyless}\n")
        chosen = keyless

    print(f"Run {RUN}, tag {TAG}, base {ctx.base}\n")
    outs = []
    for name in chosen:
        print(f"[{name}] {PROBES[name]['doc']}")
        out = Out(name)
        try:
            PROBES[name]["fn"](ctx, out)
        except Exception as err:  # one broken probe shouldn't stop the run
            out.find(f"PROBE CRASHED: {type(err).__name__}: {mask(str(err), key)}")
        outs.append(out)
        print()

    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    path_json, path_md = results / f"{RUN}.json", results / f"{RUN}.md"
    write_report(ctx, outs, path_json, path_md)
    print(f"Report: {path_md}\nRaw:    {path_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
