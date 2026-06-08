import { continueRender, delayRender, staticFile } from "remotion";

// Brand palette — mirrors the `C` object in the Letter generator app.
export const C = {
  bg: "#0d0b08",
  surface: "#16120c",
  hover: "#1e1810",
  border: "#2a2218",
  gold: "#c8902a",
  goldHi: "#e0a030",
  text: "#e8e0d0",
  muted: "#9a8a72",
  faint: "#4a3e2e",
  paper: "#faf7f0",
  paperText: "#1a1510",
} as const;

export const display = "Playfair Display";
export const serif = "Source Serif 4";

// Fonts are bundled locally (from @fontsource) and loaded via the FontFace
// API. The render environment blocks fonts.gstatic.com, so we cannot rely on
// @remotion/google-fonts fetching at render time.
const FONTS: { family: string; file: string; weight: string; style: string }[] = [
  { family: display, file: "fonts/playfair-700.woff2", weight: "700", style: "normal" },
  { family: display, file: "fonts/playfair-900.woff2", weight: "900", style: "normal" },
  { family: serif, file: "fonts/source-serif-400.woff2", weight: "400", style: "normal" },
  { family: serif, file: "fonts/source-serif-400-italic.woff2", weight: "400", style: "italic" },
];

if (typeof document !== "undefined") {
  const handle = delayRender("Loading brand fonts");
  Promise.all(
    FONTS.map(({ family, file, weight, style }) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, {
        weight,
        style,
      });
      return face.load().then((loaded) => {
        (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
      });
    }),
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      // Don't hang the render if a font fails — fall back to system serif.
      console.error("Font load failed", err);
      continueRender(handle);
    });
}

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 30 * 30, // 30 seconds
} as const;
