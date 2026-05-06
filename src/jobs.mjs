// Submit a job and poll until done.

import { apiFetch } from './auth.mjs';

const TERMINAL = new Set(['completed', 'finished', 'failed', 'error', 'success', 'done', 'cancelled']);

export async function submitJob(page, jobSetType, body) {
  const r = await apiFetch(page, { method: 'POST', path: `/jobs/v2/${jobSetType}`, body });
  return r;
}

export async function pollJob(page, jobId, { intervalMs = 2500, maxIters = 240, onTick } = {}) {
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
