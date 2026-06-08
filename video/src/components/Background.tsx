import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";

/**
 * Warm near-black backdrop with a slow-drifting golden radial glow and a
 * vignette, echoing the app's "paper in a dim room" aesthetic.
 */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 4;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${50 + drift}% 38%, rgba(200,144,42,0.14), rgba(13,11,8,0) 55%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
