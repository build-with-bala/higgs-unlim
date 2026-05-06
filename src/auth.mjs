// Browser-context auth helper. Opens a persistent Chromium with cookies on disk,
// asks Clerk's SDK for a fresh JWT, reads the datadome cookie, and runs API
// calls from inside the page so they ride the same fetch wrapper as higgsfield.ai.

import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const PROFILE_DIR = process.env.HIGGS_PROFILE_DIR
  || path.join(os.homedir(), '.config', 'higgsfield', 'playwright-profile');

export const API = 'https://fnf.higgsfield.ai';

export async function openContext({ headless = true } = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  return await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 800 },
  });
}

export async function ensureLoggedIn(page) {
  await page.goto('https://higgsfield.ai/ai/video', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => !!window.Clerk?.session);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// JSON fetch via the page's fetch — uses Clerk session cookies + auto-refreshes JWT.
export async function apiFetch(page, { method = 'GET', path: p, body } = {}) {
  return await page.evaluate(async ({ method, p, body }) => {
    const sess = window.Clerk?.session;
    if (!sess) return { status: 0, body: { error: 'not_signed_in' } };
    const jwt = await sess.getToken();
    const dd = (document.cookie.match(/datadome=([^;]+)/) || [])[1];
    const headers = {
      'Authorization': 'Bearer ' + jwt,
      'x-datadome-clientid': dd,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch('https://fnf.higgsfield.ai' + p, {
      method, credentials: 'include', headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    let parsed; try { parsed = JSON.parse(txt); } catch { parsed = txt; }
    return { status: r.status, body: parsed };
  }, { method, p, body });
}
