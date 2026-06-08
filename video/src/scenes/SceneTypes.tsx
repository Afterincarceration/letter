import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, display, serif } from "../theme";

const TYPES = [
  { icon: "🔓", label: "Support Someone's Release", desc: "Parole boards, judges, officials" },
  { icon: "⚖️", label: "Report Guard Brutality", desc: "Inspectors general, oversight boards" },
  { icon: "🏦", label: "Report Consumer Fraud", desc: "FTC, CFPB, state regulators" },
  { icon: "📋", label: "Request Documentation", desc: "FOIA / FOIL records requests" },
  { icon: "📊", label: "Dispute a Credit Report", desc: "Equifax, TransUnion, Experian" },
  { icon: "✊", label: "General Advocacy Letter", desc: "Elected officials, agencies" },
];

export const SceneTypes: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headingOpacity = interpolate(frame, [4, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const exit = interpolate(frame, [180, 200], [1, 0], {
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
      <div style={{ width: 1280 }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 46,
            color: C.text,
            textAlign: "center",
            marginBottom: 44,
            opacity: headingOpacity,
          }}
        >
          One tool. Six kinds of pressure.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 22,
          }}
        >
          {TYPES.map((t, i) => {
            const delay = 20 + i * 9;
            const enter = spring({
              frame: frame - delay,
              fps,
              config: { damping: 200 },
              durationInFrames: 24,
            });
            return (
              <div
                key={t.label}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.gold}`,
                  borderRadius: 2,
                  padding: "26px 28px",
                  opacity: enter,
                  transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
                }}
              >
                <div style={{ fontSize: 38, marginBottom: 14 }}>{t.icon}</div>
                <div
                  style={{
                    fontFamily: display,
                    fontWeight: 700,
                    fontSize: 26,
                    color: C.text,
                    marginBottom: 8,
                    lineHeight: 1.25,
                  }}
                >
                  {t.label}
                </div>
                <div
                  style={{
                    fontFamily: serif,
                    fontStyle: "italic",
                    fontSize: 18,
                    color: C.muted,
                    lineHeight: 1.5,
                  }}
                >
                  {t.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
