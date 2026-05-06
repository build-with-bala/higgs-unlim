#!/usr/bin/env node
// higgs-unlim — submit Higgsfield video/image jobs from the CLI with use_unlim:true,
// matching the web app's auth + endpoint exactly. Supports start/end frame inputs.
//
//   higgs-unlim login                                 # one-time interactive login
//   higgs-unlim whoami                                # session/wallet sanity check
//   higgs-unlim upload <file>                         # upload a media file, print id+url
//   higgs-unlim gen <job_set_type> [opts]             # submit a VIDEO job (POST /jobs/v2/{snake_case})
//   higgs-unlim image <job_set_type> [opts]           # submit an IMAGE job (POST /jobs/{kebab-case})
//
// Image example (Nano Banana Pro = job_set_type "nano_banana_2"):
//   higgs-unlim image nano_banana_2 \
//     --prompt "minimalist line art ahoum logo, white background" \
//     --ar 1:1 --res 1k --width 1024 --height 1024 --batch 1
//
// Image-to-image (auto-uploads files into params.input_images):
//   higgs-unlim image nano_banana_2 \
//     --prompt "redraw <<<image_1>>> in cyberpunk style" \
//     --input-image ./ref.png
//
// gen options:
//   --prompt "<text>"                  prompt (default: "test")
//   --duration <seconds>               default 4
//   --res <480p|720p|1080p>            default 480p
//   --ar <16:9|9:16|1:1|...>           default 16:9
//   --width <px>                       default model-dependent
//   --height <px>                      default model-dependent
//   --audio                            generate_audio=true
//   --fixed-lens                       fixed_lens=true
//   --seed <int>                       seed for reproducible runs
//
//   --start-image <path>               local file → upload → role:start_image
//   --start-image-id <uuid> --start-image-url <url>   pre-uploaded media
//   --end-image <path>                 local file → upload → role:end_image
//   --end-image-id <uuid> --end-image-url <url>       pre-uploaded media
//
//   --no-unlim                         use_unlim=false (charges credits)
//   --free-gens                        use_free_gens=true
//   --extra k=v                        push arbitrary param into params (repeatable)
//   --param-extra k=v                  same, but at top-level body (e.g. for new flags)
//
// Examples:
//   higgs-unlim gen seedance1_5 --prompt "the guy saying hi" --duration 8 --res 480p --audio
//   higgs-unlim gen kling_omni_flf --prompt "morph A→B" --duration 5 \
//     --start-image ./first.png --end-image ./last.png

import path from 'node:path';
import { openContext, ensureLoggedIn, PROFILE_DIR } from './auth.mjs';
import { uploadFile, mediaEntry } from './upload.mjs';
import { submitJob, submitImageJob, pollJob, getWallet, getUser } from './jobs.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  const repeatable = new Set(['extra', 'param-extra']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      const val = (next === undefined || next.startsWith('--')) ? true : next;
      if (val !== true) i++;
      if (repeatable.has(k)) {
        out[k] = out[k] ? (Array.isArray(out[k]) ? [...out[k], val] : [out[k], val]) : [val];
      } else {
        out[k] = val;
      }
    } else out._.push(a);
  }
  return out;
}

