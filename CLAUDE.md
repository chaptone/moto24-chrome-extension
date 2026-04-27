# CLAUDE.md — moto24-chrome-extension

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## ⚠️ THIS REPO IS PUBLIC ON GITHUB (STRICT)

**Public URL: https://github.com/chaptone/moto24-chrome-extension**

Everything pushed here is visible to the world. Treat every commit accordingly.

### NEVER commit

- API keys, tokens, OAuth secrets
- `.env` files, `.env.local`, or any environment dumps
- The `.pem` private key used to sign the extension (lives in user's `~/vault/`, NOT in this repo)
- Customer data, real contract numbers, real chassis numbers, real names — even in test fixtures or screenshots
- Internal hostnames beyond `moto24.roodee.io` and `localhost` (those are already declared in `manifest.json`)
- Stack traces or debug dumps that include any of the above

### SAFE to commit

- `manifest.json` including the `"key"` field — that's the **public** key derived from the `.pem`. Chrome uses it to compute the deterministic extension ID. Safe like a TLS public key is safe.
- DOM selectors for the public RVP ePolicy site (`https://epolicy4.rvp.co.th`)
- Generic Chrome MV3 plumbing (service worker, content scripts, popup)
- The Thai install guide and screenshots — provided screenshots redact any real customer data

If unsure, ask before committing. Deleting from public history is painful (`git filter-repo` + force push + assume credentials/data are already scraped).

## Sibling repo: moto24 (PRIVATE)

The other half of this system lives at `/Users/rakkanj/dev/moto24/`. That repo is **private** and contains:

- The PRB resolver logic (`lib/registration-tracking/prb-resolver.ts`) — converts BC contract data to RVP-ready field values
- The bridge helper (`lib/registration-tracking/prb-bot.ts`) — calls `chrome.runtime.sendMessage` to talk to this extension
- All BC mapping tables (province codes, color codes, prefix sets) — proprietary mapping data
- The version-gate constant `REQUIRED_EXTENSION_VERSION` that polices rollout

**Do not duplicate any of that logic into this repo.** This extension stays dumb — it receives a payload, calls `setNativeValue(selector, value)`, and reports filled/skipped fields back. All transformation lives in moto24.

When working on a change that touches both repos (e.g. a new payload field), edit the moto24 resolver first, then update this extension's `run-prb-flow.js` to consume the new field. Extension version bumps in lockstep with `REQUIRED_EXTENSION_VERSION`.

## Architecture (one-liner)

Officer clicks "กรอก พรบ" on moto24's `/registration-tracking` row → moto24 calls `resolvePRBPayload(row)` → `chrome.runtime.sendMessage(extensionId, {type:"FILL_PRB", data})` via `externally_connectable` → service worker opens new tab to `https://epolicy4.rvp.co.th/Policy/New` → injects `runPRBFlow(payload)` via `chrome.scripting.executeScript({func, world:"MAIN"})` → returns `{success, filled[], skipped[]}` → moto24 toast shows the result.

## Key files

- `manifest.json` — MV3 manifest. `externally_connectable.matches` restricts which origins can send messages to the extension. **Edit this carefully** — adding origins broadens the attack surface.
- `service-worker.js` — background service worker. Listens for `FILL_PRB` messages, opens RVP tab, injects the page function.
- `scripts/run-prb-flow.js` — page-injected function (must be self-contained — Chrome calls `.toString()` on it). Fills 18 RVP fields with two-tier verify.
- `scripts/detect-page.js` — URL classifier (`login`, `form`, `unknown`).
- `popup/` — browser-action popup. Renders state from `chrome.storage.session`. `field-labels.js` is duplicated from moto24's `tracking-row.tsx` — keep in sync (cross-reference comment in both).

## Versioning

- **Manifest version** = release version (e.g., `0.5.0`).
- **Tag** matches manifest version with `v` prefix (`v0.5.0`).
- moto24's `REQUIRED_EXTENSION_VERSION` is bumped when payload contract or critical behavior changes.
- Bump manifest version FIRST, commit, then `git tag vX.Y.Z && git push --tags` — GH Actions builds the zip and publishes the GitHub Release.

## Critical implementation notes (from prior incidents)

These all caused real bugs during P1/P3 development. Don't reintroduce them:

1. **`chrome.scripting.executeScript({files:[...]})` returns undefined unreliably.** Always inject via `func:` + `args:` so data passes as a serialized argument.
2. **Default ISOLATED world hides page jQuery.** Pass `world: "MAIN"` to `executeScript` so injected code can call `window.jQuery` directly.
3. **Select2 + jQuery: `trigger('change')` ONCE.** Never combine native `dispatchEvent` and jQuery trigger on the same select — duplicates options on cascaded dropdowns.
4. **Field ordering matters on RVP.** Setting `#MARQUE` resets `#CarColor`. Setting `#CarType` clobbers `#CarSize`. Selecting Tumbol auto-fills Zipcode. Read the comments in `run-prb-flow.js` before reordering anything.
5. **PDPA modal `×` button is disabled.** Click `#imgEvent > img` instead.
6. **`externally_connectable.matches` must cover the whole moto24 origin** (`/*`), not just the trigger route. Chrome grants the binding at document load time based on the URL at that moment, and Next.js soft-nav doesn't re-grant.

## Stable extension ID

`manifest.json` includes a `"key"` field (since v0.6.0). Chrome derives the extension ID deterministically from this key, so every officer's unpacked install has the same ID regardless of folder path. moto24's `NEXT_PUBLIC_PRB_EXTENSION_ID` is set to this stable ID.

**Never regenerate the keypair without coordinating an officer-wide reinstall** — it changes the extension ID and breaks the bridge for everyone simultaneously.

## Pnpm convention

Even though this is a tiny no-deps extension, scripts in `package.json` use `pnpm` to match the moto24 repo convention (the dev runs both side-by-side). `pnpm zip` is the canonical build command.
