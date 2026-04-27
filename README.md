# Moto24 พรบ Auto-Fill Extension

Chrome MV3 extension that auto-fills the RVP ePolicy พรบ form for [Moto24](https://moto24.roodee.io/registration-tracking)'s registration tracking pipeline.

The extension is a thin shell — all field-mapping and BC-data resolution lives in the private moto24 repo. This extension receives a payload via `chrome.runtime.sendMessage`, opens the RVP form, fills 18 fields, and reports back.

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

### Cut a new release

1. Bump `version` in `manifest.json` and `package.json`.
2. Bump `REQUIRED_EXTENSION_VERSION` in moto24's `lib/registration-tracking/constants.ts` if breaking.
3. `git tag vX.Y.Z && git push --tags` — GitHub Actions builds + publishes the Release with the zip attached.

### Architecture & gotchas

See [`CLAUDE.md`](CLAUDE.md) for the implementation gotchas list (jQuery cascades, ISOLATED-vs-MAIN world, field ordering invariants, etc.). Original design docs live in the moto24 repo at `docs/superpowers/specs/2026-04-*-prb-*.md`.
