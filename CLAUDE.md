# Project conventions

Homey Pro app (SDK v3) for Orbit B-hyve irrigation. App ID `com.orbitbhyve` (never change), display name "B-hyve".

## Non-negotiables on every change

1. **Changelog**: update `CHANGELOG.md` (`[Unreleased]` section) in the same commit as the change. On App Store releases, move `[Unreleased]` under a new version heading, bump `.homeycompose/app.json` version, tag `vX.Y.Z`, and use the same text for the publish changelog (`.homeychangelog.json`).
2. **Docs sync**: `docs/USER-GUIDE.md` and `docs/FEATURES.md` describe as-built behavior — update them with any user-visible change.
3. **Push to GitHub** (`main`) after committing; don't wait to be asked.
4. **Verify before commit**: `node --test test/*.test.js` and `homey app validate --level publish` must both pass.
5. The app is **sideloaded** on "Gk Homey Pro" — run `homey app install` after changes so the running app matches the repo.

## Layout

- `lib/` — OrbitClient (REST), OrbitWebSocket (push), StateStore (merge rules — unit-tested, keep pure), BhyveDevice (device base class)
- `drivers/bhyve-timer|bhyve-zone|bhyve-flood-sensor/` — compose JSON + driver.js/device.js
- `.homeycompose/` — manifest + custom capabilities (never edit generated `/app.json`)
- `docs/ORBIT-API.md` — the protocol contract; verify against it when touching lib/
- `assets/artwork-src/` — SVG sources for all PNGs (render via headless Chrome, see its README)
