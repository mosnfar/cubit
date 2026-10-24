'use client';

import { ArrowUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Phone page for the room: judges post into #general and watch the moderator react. */
export default function Join() {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState(0);

  useEffect(() => {
    setName(localStorageGet('quell-name') ?? '');
  }, []);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.ingest(name || 'guest', text);
      localStorageSet('quell-name', name);
      setSent((n) => n + 1);
      setText('');
      setStatus({ ok: true, text: 'Posted to #general. Watch the screen.' });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 pb-8 pt-8">
      <div className="flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-full bg-live p-[3px]">
          <div className="grid size-full place-items-center rounded-full bg-[#1d1442] text-[20px]">🚢</div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold">Shipyard</span>
            <span className="rounded-[3px] bg-live px-1 text-[10px] font-bold uppercase leading-4 text-white">Live</span>
          </div>
          <p className="text-[13px] text-dim">Office hours: shipping v1.0 live 🚢</p>
        </div>
      </div>

      <h1 className="mt-8 text-[24px] font-bold tracking-[-0.02em]">Say something in chat</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-dim">
        Quell moderates every message live. Try a joke, a question, or something a scammer would say.
      </p>

      <label className="label mt-8">Display name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={24}
        placeholder="guest"
        className="mt-2 h-11 rounded-tw bg-raised px-3 text-[15px] outline-none ring-1 ring-transparent transition focus:bg-bg focus:ring-2 focus:ring-purple"
      />

      <label className="label mt-5">Message</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        rows={3}
        placeholder="Send a message"
        className="mt-2 min-h-[88px] resize-none rounded-tw bg-raised px-3 py-2.5 text-[15px] leading-relaxed outline-none ring-1 ring-transparent transition placeholder:text-faint focus:bg-bg focus:ring-2 focus:ring-purple"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-tw bg-purple px-4 text-[14px] font-semibold text-white transition-colors hover:bg-purple-hover disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          Chat
        </button>
      </div>

      {status && (
        <p className={`mt-3 text-[13px] ${status.ok ? 'text-allow' : 'text-remove'}`}>{status.text}</p>
      )}
      {sent > 0 && <p className="tnum mt-auto pt-10 text-center text-[12px] text-faint">{sent} sent</p>}
    </div>
  );
}

function localStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the name just isn't remembered.
  }
}
