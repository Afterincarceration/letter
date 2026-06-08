import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, display, serif } from "../theme";

export const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const wordmarkY = interpolate(rise, [0, 1], [28, 0]);
  const wordmarkOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Gold underline draws in beneath the wordmark.
  const lineWidth = interpolate(frame, [24, 60], [0, 460], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(frame, [40, 64], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Gentle fade out before the next scene.
  const exit = interpolate(frame, [96, 118], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: exit,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 900,
            fontSize: 104,
            letterSpacing: "-0.01em",
            color: C.text,
            lineHeight: 1,
            opacity: wordmarkOpacity,
            transform: `translateY(${wordmarkY}px)`,
          }}
        >
          After Incarceration
        </div>
        <div
          style={{
            height: 2,
            width: lineWidth,
            background: C.gold,
            margin: "26px auto 0",
            boxShadow: `0 0 18px ${C.gold}`,
          }}
        />
        <div
          style={{
            fontFamily: serif,
            fontStyle: "italic",
            fontSize: 26,
            letterSpacing: "0.06em",
            color: C.muted,
            marginTop: 22,
            opacity: subOpacity,
          }}
        >
          Civic Action Letter Tool
        </div>
      </div>
    </AbsoluteFill>
  );
};
