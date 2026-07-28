# Artwork sources

Original SVG sources for the store/driver PNGs. To re-render after edits (uses headless Chrome + sips on macOS):

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --screenshot=app.png  --window-size=1000,700  "file://$PWD/app.svg"
"$CHROME" --headless --disable-gpu --screenshot=timer.png --window-size=1000,1000 "file://$PWD/timer.svg"
# ...then sips -z <h> <w> to produce each required size (see docs/PLAN.md image sizes)
```

All art is original (flat illustration style) — no Orbit marketing photos, so nothing here has licensing strings attached.

## v0.1.2 store imagery

Per App Store review feedback, the store PNGs were replaced with Orbit's own product/marketing photography (sourced from orbitonline.com product pages, cropped/padded — the reviewer directed us to manufacturer imagery). The SVGs here remain as fallback originals. Icons (`assets/icon.svg`, driver icons) are still original vector work.
