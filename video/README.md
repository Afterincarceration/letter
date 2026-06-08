# After Incarceration — Promo Video (Remotion)

A 30-second, 1080p promo for the **Civic Action Letter Tool**, built with
[Remotion](https://www.remotion.dev/). Branding (palette, Playfair Display +
Source Serif 4) mirrors the `Letter generator` app.

## Storyboard

| Scene | Frames | Content |
| ----- | ------ | ------- |
| Intro | 0–120 | "After Incarceration" wordmark + gold underline |
| Hero | 120–300 | "Say it plainly. We'll say it formally." |
| Transform | 300–510 | A plain-language note → a formal letter that types itself in |
| Types | 510–710 | The six letter types as a card grid |
| Outro | 710–900 | "Make institutional authority take you seriously" + CTA |

## Develop

```bash
cd video
npm install
npm run dev      # opens Remotion Studio at localhost:3000
```

## Render

```bash
npm run build    # -> out/letter-promo.mp4  (1920x1080, 30fps, 30s)
npm run still    # -> out/poster.png        (a poster frame)
```

## Fonts

The render environment blocks `fonts.gstatic.com`, so fonts are **bundled
locally** from `@fontsource` into `public/fonts/` and loaded via the FontFace
API behind a `delayRender` gate (see `src/theme.ts`). No network fetch happens
at render time.