function coerce(v) {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

async function withCtx(headless, fn) {
  const ctx = await openContext({ headless });
  try {
    const page = await ctx.newPage();
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

async function cmdLogin() {
  console.log('Opening Chromium for interactive login. Sign in via Google/Apple/Microsoft/Email.');
  console.log('Profile dir:', PROFILE_DIR);
  const ctx = await openContext({ headless: false });
  const page = await ctx.newPage();
  await page.goto('https://higgsfield.ai/sign-in');

  console.log('Waiting for Clerk session to be detected. Press Ctrl+C to abort.');
  let signedIn = false;
  for (let i = 0; i < 600; i++) { // up to 5 minutes
    signedIn = await page.evaluate(() => !!window.Clerk?.session).catch(() => false);
    if (signedIn) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!signedIn) {
    console.error('Timed out waiting for sign-in.');
    await ctx.close();
    process.exit(1);
  }
  // Navigate once to /ai/video so all auth state is fully primed
  await page.goto('https://higgsfield.ai/ai/video', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Logged in. Cookies persisted to:', PROFILE_DIR);
  await ctx.close();
}

async function cmdWhoami() {
  await withCtx(true, async page => {
    if (!await ensureLoggedIn(page)) die('Not signed in. Run `higgs-unlim login` first.');
    const user = await getUser(page);
    const wallet = await getWallet(page);
    console.log('user:    ', user?.email);
    console.log('plan:    ', user?.plan_type);
    console.log('flexUnlim:', user?.has_flex_unlim);
    console.log('hasUnlim:', user?.has_unlim);
    console.log('workspace:', user?.workspace_id);
    console.log('wallet:  ', wallet);
  });
}

async function cmdUpload(rest) {
  const args = parseArgs(rest);
  const file = args._[0];
  if (!file) die('usage: higgs-unlim upload <file>');
  await withCtx(true, async page => {
    if (!await ensureLoggedIn(page)) die('Not signed in. Run `higgs-unlim login` first.');
    const surface = args.surface || 'seedance_2';
    const r = await uploadFile(page, file, { surface });
    console.log(JSON.stringify(r, null, 2));
  });
}

async function cmdGen(rest) {
  const args = parseArgs(rest);
  const jobSetType = args._[0];
  if (!jobSetType) die('usage: higgs-unlim gen <job_set_type> [opts]');

  await withCtx(true, async page => {
    if (!await ensureLoggedIn(page)) die('Not signed in. Run `higgs-unlim login` first.');

    // Build params
    const params = {
      prompt: args.prompt || 'test',
      duration: args.duration ? parseInt(args.duration, 10) : 4,
      aspect_ratio: args.ar || '16:9',
      resolution: args.res || '480p',
      medias: [],
      model: jobSetType,
    };
    if (args.audio) params.generate_audio = true;
    if (args['fixed-lens']) params.fixed_lens = true;
    if (args.seed) params.seed = parseInt(args.seed, 10);
    if (args.width) params.width = parseInt(args.width, 10);
    if (args.height) params.height = parseInt(args.height, 10);

    // Resolve start/end frames: either local file (upload) or pre-uploaded id+url
    if (args['start-image']) {
      console.log('uploading start-image…');
      const m = await uploadFile(page, args['start-image'], { surface: 'seedance_2' });
      params.medias.push(mediaEntry({ role: 'start_image', id: m.id, url: m.url }));
    } else if (args['start-image-id'] && args['start-image-url']) {
      params.medias.push(mediaEntry({
        role: 'start_image',
        id: args['start-image-id'],
        url: args['start-image-url'],
      }));
    }
    if (args['end-image']) {
      console.log('uploading end-image…');
      const m = await uploadFile(page, args['end-image'], { surface: 'seedance_2' });
      params.medias.push(mediaEntry({ role: 'end_image', id: m.id, url: m.url }));
    } else if (args['end-image-id'] && args['end-image-url']) {
      params.medias.push(mediaEntry({
        role: 'end_image',
        id: args['end-image-id'],
        url: args['end-image-url'],
      }));
    }

    // --extra k=v repeatable
    if (args.extra) {
      const list = Array.isArray(args.extra) ? args.extra : [args.extra];
      for (const kv of list) {
        const [k, ...rest] = String(kv).split('=');
        params[k] = coerce(rest.join('='));
      }
    }

    const body = {
      params,
      use_unlim: args['no-unlim'] ? false : true,
      use_free_gens: !!args['free-gens'],
    };
    if (args['param-extra']) {
      const list = Array.isArray(args['param-extra']) ? args['param-extra'] : [args['param-extra']];
      for (const kv of list) {
        const [k, ...rest] = String(kv).split('=');
        body[k] = coerce(rest.join('='));
      }
    }

    const w0 = await getWallet(page);
    console.log('wallet before:', { sub: w0.subscription_balance, credits: w0.credits_balance });
    console.log('submitting:', jobSetType, 'use_unlim:', body.use_unlim, 'medias:', params.medias.map(m => m.role));

    const submit = await submitJob(page, jobSetType, body);
    if (submit.status !== 200) {
      console.error('submit failed:', submit.status, JSON.stringify(submit.body, null, 2));
      process.exit(1);
    }
    const jobId = submit.body?.job_sets?.[0]?.jobs?.[0]?.id;
    console.log('job id:', jobId);

    const result = await pollJob(page, jobId, {
      onTick: ({ iter, status }) => {
        process.stdout.write(`\r  iter ${iter} status=${status}${' '.repeat(20)}`);
      },
    });
    process.stdout.write('\n');

    const final = result.body;
    const url = final?.results?.raw?.url || final?.result?.url;
    if (url) console.log('video:', url);
    const thumb = final?.results?.raw?.thumbnail_url;
    if (thumb) console.log('thumb:', thumb);
    if (!url) console.log('final:', JSON.stringify(final, null, 2));

    const w1 = await getWallet(page);
    console.log('wallet after: ', { sub: w1.subscription_balance, credits: w1.credits_balance });
    console.log('diff:         ', {
      sub: w0.subscription_balance - w1.subscription_balance,
      credits: w0.credits_balance - w1.credits_balance,
    });
  });
}

async function cmdImage(rest) {
  const args = parseArgs(rest);
  const jobSetType = args._[0];
  if (!jobSetType) die('usage: higgs-unlim image <job_set_type> [--prompt "..."] [--ar 1:1] [--res 1k|2k|4k] [--width N --height N] [--batch N] [--input-image <path>]... [--seed N] [--no-unlim] [--extra k=v]...');

  await withCtx(true, async page => {
    if (!await ensureLoggedIn(page)) die('Not signed in. Run `higgs-unlim login` first.');

    // Resolve any --input-image local files (auto-upload). Repeatable.
    const inputImageEntries = [];
    const ips = args['input-image'] ? (Array.isArray(args['input-image']) ? args['input-image'] : [args['input-image']]) : [];
    for (const p of ips) {
      console.log('uploading input-image:', p);
      const m = await uploadFile(page, p, { surface: 'nano_banana_2' });
      inputImageEntries.push({ id: m.id, url: m.url, type: 'media_input' });
    }
    // Or pre-uploaded ids/urls (parallel arrays)
    const ids = args['input-image-id'] ? (Array.isArray(args['input-image-id']) ? args['input-image-id'] : [args['input-image-id']]) : [];
    const urls = args['input-image-url'] ? (Array.isArray(args['input-image-url']) ? args['input-image-url'] : [args['input-image-url']]) : [];
    for (let i = 0; i < Math.min(ids.length, urls.length); i++) {
      inputImageEntries.push({ id: ids[i], url: urls[i], type: 'media_input' });
    }

    const useUnlim = !args['no-unlim'];

    const params = {
      prompt: args.prompt || 'test',
      input_images: inputImageEntries,
      width: args.width ? parseInt(args.width, 10) : 1024,
      height: args.height ? parseInt(args.height, 10) : 1024,
      batch_size: args.batch ? parseInt(args.batch, 10) : 1,
      aspect_ratio: args.ar || '1:1',
      is_storyboard: !!args['storyboard'],
      is_zoom_control: !!args['zoom-control'],
      use_unlim: useUnlim,                  // image realm: ALSO inside params
      resolution: (args.res || '1k').toLowerCase(),
    };
    if (args.seed) params.seed = parseInt(args.seed, 10);

    if (args.extra) {
      const list = Array.isArray(args.extra) ? args.extra : [args.extra];
      for (const kv of list) {
        const [k, ...rest] = String(kv).split('=');
        params[k] = coerce(rest.join('='));
      }
    }

    const body = {
      params,
      use_unlim: useUnlim,                  // and at top level
      use_seedream_bonus: !!args['seedream-bonus'],
    };
    if (args['param-extra']) {
      const list = Array.isArray(args['param-extra']) ? args['param-extra'] : [args['param-extra']];
      for (const kv of list) {
        const [k, ...rest] = String(kv).split('=');
        body[k] = coerce(rest.join('='));
      }
    }

    const w0 = await getWallet(page);
    console.log('wallet before:', { sub: w0.subscription_balance, credits: w0.credits_balance });
    console.log('submitting:', jobSetType, '(image)', 'use_unlim:', useUnlim, 'inputs:', inputImageEntries.length);

    const submit = await submitImageJob(page, jobSetType, body);
    if (submit.status !== 200) {
      console.error('submit failed:', submit.status, typeof submit.body === 'string' ? submit.body.slice(0, 300) : JSON.stringify(submit.body, null, 2));
      process.exit(1);
    }
    const jobId = submit.body?.job_sets?.[0]?.jobs?.[0]?.id;
    console.log('job id:', jobId);

    const result = await pollJob(page, jobId, {
      intervalMs: 2000,
      onTick: ({ iter, status }) => {
        process.stdout.write(`\r  iter ${iter} status=${status}${' '.repeat(20)}`);
      },
    });
    process.stdout.write('\n');

    const final = result.body;
    const imgUrl = final?.results?.raw?.url || final?.result?.url;
    if (imgUrl) console.log('image:', imgUrl);
    const thumb = final?.results?.raw?.thumbnail_url;
    if (thumb) console.log('thumb:', thumb);
    if (!imgUrl) console.log('final:', JSON.stringify(final, null, 2));

    const w1 = await getWallet(page);
    console.log('wallet after: ', { sub: w1.subscription_balance, credits: w1.credits_balance });
    console.log('diff:         ', {
      sub: w0.subscription_balance - w1.subscription_balance,
      credits: w0.credits_balance - w1.credits_balance,
    });
  });
}

function die(msg) {
  console.error(msg);
  process.exit(2);
}

const [cmd, ...rest] = process.argv.slice(2);
const map = { login: cmdLogin, whoami: cmdWhoami, upload: cmdUpload, gen: cmdGen, image: cmdImage };
const fn = map[cmd];
if (!fn) {
  console.error('commands: login | whoami | upload <file> | gen <job_set_type> [opts] | image <job_set_type> [opts]');
  process.exit(2);
}
fn(rest).catch(e => { console.error(e?.stack || e); process.exit(1); });
