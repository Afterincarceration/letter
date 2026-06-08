import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, display, serif } from "../theme";

export const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lineOpacity = interpolate(frame, [6, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineY = interpolate(frame, [6, 30], [22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const pill = spring({
    frame: frame - 44,
    fps,
    config: { damping: 200 },
    durationInFrames: 26,
  });

  const wordmarkOpacity = interpolate(frame, [70, 96], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 64,
            color: C.text,
            lineHeight: 1.25,
            maxWidth: 1100,
            opacity: lineOpacity,
            transform: `translateY(${lineY}px)`,
          }}
        >
          Make institutional authority
          <br />
          <span style={{ color: C.gold }}>take you seriously.</span>
        </div>

        <div
          style={{
            display: "inline-block",
            marginTop: 48,
            padding: "18px 44px",
            background: C.gold,
            color: C.bg,
            borderRadius: 2,
            fontFamily: display,
            fontWeight: 700,
            fontSize: 30,
            opacity: pill,
            transform: `scale(${interpolate(pill, [0, 1], [0.85, 1])})`,
            boxShadow: `0 0 36px rgba(200,144,42,0.4)`,
          }}
        >
          Write your letter today
        </div>

        <div
          style={{
            marginTop: 56,
            opacity: wordmarkOpacity,
          }}
        >
          <div
            style={{
              fontFamily: display,
              fontWeight: 900,
              fontSize: 40,
              color: C.text,
              letterSpacing: "-0.01em",
            }}
          >
            After Incarceration
          </div>
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              fontSize: 20,
              color: C.muted,
              marginTop: 8,
              letterSpacing: "0.04em",
            }}
          >
            afterincarceration.org
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
