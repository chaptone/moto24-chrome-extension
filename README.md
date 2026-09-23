# Moto24 พรบ Auto-Fill Extension

Chrome MV3 extension that auto-fills the RVP ePolicy พรบ form for [Moto24](https://moto24.roodee.io/registration-tracking)'s registration tracking pipeline.

The extension is a thin shell with **two flows**, both fed by the private moto24 repo:

1. **`FILL_PRB`** — opens the RVP ePolicy form, fills 18 fields, and reports back (unchanged since 0.10.x).
2. **`FILL_DLT_TAX`** (0.11.0+) — opens the Department of Land Transport e-Service (`eservice.dlt.go.th`), registers the vehicle in the officer's own logged-in account (trying at most two owner names), presses that vehicle's "pay tax" button, and reads what the site says on the tax page. **It never accepts the agreement, submits, or pays** — the officer does every confirming click. Progress and the site's messages are kept in `chrome.storage.local` for at most 24 hours and returned to moto24 via `GET_DLT_TAX_RESULT`.

## For officers

See the Thai install/update guide: [`docs/install-th.md`](docs/install-th.md).

Download the latest release: <https://github.com/chaptone/moto24-chrome-extension/releases/latest>.

## For developers

This is a public-source repo for an internal tool. See [`CLAUDE.md`](CLAUDE.md) for the public-repo guardrails (what's safe to commit, what isn't).

### Build a release zip locally

```bash
pnpm zip
# → produces dist/moto24-prb-extension-v<version>.zip
```

### Run the tests

```bash
node --test "test/**/*.test.js"   # or: pnpm test
```

The release workflow runs the same command before building the zip — a red test means no release.

### Cut a new release

1. Bump `version` in `manifest.json` and `package.json`.
2. Bump `REQUIRED_EXTENSION_VERSION` in moto24's `lib/registration-tracking/constants.ts` if breaking.
3. `git tag vX.Y.Z && git push --tags` — GitHub Actions builds + publishes the Release with the zip attached.

### Architecture & gotchas

See [`CLAUDE.md`](CLAUDE.md) for the implementation gotchas list (jQuery cascades, ISOLATED-vs-MAIN world, field ordering invariants, etc.). Original design docs live in the moto24 repo at `docs/superpowers/specs/2026-04-*-prb-*.md`.
