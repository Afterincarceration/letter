import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, display, serif } from "../theme";

const PLAIN =
  "they keep moving my brother around and wont tell us where he is or let him see a doctor";

const FORMAL_LINES = [
  "To the Office of the Inspector General:",
  "",
  "I write to formally request an inquiry into the",
  "repeated, unexplained transfers of an incarcerated",
  "individual and the denial of his access to medical",
  "care. These actions raise serious concerns under",
  "applicable correctional standards and federal law.",
  "",
  "I respectfully request a written response and a",
  "case number within thirty (30) days.",
];

export const SceneTransform: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Plain note slides in from the left.
  const noteIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const noteX = interpolate(noteIn, [0, 1], [-80, 0]);

  // Arrow pulses to life.
  const arrowOpacity = interpolate(frame, [40, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const arrowShift = Math.sin(Math.max(0, frame - 50) / 8) * 6;

  // Formal letter "types" in, line by line, starting at frame 60.
  const totalChars = FORMAL_LINES.join("\n").length;
  const revealedChars = interpolate(frame, [60, 175], [0, totalChars], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const exit = interpolate(frame, [186, 208], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Walk the lines and reveal characters progressively.
  let consumed = 0;
  const rendered = FORMAL_LINES.map((line) => {
    const start = consumed;
    consumed += line.length + 1; // +1 for the newline
    const show = Math.max(0, Math.min(line.length, Math.round(revealedChars) - start));
    return line.slice(0, show);
  });

  const showCaret = Math.round(revealedChars) < totalChars && frame % 16 < 8;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: exit,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
        {/* Plain-language note */}
        <div
          style={{
            width: 520,
            transform: `translateX(${noteX}px)`,
            opacity: noteIn,
          }}
        >
          <div
            style={{
              fontFamily: serif,
              fontSize: 16,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.muted,
              marginBottom: 14,
            }}
          >
            What you say
          </div>
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${C.faint}`,
              borderRadius: 2,
              padding: "30px 32px",
              fontFamily: serif,
              fontSize: 30,
              lineHeight: 1.6,
              color: C.text,
            }}
          >
            &ldquo;{PLAIN}&rdquo;
          </div>
        </div>

        {/* Arrow */}
        <div
          style={{
            fontFamily: display,
            fontSize: 64,
            color: C.gold,
            opacity: arrowOpacity,
            transform: `translateX(${arrowShift}px)`,
            textShadow: `0 0 22px ${C.gold}`,
          }}
        >
          &rarr;
        </div>

        {/* Formal letter on paper */}
        <div style={{ width: 560 }}>
          <div
            style={{
              fontFamily: serif,
              fontSize: 16,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: C.gold,
              marginBottom: 14,
            }}
          >
            What they receive
          </div>
          <div
            style={{
              background: C.paper,
              color: C.paperText,
              borderRadius: 2,
              padding: "38px 44px",
              fontFamily: serif,
              fontSize: 21,
              lineHeight: 1.7,
              boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
              minHeight: 430,
              whiteSpace: "pre-wrap",
            }}
          >
            {rendered.map((line, i) => (
              <div key={i} style={{ minHeight: line === "" ? 14 : undefined }}>
                {line}
                {showCaret &&
                i === rendered.findIndex((l, idx) => l.length < FORMAL_LINES[idx].length) ? (
                  <span style={{ color: C.gold }}>|</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
