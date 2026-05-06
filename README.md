# higgs-unlim

CLI for [Higgsfield AI](https://higgsfield.ai) video / image generation that **honors your workspace's Unlimited entitlement** and supports **start / end frame inputs and inline `<<<image_N>>>` tagging**.

The official `@higgsfield/cli` talks to a different API surface (`/agents/*`) that ignores `use_unlim:true` and bills against a separate, much smaller credit pool. This script talks to the same `/jobs/v2/*` endpoints the web app uses and rides your real workspace subscription — verified end-to-end on a team plan with `has_flex_unlim:true`.

```text
$ higgs-unlim gen seedance1_5 --prompt "the guy saying hi" --duration 8 --res 480p --audio
wallet before: { sub: 509087, credits: 0 }
submitting:    seedance1_5 use_unlim: true medias: []
job id:        97f9e65d-59bb-4318-8c39-34fc5941b92c
  iter 39 status=completed
video:         https://d8j0ntlcm91z4.cloudfront.net/.../97f9e65d-….mp4
wallet after:  { sub: 509087, credits: 0 }
diff:          { sub: 0, credits: 0 }      ← zero cost on Unlimited
```

---

## Table of contents

1. [Status & verification](#status--verification)
2. [⚠️ The web UI's "Generate" billing trap](#-the-web-uis-generate-billing-trap)
3. [Quickstart](#quickstart)
4. [Why this exists](#why-this-exists)
5. [Commands](#commands)
6. [`gen` options](#gen-options)
7. [Image inputs](#image-inputs)
8. [Per-model schema](#per-model-schema)
9. [Job set types](#job-set-types)
10. [API reference](#api-reference)
11. [How it works](#how-it-works)
12. [Architecture](#architecture)
13. [Troubleshooting](#troubleshooting)
14. [FAQ](#faq)
15. [Limits & disclaimers](#limits--disclaimers)

---

## Status & verification

| Capability                                           | Status      | Evidence (job id)                            |
| ---------------------------------------------------- | ----------- | -------------------------------------------- |
| `seedance1_5` text-to-video, 480p, audio, unlimited  | ✅ verified | `97f9e65d-59bb-4318-8c39-34fc5941b92c`        |
| `seedance1_5` start + end image, 720p, unlimited     | ✅ verified | `5b11f7df-1c10-4af3-8819-3c0d69da1079`        |
| `seedance1_5` `<<<image_1>>>` / `<<<image_2>>>` inline tagging | ✅ verified | `5b11f7df-1c10-4af3-8819-3c0d69da1079` |
| Wallet diff = 0 with `use_unlim:true`                | ✅ verified | wallet 509087 → 509087 (twice in a row)       |
| Wallet diff > 0 with `use_unlim:false` (web default) | ✅ observed | 8,000 credits charged on a single 1080p Seedance 2.0 click |
| `seedance1_5` `medias` cap                           | ✅ verified | server returns `422 too_long` at 3 items     |
| Three-step media upload (`/media/batch` → S3 → confirm) | ✅ verified | media id `963ede9e-a75f-4d5a-9869-da266044f651` |
| `seedance_2_0`                                       | ⚠️ partial  | submission works, multi-image confirmed; full param table not yet documented |
| Kling / Veo / Sora / Wan models                      | ⚠️ unverified | should work — same `/jobs/v2/{type}` shape, but each model has its own param schema |

Workspace tested: `f113ce73-37cd-4be0-98ea-4331b1fd2b49` (Ahoum design team plan), `has_flex_unlim:true`.

---

## ⚠️ The web UI's "Generate" billing trap

**The Generate button on higgsfield.ai/ai/video does NOT default to Unlimited mode.** Look at the button before clicking:

| Button label              | Meaning                                              |
| ------------------------- | ---------------------------------------------------- |
| `Generate ⚡ <number>`    | **Charges credits.** Number = cost of this single job. |
| `Generate ⚡ Unlimited`   | Free under your entitlement.                         |

In our tests, a single Seedance 2.0 1080p click with the toggle off cost **8,000 credits** (~½ day's worth on a small plan). The toggle that flips this is somewhere in the form's secondary controls — find it before you click. **This script always sends `use_unlim:true` by default** so you can't make this mistake from the CLI; pass `--no-unlim` to opt out.

---

## Quickstart

Requires **Node 18+** and a Higgsfield account with the Unlimited entitlement (`has_flex_unlim:true` or `has_unlim:true` on `/user`). Tested on macOS / Linux.

```bash
git clone git@github.com:techy-zai-fi/higgs-unlim.git
cd higgs-unlim
npm install                                 # also runs `playwright install chromium`

node src/index.mjs login                    # opens a real browser, sign in once
node src/index.mjs whoami                   # confirm session + entitlements
```

```bash
# 1. Plain text-to-video
node src/index.mjs gen seedance1_5 \
  --prompt "the guy saying hi" --duration 8 --res 480p --audio

# 2. Start-frame conditioned (auto-uploads the local file)
node src/index.mjs gen seedance1_5 \
  --prompt "slow dolly forward" --duration 4 --res 720p \
  --width 1280 --height 720 \
  --start-image ./first.png

# 3. Start + end frame morph with inline image tagging in the prompt
node src/index.mjs gen seedance1_5 \
  --prompt "monkey meditates in <<<image_1>>> and walks left into <<<image_2>>>" \
  --duration 8 --res 720p --ar 3:4 --width 720 --height 960 --audio \
  --start-image ./scene_a.png --end-image ./scene_b.png

# 4. Pure first-last-frame morph on Kling (no inline tags needed)
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 --res 720p \
  --start-image ./first.png --end-image ./last.png
```

Every run prints the wallet diff at the end, so you always see whether unlimited was honored.

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
| Param validation      | strict schema; unknown fields rejected   | permissive (server-side `pydantic` 422 only when truly invalid) |
| Multi-image / tagging | not exposed                              | full support (`medias[]`, `<<<image_N>>>`, character refs) |
| Upload flow           | hidden in binary                         | `/media/batch` → presigned S3 PUT → `/media/{id}/upload`  |

The web's "Generate Unlimited" button hits `POST /jobs/v2/{job_set_type}` with `{ "use_unlim": true, ... }`. This script replicates that exactly, including auth and bot-protection headers, so you can drive video generation from a terminal at the same cost as the web UI (i.e. zero, on Unlimited plans).

---

## Commands

| Command                          | What it does                                            |
| -------------------------------- | ------------------------------------------------------- |
| `login`                          | Open a real Chromium, sign in, persist cookies on disk. **One-time.** |
| `whoami`                         | Print user, plan, entitlements, wallet snapshot.        |
| `upload <file> [--surface <s>]`  | Three-step upload to Higgsfield's media store. Prints `{id, url}`. |
| `gen <job_set_type> [opts]`      | Submit a job, poll until done, print video URL + wallet diff. |

Run any command with no args for inline usage.

---

## `gen` options

| Flag                              | Default       | Notes                                                 |
| --------------------------------- | ------------- | ----------------------------------------------------- |
| `--prompt "<text>"`               | `"test"`      | Text prompt. Can include `<<<image_N>>>` placeholders and reference UUIDs. |
| `--duration <seconds>`            | `4`           | Integer seconds. Each model has its own valid range.  |
| `--res <480p\|720p\|1080p>`       | `480p`        | Resolution tier. **Seedance 1.5 caps at 720p.**       |
| `--ar <16:9\|9:16\|1:1\|3:4\|4:3\|…>` | `16:9`    | Aspect ratio.                                         |
| `--width <px>`                    | model-default | Pixel width. **Required by Seedance 1.5** (e.g. 720 for 720p 3:4). |
| `--height <px>`                   | model-default | Pixel height. **Required by Seedance 1.5** (e.g. 960 for 720p 3:4). |
| `--audio`                         | off           | `generate_audio:true`. Honored by audio-capable models (Seedance, Veo, Sora). |
| `--fixed-lens`                    | off           | `fixed_lens:true`. Locks camera (Seedance et al.).    |
| `--seed <int>`                    | random        | For reproducible runs.                                |
| `--start-image <path>`            | —             | Local file → auto-uploaded → `medias[].role=start_image`. |
| `--start-image-id <uuid>`         | —             | Pre-uploaded media id (use with `--start-image-url`). |
| `--start-image-url <url>`         | —             | Pre-uploaded media URL.                               |
| `--end-image <path>`              | —             | Local file → auto-uploaded → `medias[].role=end_image`. |
| `--end-image-id <uuid>`           | —             | Pre-uploaded media id (use with `--end-image-url`).   |
| `--end-image-url <url>`           | —             | Pre-uploaded media URL.                               |
| `--no-unlim`                      | off           | Force `use_unlim:false` (charges credits).            |
| `--free-gens`                     | off           | `use_free_gens:true` (consumes free-gen pool first).  |
| `--extra k=v`                     | —             | Push arbitrary key into `params`. Repeatable. Booleans / ints / floats are auto-coerced. |
| `--param-extra k=v`               | —             | Push arbitrary key into the **top-level** body (next to `use_unlim`). Repeatable. |

---

## Image inputs

Higgsfield jobs accept conditioning images via the `medias` array:

```json
"medias": [
  {"role": "start_image", "data": {"id": "<uuid>", "url": "<cdn url>", "type": "media_input"}},
  {"role": "end_image",   "data": {"id": "<uuid>", "url": "<cdn url>", "type": "media_input"}}
]
```

### Local files (auto-upload)

```bash
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 \
  --start-image ./first.png \
  --end-image   ./last.png
```

Internally this runs the same three-step flow as the web UI:

1. `POST /media/batch` → reserve a media id + presigned S3 PUT URL.
2. `PUT  <presigned URL>` → upload raw file bytes directly to S3.
3. `POST /media/{id}/upload` → confirm; the server kicks off async IP / NSFW checks.

### Pre-uploaded media (faster on repeated runs)

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

### Inline image tagging in the prompt: `<<<image_N>>>`

The web UI's `@Image 1` / `@Image 2` mentions translate to `<<<image_N>>>` placeholders in the prompt body, where `N` is the **1-based index of the image in the `medias` array**.

```bash
node src/index.mjs gen seedance1_5 \
  --prompt "monkey is sitting in meditation in <<<image_1>>> and walks left into <<<image_2>>>" \
  --duration 8 --res 720p --ar 3:4 --width 720 --height 960 --audio \
  --start-image ./scene_a.png \
  --end-image   ./scene_b.png
```

| Placeholder       | Resolves to                                       |
| ----------------- | ------------------------------------------------- |
| `<<<image_1>>>`   | first item in `medias[]` (regardless of `role`)  |
| `<<<image_2>>>`   | second item in `medias[]`                         |
| `<<<image_N>>>`   | N-th item                                         |
| `<<<<uuid>>>>`    | a saved character / reference element by UUID. The web inserts these when you `@`-mention a saved character. |

Seedance 1.5 has no `reference_elements` parameter slot, so character UUIDs survive only as text in the prompt. Seedance 2.0 honors them more thoroughly via a server-side resolver.

---

## Per-model schema

Server-enforced caps and required fields, observed via 422 responses.

| Model                                                                    | Max `medias` | Roles                                  | Resolutions       | Required extras    |
| ------------------------------------------------------------------------ | ------------ | -------------------------------------- | ----------------- | ------------------ |
| `seedance1_5`                                                            | **2**        | `start_image`, `end_image`             | `480p`, `720p`    | `width`, `height`  |
| `seedance_2_0`                                                           | 3+           | `start_image`, `end_image`, `image`    | up to `1080p`     | —                  |
| `kling_omni_flf`, `kling_o3_flf`                                         | 2            | `start_image`, `end_image`             | varies            | —                  |
| `kling_omni_image_reference`, `kling_video_reference`, `kling_o3_image_reference` | varies | `image` (ref), sometimes `start_image` | varies            | —                  |
| `veo3`, `veo3_1`, `veo3_1_lite`                                          | 1            | `start_image`                          | model-fixed       | —                  |
| `sora2_video`                                                            | 1–2          | `start_image`, `end_image`             | model-fixed       | —                  |
| `wan2_5_video`, `wan2_6`, `wan2_7`                                       | 1–2          | `start_image`, `end_image`             | varies            | —                  |

If you blow the cap (e.g. send 3 medias to `seedance1_5`), the server returns:
```json
{"detail":[{"type":"too_long","loc":["medias"],"msg":"List should have at most 2 items after validation, not 3"}]}
```

---

## Job set types

Pulled from the web client's `/jobs/accessible` enumeration. Each model has its own quirks; consult the web UI for which params it actually respects.

| Category            | Job set types                                              | start | end  | audio |
| ------------------- | ---------------------------------------------------------- | ----- | ---- | ----- |
| Seedance            | `seedance1_5`, `seedance_2_0`                              | ✓     | ✓    | ✓     |
| Kling first-last    | `kling_omni_flf`, `kling_o3_flf`                           | ✓     | ✓    |       |
| Kling reference     | `kling_omni_image_reference`, `kling_video_reference`, `kling_o3_image_reference` | ✓ | | |
| Kling motion        | `kling2_6_motion_control`, `kling3_0_motion_control`       | ✓     |      |       |
| Kling base          | `kling`, `kling2_6`, `kling3_0`, `kling_transition`        | ✓     | ✓ (transition) |   |
| Wan                 | `wan2_2_video`, `wan2_5_video`, `wan2_6`, `wan2_7`, `wan2_2_animate*` | ✓ | | |
| Veo                 | `veo3`, `veo3_1`, `veo3_1_lite`, `veo3_fast`               | ✓     |      | ✓     |
| Sora                | `sora2_video`, `sora2_video_deflicker`, `sora2_video_upscale` | ✓ |  | ✓     |
| Cinematic           | `cinematic_studio_video`, `cinematic_studio_video_v2`, `cinematic_studio_3_0`, `cinematic_studio_video_3_5` | ✓ | | |
| Other               | `grok_video`, `grok_video_edit`, `dubbing_lipsync`, `voice_change_merge`, `concat_videos`, `viral_transform_video`, `beat_fit`, `outfit_matchcut`, `sticker_matchcut`, `happy_horse_video`, `hf_fnf_video`, `image2video`, `image2video_mix`, `minimax_hailuo` | varies | varies | varies |

(Capability columns are best-effort. If a flag isn't supported the server typically ignores it — check the web UI for ground truth.)

---

## API reference

All requests are sent from inside the persistent browser context, with these headers:

```
Authorization: Bearer <Clerk session JWT>          (5-min lifetime, auto-refreshed by Clerk SDK)
Content-Type: application/json
x-datadome-clientid: <datadome cookie value>       (DataDome bot protection)
Origin: https://higgsfield.ai
```

### `POST /jobs/v2/{job_set_type}`
Submit a job. **The endpoint we care about.**

```jsonc
// Request
{
  "params": {
    "prompt": "the guy saying hi",
    "duration": 8,
    "aspect_ratio": "16:9",
    "resolution": "480p",
    "width": 854,        // required by some models (e.g. seedance1_5)
    "height": 480,
    "generate_audio": true,
    "fixed_lens": false,
    "seed": 12345,
    "medias": [
      {"role": "start_image", "data": {"id": "...", "url": "...", "type": "media_input"}},
      {"role": "end_image",   "data": {"id": "...", "url": "...", "type": "media_input"}}
    ],
    "model": "seedance1_5"
  },
  "use_unlim": true,
  "use_free_gens": false
}

// Response (200)
{
  "id": "<project_id>",
  "job_sets": [{
    "id": "<job_set_id>",
    "type": "seedance1_5",
    "jobs": [{ "id": "<job_id>", "status": "queued", ... }],
    ...
  }],
  "has_more": false
}
```

### `GET /jobs/{job_id}`
Full job details + result. Poll this until `status` is terminal.

```jsonc
// Response (200, completed)
{
  "id": "<job_id>",
  "status": "completed",          // queued | in_progress | completed | failed | error
  "results": {
    "raw":  {"type":"video", "url":"https://d8j…/<file>.mp4", "thumbnail_url":"…"},
    "min":  {"type":"video", "url":"…", "thumbnail_url":"…"}
  },
  ...
}
```

### `GET /jobs/{job_id}/status`
Lightweight poll endpoint (just status field).

### `GET /workspaces/wallet`
Wallet snapshot for the active workspace.

```jsonc
{
  "workspace_id": "f113ce73-…",
  "credits_balance": 0,
  "subscription_balance": 509087,
  "wallet_created_at": "2026-05-04T10:19:16.802669Z",
  "next_credit_allocation_date": "2026-06-03T10:16:13Z",
  "total_credits": 600000
}
```

### `GET /user`
User entitlements. Check `has_flex_unlim` / `has_unlim`.

### Media upload (3 calls)

```text
POST /media/batch
  body: {"mimetypes":["image/png"], "source":"user_upload", "surface":"seedance_2", "force_ip_check":true}
  → [{ "id":"<uuid>", "url":"<cdn url>", "upload_url":"<presigned S3 PUT>", "content_type":"image/png" }]

PUT <upload_url>
  headers: { "Content-Type": "<mime>" }
  body:    raw bytes
  → 200 OK (no body)

POST /media/{id}/upload
  body: {"filename":"foo.png","force_nsfw_check":true,"force_ip_check":true,"surface":"seedance_2"}
  → { "id":"<uuid>", "status":"uploaded", "ip_check_finished":false }
```

---

## How it works

```
~/.config/higgsfield/playwright-profile/   (persistent cookies on disk)
        │
        ▼
launchPersistentContext(headless)
        │
        ▼
page.goto("https://higgsfield.ai/ai/video")   ← Clerk SDK hydrates, sets cookies
        │
        ▼
page.evaluate(async () => {
   const jwt = await window.Clerk.session.getToken();          // auto-refreshed by SDK
   const dd  = document.cookie.match(/datadome=([^;]+)/)[1];   // bot-protection token
   return fetch("https://fnf.higgsfield.ai/jobs/v2/...", {
     method: "POST", credentials: "include",
     headers: { Authorization: "Bearer " + jwt, "x-datadome-clientid": dd, ... },
     body: JSON.stringify({ params, use_unlim: true, use_free_gens: false }),
   });
})
```

By running every API call from inside `page.evaluate()`, we inherit:

1. **All cookies** the web app uses (`__client`, `__session`, `datadome`, etc.).
2. **The Clerk SDK's session machinery** — `getToken()` mints a fresh JWT each time and silently refreshes whenever the cached one is near expiry.
3. **The page's origin context** — `Origin: https://higgsfield.ai` and `Referer:` headers are filled by the browser automatically.

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

The browser context is opened once per command and closed at the end, so commands are stateless. The persistent profile dir on disk carries auth between invocations — it's the only state that matters.

---

## Troubleshooting

**`Not signed in. Run \`higgs-unlim login\` first.`**
The persistent profile at `~/.config/higgsfield/playwright-profile/` doesn't have a Clerk session, or it's expired. Run `node src/index.mjs login` — Chromium opens, you sign in, cookies persist.

**Submit returns HTTP 401**
Either the profile is corrupted (rare) or higgsfield invalidated your session. Delete the profile dir and re-login:
```bash
rm -rf ~/.config/higgsfield/playwright-profile
node src/index.mjs login
```

**Wallet diff is non-zero with `use_unlim:true`**
Your account doesn't have `has_flex_unlim:true` or `has_unlim:true`. Run `whoami` to confirm. The flag flips fine on the request, but the billing layer only honors it for accounts with the entitlement.

**Submit returns HTTP 422 with `pydantic` validation errors**
The model rejected one or more params. Read the `loc` array in the response — it tells you exactly which field is wrong. Most common:
- `"loc":["medias"]` `"too_long"` → exceeded the model's `medias` cap. See [Per-model schema](#per-model-schema).
- `"loc":["width"]` / `"loc":["height"]` `"missing"` → Seedance 1.5 needs explicit `--width` and `--height`.
- `"loc":["resolution"]` → unsupported resolution tier for that model.

**Submit returns HTTP 503 with `{"detail":"blocked-by-test"}`**
That's a self-test artifact, not a real response — it means an old fetch interceptor is still installed in the page. Restart with a fresh `node` invocation.

**Job stuck in `in_progress` for >5 minutes**
Some models (Veo, Sora, Seedance 1.5 Pro 720p+audio) can queue 2–4 minutes before they even start rendering. The default poll cap is 240 iterations × 2.5s = 10 minutes. Increase by editing `pollJob`'s defaults in `src/jobs.mjs`.

**Override the profile location**
```bash
HIGGS_PROFILE_DIR=/path/to/profile node src/index.mjs whoami
```

---

## FAQ

**Q: Can I use this without `has_flex_unlim:true`?**
Yes — pass `--no-unlim`. The script will submit with `use_unlim:false` and credits will be deducted exactly like the web UI. You don't need Unlimited mode to use the rest of the script (start/end frames, inline tagging, etc.).

**Q: Why headless Chromium? Isn't that overkill?**
Clerk session JWTs live 5 minutes. Refreshing them outside the browser means re-implementing Clerk's full client-side state machine (`__client` cookie → `/v1/client/sessions/<id>/touch` → handle device cookies). That's fragile and breaks when Clerk updates. A persistent Chromium profile + `Clerk.session.getToken()` is one line, and it just works.

**Q: Can I run multiple commands in parallel?**
Each command opens its own browser context against the same persistent profile dir. Playwright handles concurrent reads of the profile fine, but if both write to it (e.g. cookie refresh) at the same instant you can hit a lock. For now run sequentially. PRs welcome.

**Q: How do I know if a model supports `--audio` or `--end-image`?**
Easiest: open the web UI, configure the model with those flags, click Generate, and watch the network tab — the request body tells you what fields the model accepts. Or just submit and read the 422 response.

**Q: What happens if I delete the playwright profile?**
You lose your saved login. Re-run `login`. Nothing else is stored locally — the script is stateless except for the cookies.

**Q: Is this against Higgsfield ToS?**
Probably not — you're driving the same web app you're entitled to use, just from a script. But there's no explicit blessing either. Use it on accounts you control. If Higgsfield publishes an official SDK that exposes Unlimited mode, switch to that.

---

## Limits & disclaimers

- **Not a fork or patch** of `@higgsfield/cli`. It uses an entirely different API surface.
- **Not a way to bypass billing.** It rides a workspace's existing Unlimited entitlement. On accounts without it, jobs charge credits exactly as the web UI does.
- **Not stable.** Higgsfield can change endpoint shapes, header requirements, or the Clerk integration at any time. There's no public contract for `/jobs/v2/*`. If something breaks, open the network tab on higgsfield.ai/ai/video, capture the new shape, update the script.
- **Not endorsed** by Higgsfield. If they publish an official SDK that exposes Unlimited mode, switch to that.
- **Not exhaustive.** Only `seedance1_5` and `seedance_2_0` have been verified end-to-end. Other models should work with the same pattern but may need per-model param tweaks.

---

## License

Private repo. No license granted; do not redistribute.
