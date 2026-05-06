// Three-step upload to Higgsfield's media store, mirroring what the web does:
//
//   1. POST /media/batch          → { id, url, upload_url, content_type }
//   2. PUT  <upload_url>          → presigned S3 PUT, raw bytes (no auth header)
//   3. POST /media/<id>/upload    → confirm; ip-check kicks off asynchronously
//
// Returns { id, url } usable inside a /jobs/v2 medias[].data field.

import fs from 'node:fs';
import path from 'node:path';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
};

export function mimeFromPath(p) {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

export async function uploadFile(page, filePath, { surface = 'seedance_2', forceIpCheck = true } = {}) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error('file not found: ' + abs);
  const mime = mimeFromPath(abs);
  const filename = path.basename(abs);
  const bytes = fs.readFileSync(abs);

  // Run all three steps inside the page so cookies + datadome attach automatically.
  const result = await page.evaluate(async ({ mime, filename, surface, forceIpCheck, b64 }) => {
    const sess = window.Clerk?.session;
    if (!sess) throw new Error('not_signed_in');
    const dd = (document.cookie.match(/datadome=([^;]+)/) || [])[1];

    const authHeaders = async () => ({
      'Authorization': 'Bearer ' + await sess.getToken(),
      'x-datadome-clientid': dd,
    });

    // 1. Reserve a media id + presigned PUT URL
    const r1 = await fetch('https://fnf.higgsfield.ai/media/batch', {
      method: 'POST', credentials: 'include',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mimetypes: [mime],
        source: 'user_upload',
        surface,
        force_ip_check: forceIpCheck,
      }),
    });
    if (r1.status !== 200) {
      return { step: 'batch', status: r1.status, body: await r1.text() };
    }
    const batch = await r1.json();
    const slot = batch[0];

    // 2. Decode base64 in-page and PUT raw bytes to S3
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const r2 = await fetch(slot.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: buf,
    });
    if (r2.status !== 200 && r2.status !== 204) {
      return { step: 's3-put', status: r2.status, body: await r2.text() };
    }

    // 3. Confirm
    const r3 = await fetch(`https://fnf.higgsfield.ai/media/${slot.id}/upload`, {
      method: 'POST', credentials: 'include',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        force_nsfw_check: true,
        force_ip_check: forceIpCheck,
        surface,
      }),
    });
    if (r3.status !== 200) {
      return { step: 'confirm', status: r3.status, body: await r3.text() };
    }
    const confirm = await r3.json();

    return { ok: true, id: slot.id, url: slot.url, content_type: slot.content_type, status: confirm.status };
  }, { mime, filename, surface, forceIpCheck, b64: bytes.toString('base64') });

  if (!result.ok) {
    const err = new Error(`upload failed at step=${result.step} status=${result.status}: ${typeof result.body === 'string' ? result.body : JSON.stringify(result.body)}`);
    err.detail = result;
    throw err;
  }
  return { id: result.id, url: result.url, content_type: result.content_type };
}

// Build a medias[] entry for /jobs/v2 from { id, url } and a role.
// Roles seen in the wild: "start_image", "end_image", "image", "video", "audio", "reference".
export function mediaEntry({ role, id, url, type = 'media_input' }) {
  return { role, data: { id, url, type } };
}
