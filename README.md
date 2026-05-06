# higgs-unlim

CLI wrapper for Higgsfield's web `/jobs/v2` API with `use_unlim:true` support and start / end frame inputs. Solves the gap left by the official `@higgsfield/cli`, which talks to a separate `/agents/*` realm and silently ignores the unlimited-mode toggle.

## Why this exists

Higgsfield runs two parallel APIs:

| | CLI realm | Web realm |
|---|---|---|
| URL | `fnf.higgsfield.ai/agents/*` | `fnf.higgsfield.ai/jobs/*`, `/workspaces/*`, `/media/*` |
| Auth | device-flow token (`fnf-device-auth.higgsfield.ai`) | Clerk session JWT (`clerk.higgsfield.ai`) |
| Credit pool | small "agents" balance | workspace subscription balance |
| `use_unlim:true` | not honored | **honored** |

The web's "Generate Unlimited" button hits `POST /jobs/v2/{job_set_type}` with `{ "use_unlim": true }`. This script replicates that exactly, using a headless Chromium with a persistent profile so Clerk's auto-refresh keeps the JWT alive between runs.

## Install

```bash
git clone <repo-url>
cd higgs-unlim
npm install              # also runs `playwright install chromium`
```

Node 18+. macOS / Linux. (Windows untested but should work.)

## Usage

### One-time login

```bash
node src/index.mjs login
```

Opens a real Chromium window. Sign in via Google / Apple / Microsoft / Email. Cookies persist to `~/.config/higgsfield/playwright-profile/` (override with `HIGGS_PROFILE_DIR`). You only do this once.

### Sanity check

```bash
node src/index.mjs whoami
```

```
user:     design@ahoum.com
plan:     team
flexUnlim: true
hasUnlim: false
workspace: f113ce73-…
wallet:   { credits_balance: 0, subscription_balance: 509087, total_credits: 600000, … }
```

`flexUnlim: true` (or `hasUnlim: true`) is required for `use_unlim` to actually zero the cost.

### Upload a media file

```bash
node src/index.mjs upload ./image.png
```

Returns the media id and CloudFront URL. Useful when you want to reuse the same start/end frame across multiple gens without re-uploading.

### Generate a video

Plain text-to-video, unlimited:

```bash
node src/index.mjs gen seedance1_5 \
  --prompt "the guy saying hi" --duration 8 --res 480p --audio
```

With a start frame (auto-uploads):

```bash
node src/index.mjs gen seedance1_5 \
  --prompt "camera dollies in slowly" --duration 4 --res 720p \
  --start-image ./first.png
```

With both start and end frames (e.g. Kling FLF):

```bash
node src/index.mjs gen kling_omni_flf \
  --prompt "morph A to B" --duration 5 --res 720p \
  --start-image ./first.png --end-image ./last.png
```

Reusing pre-uploaded media (faster on repeated runs):

```bash
node src/index.mjs gen seedance1_5 --prompt "..." --duration 4 \
  --start-image-id 963ede9e-… --start-image-url https://d2ol7oe51mr4n9.cloudfront.net/.../963ede9e-….png
```

Compare cost with and without unlimited:

```bash
node src/index.mjs gen seedance1_5 --prompt "..." --duration 4   # use_unlim=true (default)
node src/index.mjs gen seedance1_5 --prompt "..." --duration 4 --no-unlim
```

The script prints wallet diffs at the end of each run so the cost is visible.

### Generic escape hatches

`--extra k=v` adds a key into `params`:

```bash
node src/index.mjs gen seedance_2_0 --prompt "..." --duration 5 \
  --extra mode=fast --extra genre=auto
```

`--param-extra k=v` adds a key at the **top-level** body (next to `use_unlim`):

```bash
node src/index.mjs gen seedance1_5 --prompt "..." --param-extra some_new_flag=true
```

Booleans (`true`/`false`) and integers/floats are auto-coerced.

## Commands

```
higgs-unlim login                          One-time interactive login
higgs-unlim whoami                         Print user, plan, wallet
higgs-unlim upload <file> [--surface s]    Upload media, print {id,url}
higgs-unlim gen <job_set_type> [opts]      Submit a job and poll to done
```

## How it works

1. **Persistent Chromium profile** — `chromium.launchPersistentContext()` keeps cookies on disk, so the Clerk session survives between runs.
2. **Fresh JWT per call** — `Clerk.session.getToken()` is invoked inside the page just before each API request. Clerk auto-refreshes silently using its `__client` cookie, so we never see a 401 from token expiry.
3. **Datadome bypass** — the `x-datadome-clientid` header is read from `document.cookie` and sent on every request, matching what the web app does.
4. **Same endpoints as the web** — `POST /jobs/v2/{type}`, `GET /jobs/{id}`, `GET /workspaces/wallet`, `POST /media/batch` + presigned S3 PUT + `POST /media/{id}/upload`.

See `src/auth.mjs`, `src/upload.mjs`, `src/jobs.mjs`.

## Job-set types

Everything the web supports: `seedance1_5`, `seedance_2_0`, `veo3`, `veo3_1`, `veo3_1_lite`, `kling_omni_flf`, `kling_omni_image_reference`, `kling_video_reference`, `kling3_0`, `kling3_0_motion_control`, `wan2_5_video`, `wan2_6`, `wan2_7`, `sora2_video`, `cinematic_studio_3_0`, `grok_video`, `dubbing_lipsync`, etc. (Pulled from the `/jobs/accessible` enumeration on the web client.)

Use `gen --no-unlim` to charge credits the normal way. Use `gen` (default) to ride the unlimited entitlement.

## Notes

- `use_unlim:true` is only free if your account/workspace has the entitlement (`has_flex_unlim:true` or `has_unlim:true` on `/user`). Otherwise the server may fall back to charging credits or reject the request.
- The persistent profile contains your auth cookies. Don't commit it; it's gitignored under `profile/`. Default location is outside the repo (`~/.config/higgsfield/playwright-profile/`).
- The web sometimes uses `surface` values like `"seedance_2"` for the upload context; we default to that. Override with `--surface` if needed.

## License

Private repo. No license granted.
