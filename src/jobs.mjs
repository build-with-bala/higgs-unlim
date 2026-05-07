// Submit a job and poll until done.

import { apiFetch } from './auth.mjs';

const TERMINAL = new Set(['completed', 'finished', 'failed', 'error', 'success', 'done', 'cancelled']);

// Convert a snake_case job_set_type (e.g. "nano_banana_2") to its kebab-case URL
// slug used by the image realm (e.g. "nano-banana-2"). Numbers stay as digits;
// underscores become hyphens.
export function toKebabSlug(s) {
  return String(s).replace(/_/g, '-');
}

// Video realm: POST /jobs/v2/{snake_case}
export async function submitJob(page, jobSetType, body) {
  const r = await apiFetch(page, { method: 'POST', path: `/jobs/v2/${jobSetType}`, body });
  return r;
}

// Image realm: POST /jobs/{kebab-case}
// Different endpoint, different body conventions:
//   - resolution is lowercase (e.g. "1k", not "1K")
//   - use_unlim:true must appear at BOTH top-level AND inside params
//   - use_seedream_bonus instead of use_free_gens
//   - no `model` field inside params
export async function submitImageJob(page, jobSetType, body) {
  const slug = toKebabSlug(jobSetType);
  const r = await apiFetch(page, { method: 'POST', path: `/jobs/${slug}`, body });
  return r;
}

// pollJob — poll /jobs/{id} until terminal status.
//
//   initialDelayMs : sleep BEFORE the first poll. Useful for slow models
//                    where polling at second 0 just burns API requests.
//                    e.g. Seedance video typically needs ≥60-90s before
//                    anything is ready.
//   intervalMs     : sleep between subsequent polls.
//   maxIters       : max polls AFTER the initial delay.
//   onTick         : called with { iter, ...job } after each poll.
//
// onTick still receives a `waiting` event at iter -1 if there is an initial
// delay, so the UI can show a meaningful state during the first wait.
export async function pollJob(page, jobId, {
  initialDelayMs = 0,
  intervalMs = 2500,
  maxIters = 240,
  onTick,
} = {}) {
  if (initialDelayMs > 0) {
    if (onTick) onTick({ iter: -1, status: `waiting (first poll in ${Math.round(initialDelayMs/1000)}s)` });
    await new Promise(res => setTimeout(res, initialDelayMs));
  }
  let last = null;
  for (let i = 0; i < maxIters; i++) {
    const r = await apiFetch(page, { method: 'GET', path: `/jobs/${jobId}` });
    last = r.body;
    if (onTick) onTick({ iter: i, ...last });
    const s = String(last?.status || '').toLowerCase();
    if (TERMINAL.has(s)) return { iters: i, terminal: s, body: last };
    await new Promise(res => setTimeout(res, intervalMs));
  }
  return { timeout: true, body: last };
}

export async function getWallet(page) {
  const r = await apiFetch(page, { method: 'GET', path: '/workspaces/wallet' });
  return r.body;
}

export async function getUser(page) {
  const r = await apiFetch(page, { method: 'GET', path: '/user' });
  return r.body;
}
