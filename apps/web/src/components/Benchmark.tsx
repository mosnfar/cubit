'use client';

import clsx from 'clsx';
import { FlaskConical, Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import type { EvalResult, EvalRun } from '@quell/shared';
import { api } from '@/lib/api';
import { Button } from './primitives';

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const secs = (x: number | null) => (x === null ? '—' : `${(x / 1000).toFixed(2)}s`);
const usd = (x: number | null) => (x === null ? '—' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

/**
 * The before/after evidence: the same held-out messages scored for GPT without
 * and with the moderators' corrections, and for an untrained open model.
 */
export function Benchmark({ run }: { run: EvalRun | null }) {
  const [error, setError] = useState<string | null>(null);
  const busy = run?.status === 'preparing' || run?.status === 'running';
  const best = run ? Math.max(...run.results.map((r) => r.agreement ?? 0)) : 0;

  const start = async () => {
    setError(null);
    try {
      await api.evaluate();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mt-2 rounded-tw-lg bg-raised p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="label flex items-center gap-1.5">
            <FlaskConical className="size-3.5" /> Benchmark
          </div>
          <p className="mt-1 text-[12px] text-dim">
            {run?.size ? `${run.size} held-out messages, never used for training` : 'Held-out messages, never used for training'}
          </p>
        </div>
        <Button variant="primary" onClick={start} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {busy ? (run?.status === 'preparing' ? 'Preparing' : 'Running') : run ? 'Run again' : 'Run benchmark'}
        </Button>
      </div>

      {error && <p className="mt-2 text-[12px] text-remove">{error}</p>}
      {run?.status === 'error' && <p className="mt-2 text-[12px] text-remove">Last run failed: {run.error ?? 'unknown error'}</p>}

      {run && run.results.length > 0 && (
        <table className="mt-3 w-full table-fixed text-[12px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold text-dim">
              <th className="w-[38%] pb-1.5 font-semibold">Setup</th>
              <th className="pb-1.5 text-right font-semibold">Agrees</th>
              <th className="pb-1.5 text-right font-semibold">Scams</th>
              <th className="pb-1.5 text-right font-semibold">p50</th>
              <th className="pb-1.5 text-right font-semibold">/1k msgs</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((r) => (
              <Row key={r.id} r={r} best={r.agreement !== null && r.agreement === best} />
            ))}
            <tr className="border-t border-line text-faint">
              <td className="py-2 pr-2">
                <div className="font-semibold text-purple-soft">Your Mubit adapter</div>
                <div className="text-[11px]">Qwen3 trained on your corrections</div>
              </td>
              <td colSpan={4} className="py-2 text-right text-[11px] leading-snug">
                Serves live chat automatically once it passes Mubit&apos;s tests
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ r, best }: { r: EvalResult; best: boolean }) {
  const progress = r.total ? r.done / r.total : 0;
  const running = r.total > 0 && r.done < r.total;
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-2">
        <div className="truncate font-semibold text-fg">{r.label}</div>
        <div className="truncate text-[11px] text-faint">
          {r.model}
          {r.rules ? ` · ${r.rules} rules` : ''}
        </div>
        {running && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-purple transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </td>
      <td className={clsx('tnum py-2 text-right text-[14px] font-bold', best ? 'text-allow' : 'text-fg')}>
        {pct(r.agreement)}
      </td>
      <td className={clsx('tnum py-2 text-right', r.scamsCaught < r.scamsTotal ? 'text-remove' : 'text-fg')}>
        {r.scamsTotal ? `${r.scamsCaught}/${r.scamsTotal}` : '—'}
      </td>
      <td className="tnum py-2 text-right text-fg">{secs(r.latencyP50)}</td>
      <td className="tnum py-2 text-right text-fg" title={r.costPer1k === null ? 'Set GPT_PRICE_IN / GPT_PRICE_OUT to price GPT' : undefined}>
        {usd(r.costPer1k)}
      </td>
    </tr>
  );
}
