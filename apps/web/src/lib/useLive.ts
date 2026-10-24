'use client';

import { useEffect, useReducer } from 'react';
import type { LiveState, Metrics, ModeratedMessage, Rule, StreamEvent, SwarmState } from '@quell/shared';
import { api, apiBase } from './api';

const KEEP = 400;

export interface Live {
  connected: boolean;
  ready: boolean;
  order: string[];
  byId: Record<string, ModeratedMessage>;
  rules: Rule[];
  metrics: Metrics | null;
  swarm: SwarmState | null;
  task: LiveState['task'] | null;
  evaluation: LiveState['evaluation'];
  lastReplay: { ruleId: string; sent: number; at: number } | null;
}

type Action =
  | { type: 'init'; state: LiveState }
  | { type: 'connected'; value: boolean }
  | StreamEvent;

const initial: Live = {
  connected: false,
  ready: false,
  order: [],
  byId: {},
  rules: [],
  metrics: null,
  swarm: null,
  task: null,
  evaluation: null,
  lastReplay: null,
};

function reduce(s: Live, a: Action): Live {
  switch (a.type) {
    case 'init': {
      const byId: Record<string, ModeratedMessage> = {};
      for (const m of a.state.messages) byId[m.id] = m;
      return {
        ...s,
        ready: true,
        byId,
        order: a.state.messages.map((m) => m.id),
        rules: a.state.rules,
        metrics: a.state.metrics,
        swarm: a.state.swarm,
        task: a.state.task,
        evaluation: a.state.evaluation,
      };
    }
    case 'eval':
      return { ...s, evaluation: a.data };
    case 'reset':
      // The fresh snapshot arrives as an 'init' right after.
      return { ...s, order: [], byId: {}, rules: [], lastReplay: null };
    case 'connected':
      return { ...s, connected: a.value };
    case 'message': {
      const exists = a.data.id in s.byId;
      let order = exists ? s.order : [...s.order, a.data.id];
      const byId = { ...s.byId, [a.data.id]: a.data };
      if (order.length > KEEP) {
        const dropped = order.slice(0, order.length - KEEP);
        order = order.slice(-KEEP);
        for (const id of dropped) delete byId[id];
      }
      return { ...s, order, byId };
    }
    case 'rule': {
      const i = s.rules.findIndex((r) => r.id === a.data.id);
      const rules = i >= 0 ? s.rules.map((r) => (r.id === a.data.id ? a.data : r)) : [...s.rules, a.data];
      return { ...s, rules };
    }
    case 'rule-removed':
      return { ...s, rules: s.rules.filter((r) => r.id !== a.data.id) };
    case 'metrics':
      return { ...s, metrics: a.data };
    case 'swarm':
      return { ...s, swarm: a.data };
    case 'replay':
      return { ...s, lastReplay: { ...a.data, at: Date.now() } };
  }
}

/** Initial snapshot from /state, then live updates over server-sent events. */
export function useLive(): Live {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    const connect = () => {
      api
        .state()
        .then((s) => !cancelled && dispatch({ type: 'init', state: s }))
        .catch(() => undefined);
      source = new EventSource(`${apiBase()}/stream`);
      source.onopen = () => dispatch({ type: 'connected', value: true });
      source.onerror = () => dispatch({ type: 'connected', value: false });
      for (const type of ['message', 'rule', 'rule-removed', 'metrics', 'swarm', 'replay', 'eval', 'reset'] as const) {
        source.addEventListener(type, (e) => {
          dispatch({ type, data: JSON.parse((e as MessageEvent).data) } as StreamEvent);
          if (type === 'reset') {
            api
              .state()
              .then((s) => !cancelled && dispatch({ type: 'init', state: s }))
              .catch(() => undefined);
          }
        });
      }
    };

    connect();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  return state;
}
