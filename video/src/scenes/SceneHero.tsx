import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { C, display } from "../theme";

/** "Say it plainly. We'll say it formally." — the product's core promise. */
export const SceneHero: React.FC = () => {
  const frame = useCurrentFrame();

  const line1Opacity = interpolate(frame, [6, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line1Y = interpolate(frame, [6, 30], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const line2Opacity = interpolate(frame, [54, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line2Y = interpolate(frame, [54, 78], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const exit = interpolate(frame, [156, 178], [1, 0], {
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
      <div style={{ textAlign: "center", fontFamily: display, fontWeight: 700 }}>
        <div
          style={{
            fontSize: 88,
            color: C.text,
            opacity: line1Opacity,
            transform: `translateY(${line1Y}px)`,
          }}
        >
          Say it plainly.
        </div>
        <div
          style={{
            fontSize: 88,
            color: C.gold,
            marginTop: 14,
            opacity: line2Opacity,
            transform: `translateY(${line2Y}px)`,
          }}
        >
          We&rsquo;ll say it formally.
        </div>
      </div>
    </AbsoluteFill>
  );
};
