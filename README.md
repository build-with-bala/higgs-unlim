# higgs-unlim

CLI for [Higgsfield AI](https://higgsfield.ai)'s video / image generation that **honors the workspace's Unlimited entitlement** and supports **start / end frame inputs** (Kling FLF, Seedance image-to-video, etc.).

The official `@higgsfield/cli` talks to a different API surface (`/agents/*`) that ignores `use_unlim:true` and bills against a separate, smaller credit pool. This script talks to the same `/jobs/v2/*` endpoints the web app uses and rides your real workspace subscription — verified in production on a team plan with `has_flex_unlim:true`.

```
$ higgs-unlim gen seedance1_5 --prompt "the guy saying hi" --duration 8 --res 480p --audio
wallet before: { sub: 509087, credits: 0 }
submitting: seedance1_5 use_unlim: true medias: []
job id: 97f9e65d-59bb-4318-8c39-34fc5941b92c
  iter 39 status=completed
video: https://d8j0ntlcm91z4.cloudfront.net/.../97f9e65d-….mp4
wallet after:  { sub: 509087, credits: 0 }
diff:          { sub: 0, credits: 0 }
```

---

## Table of contents

- [Quickstart](#quickstart)
- [Why this exists](#why-this-exists)
- [Commands](#commands)
- [Generate options](#generate-options)
- [Start / end frame inputs](#start--end-frame-inputs)
- [Job set types](#job-set-types)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [What this is not](#what-this-is-not)
- [License](#license)

---

## Quickstart

Requires **Node 18+** and a Higgsfield account with the Unlimited entitlement (`has_flex_unlim:true` or `has_unlim:true` on `/user`). Tested on macOS / Linux.

```bash
git clone git@github.com:techy-zai-fi/higgs-unlim.git
cd higgs-unlim
npm install                                 # also runs `playwright install chromium`

node src/index.mjs login                    # opens a real browser, log in once
node src/index.mjs whoami                   # confirm session

# Plain text-to-video, free under your unlimited plan
node src/index.mjs gen seedance1_5 \
  --prompt "the guy saying hi" --duration 8 --res 480p --audio

# First-frame conditioned (auto-uploads the file)
node src/index.mjs gen seedance1_5 \
  --prompt "slow dolly forward" --duration 4 --res 720p \
  --start-image ./first.png

# First-and-last-frame morph (Kling FLF)
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 --res 720p \
  --start-image ./first.png --end-image ./last.png
```

The script prints the wallet diff at the end of every run so you can confirm zero-cost.

---

## Why this exists

Higgsfield runs **two parallel APIs** under the same `fnf.higgsfield.ai` host:

|                       | CLI realm                                | Web realm                                                 |
| --------------------- | ---------------------------------------- | --------------------------------------------------------- |
| URL prefix            | `/agents/*`                              | `/jobs/v2/*`, `/workspaces/*`, `/media/*`                 |
| Used by               | `@higgsfield/cli` Go binary              | higgsfield.ai web app                                     |
| Auth issuer           | `fnf-device-auth.higgsfield.ai` (device-flow, long-lived) | `clerk.higgsfield.ai` (session JWT, ~5 min, auto-refreshed) |
| Credit pool           | small "agents" balance                   | workspace `subscription_balance` (your real sub)          |
| `use_unlim:true`      | ignored                                  | **honored**                                               |
| Param validation      | strict schema; unknown fields rejected   | permissive                                                |
| Param fields exposed  | `prompt`, `aspect_ratio`, `duration`, `resolution`, `medias` | also `use_unlim`, `use_free_gens`, `generate_audio`, `fixed_lens`, `seed`, `width`, `height`, `mode`, `genre`, `start_image`, `end_image`, … |

The web's "Generate Unlimited" button hits `POST /jobs/v2/{job_set_type}` with `{ "use_unlim": true, ... }`. This script replicates that exactly, including auth and bot-protection headers, so you can drive video generation from a terminal at the same cost as the web UI (i.e. zero, on Unlimited plans).

---

## Commands

| Command                          | What it does                                            |
| -------------------------------- | ------------------------------------------------------- |
| `login`                          | Open a real Chromium, sign in, persist cookies on disk. One-time. |
| `whoami`                         | Print user, plan, entitlements, wallet.                 |
| `upload <file> [--surface <s>]`  | Three-step upload to Higgsfield's media store. Prints `{id, url}`. |
| `gen <job_set_type> [opts]`      | Submit a job, poll until done, print video URL + wallet diff. |

Run any command with no args for the inline usage.

---

## Generate options

| Flag                              | Default       | Notes                                                 |
| --------------------------------- | ------------- | ----------------------------------------------------- |
| `--prompt "<text>"`               | `"test"`      | Text prompt.                                          |
| `--duration <seconds>`            | `4`           | Integer seconds.                                      |
| `--res <480p\|720p\|1080p>`       | `480p`        | Resolution tier.                                      |
| `--ar <16:9\|9:16\|1:1\|…>`       | `16:9`        | Aspect ratio.                                         |
| `--width <px>`                    | model-default | Pixel width override.                                 |
| `--height <px>`                   | model-default | Pixel height override.                                |
| `--audio`                         | off           | `generate_audio:true`. Only honored by audio-capable models. |
| `--fixed-lens`                    | off           | `fixed_lens:true`. Locks camera (Seedance et al.).    |
| `--seed <int>`                    | random        | For reproducible runs.                                |
| `--start-image <path>`            | —             | Local file. Auto-uploaded → `medias[].role=start_image`. |
| `--start-image-id <uuid>`         | —             | Pre-uploaded media id (use with `--start-image-url`). |
| `--start-image-url <url>`         | —             | Pre-uploaded media URL.                               |
| `--end-image <path>`              | —             | Local file. Auto-uploaded → `medias[].role=end_image`.   |
| `--end-image-id <uuid>`           | —             | Pre-uploaded media id (use with `--end-image-url`).   |
| `--end-image-url <url>`           | —             | Pre-uploaded media URL.                               |
| `--no-unlim`                      | off           | Force `use_unlim:false` (charges credits).            |
| `--free-gens`                     | off           | `use_free_gens:true` (consumes free-gen pool first).  |
| `--extra k=v`                     | —             | Push arbitrary key into `params`. Repeatable. Booleans / ints / floats are auto-coerced. |
| `--param-extra k=v`               | —             | Push arbitrary key into the **top-level** body (next to `use_unlim`). Repeatable. |

---

## Start / end frame inputs

Higgsfield jobs accept conditioning images via the `medias` array:

```json
"medias": [
  {"role": "start_image", "data": {"id": "<uuid>", "url": "<cdn url>", "type": "media_input"}},
  {"role": "end_image",   "data": {"id": "<uuid>", "url": "<cdn url>", "type": "media_input"}}
]
```

Two ways to populate it:

### A. Local files (auto-upload)

```bash
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 \
  --start-image ./first.png \
  --end-image   ./last.png
```

`upload.mjs` runs the same three-step flow as the web UI:

1. `POST /media/batch`  → reserve a media id + presigned S3 PUT URL
2. `PUT  <presigned URL>` → upload raw file bytes to S3 directly
3. `POST /media/{id}/upload` → confirm; the server kicks off async IP / NSFW checks

### B. Pre-uploaded media (faster on repeated runs)

```bash
# Upload once
node src/index.mjs upload ./first.png
# {
#   "id": "963ede9e-…",
#   "url": "https://d2ol7oe51mr4n9.cloudfront.net/user_…/963ede9e-….png",
#   "content_type": "image/png"
# }

# Reuse across many gens
node src/index.mjs gen seedance1_5 \
  --prompt "..." --duration 4 \
  --start-image-id  963ede9e-… \
  --start-image-url https://d2ol7oe51mr4n9.cloudfront.net/user_…/963ede9e-….png
```

Not every model accepts both `start_image` and `end_image`; check the table below.

---

## Job set types

Pulled from the web client's `/jobs/accessible` enumeration. Each model has its own quirks; consult the web UI for which params it actually respects.

| Category            | Job set types                                              | start | end  | audio |
| ------------------- | ---------------------------------------------------------- | ----- | ---- | ----- |
| Seedance            | `seedance1_5`, `seedance_2_0`                              | ✓     |      | ✓     |
| Kling first-last    | `kling_omni_flf`, `kling_o3_flf`                           | ✓     | ✓    |       |
| Kling reference     | `kling_omni_image_reference`, `kling_video_reference`, `kling_o3_image_reference` | ✓ |  | |
| Kling motion        | `kling2_6_motion_control`, `kling3_0_motion_control`       | ✓     |      |       |
| Kling base          | `kling`, `kling2_6`, `kling3_0`, `kling_transition`        | ✓     | ✓ (transition) |   |
| Wan                 | `wan2_2_video`, `wan2_5_video`, `wan2_6`, `wan2_7`, `wan2_2_animate*` | ✓ |  | |
| Veo                 | `veo3`, `veo3_1`, `veo3_1_lite`, `veo3_fast`               | ✓     |      | ✓     |
| Sora                | `sora2_video`, `sora2_video_deflicker`, `sora2_video_upscale` | ✓ |  | ✓     |
| Cinematic           | `cinematic_studio_video`, `cinematic_studio_video_v2`, `cinematic_studio_3_0`, `cinematic_studio_video_3_5` | ✓ | | |
| Other               | `grok_video`, `grok_video_edit`, `dubbing_lipsync`, `voice_change_merge`, `concat_videos`, `viral_transform_video`, `beat_fit`, `outfit_matchcut`, `sticker_matchcut`, `happy_horse_video`, `hf_fnf_video`, `image2video`, `image2video_mix`, `minimax_hailuo` | varies | varies | varies |

(Capability columns are best-effort. If a flag isn't supported the server typically ignores it — check the web UI for ground truth.)

---

## How it works

```
~/.config/higgsfield/playwright-profile/   (persistent cookies)
        │
        ▼
launchPersistentContext(headless)
        │
        ▼
page.goto("https://higgsfield.ai/ai/video")   ← Clerk hydrates, sets cookies
        │
        ▼
page.evaluate(async () => {
   const jwt = await window.Clerk.session.getToken();          // auto-refreshed
   const dd  = document.cookie.match(/datadome=([^;]+)/)[1];   // bot protection
   return fetch("https://fnf.higgsfield.ai/jobs/v2/...", {
     method: "POST", credentials: "include",
     headers: { Authorization: "Bearer " + jwt, "x-datadome-clientid": dd, ... },
     body: JSON.stringify({ params, use_unlim: true, use_free_gens: false }),
   });
})
```

The trick: by running every API call from inside `page.evaluate()`, we inherit:

1. **All cookies** the web app uses (`__client`, `__session`, `datadome`, etc.)
2. **The Clerk SDK's session machinery** — calling `getToken()` mints a fresh JWT each time and silently refreshes whenever the cached one is near expiry
3. **The page's origin context** — `Origin: https://higgsfield.ai` and `Referer:` headers are filled by the browser automatically

Outside a browser context, the Clerk JWT lifetime (5 minutes) makes a pure-curl wrapper impractical without re-implementing Clerk's session refresh dance. Headless Chromium with a persistent profile sidesteps that entirely.

---

## Architecture

```
src/
├── auth.mjs        Persistent Chromium context, ensureLoggedIn(), apiFetch()
├── upload.mjs      Three-step media upload, mediaEntry() helper
├── jobs.mjs        submitJob(), pollJob(), getWallet(), getUser()
└── index.mjs       CLI: arg parsing, login / whoami / upload / gen
```

| File          | Responsibility                                                                         |
| ------------- | -------------------------------------------------------------------------------------- |
| `auth.mjs`    | Owns the browser context. `apiFetch(page, {method, path, body})` is the only API call surface; everything else uses it. |
| `upload.mjs`  | `uploadFile(page, path)` returns `{id, url}`. `mediaEntry({role, id, url})` shapes it for `medias[]`. |
| `jobs.mjs`    | Thin wrappers around `apiFetch`. `pollJob` waits for terminal status (`completed`, `failed`, etc.). |
| `index.mjs`   | CLI plumbing only. Parses flags, calls into the modules, prints results.               |

---

## Troubleshooting

**`Not signed in. Run \`higgs-unlim login\` first.`**  
The persistent profile at `~/.config/higgsfield/playwright-profile/` doesn't have a Clerk session, or it's expired. Run `node src/index.mjs login` — Chromium opens, you sign in, cookies persist.

**Submit returns HTTP 401**  
Either the profile is corrupted (rare) or higgsfield invalidated your session (rare). Delete the profile dir and re-login:
```bash
rm -rf ~/.config/higgsfield/playwright-profile
node src/index.mjs login
```

**Wallet diff is non-zero with `use_unlim:true`**  
Your account doesn't have `has_flex_unlim:true` or `has_unlim:true`. Run `whoami` to confirm. The flag flips fine on the request, but the billing layer only honors it for accounts with the entitlement.

**Submit returns HTTP 422 / 400**  
The model rejected one of the params. Most common causes:

- Passing `--end-image` to a model that doesn't support end-frame conditioning
- Wrong resolution / aspect-ratio for that model
- Combining `--audio` with a video-only model

Check the response body printed on stderr. Compare to what the web UI would send for the same model.

**Submit returns HTTP 503 with `{"detail":"blocked-by-test"}`**  
That's a self-test artifact, not a real response — it means an old fetch interceptor is still installed in the page. Restart with a fresh `node` invocation.

**Job stuck in `in_progress` for >5 minutes**  
Some models (Veo, Sora) can queue for a while. The default poll cap is 240 iterations × 2.5s = 10 minutes. Increase by editing `pollJob`'s defaults in `src/jobs.mjs`.

**Override the profile location**  
```bash
HIGGS_PROFILE_DIR=/path/to/profile node src/index.mjs whoami
```

---

## What this is not

- **Not a fork or patch** of the official `@higgsfield/cli`. It uses an entirely different API.
- **Not a way to bypass billing.** It rides a workspace's existing Unlimited entitlement. On accounts without it, jobs charge credits exactly as the web UI does.
- **Not stable.** Higgsfield can change endpoint shapes, header requirements, or the Clerk integration at any time. There's no public contract for `/jobs/v2/*`.
- **Not endorsed** by Higgsfield. If they publish an official SDK that exposes Unlimited mode, switch to that.

---

## License

Private repo. No license granted; do not redistribute.
