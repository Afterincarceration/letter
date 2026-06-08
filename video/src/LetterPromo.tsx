import React from "react";
import { AbsoluteFill, Series } from "remotion";
import { Background } from "./components/Background";
import { SceneIntro } from "./scenes/SceneIntro";
import { SceneHero } from "./scenes/SceneHero";
import { SceneTransform } from "./scenes/SceneTransform";
import { SceneTypes } from "./scenes/SceneTypes";
import { SceneOutro } from "./scenes/SceneOutro";

export const LetterPromo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      <Series>
        <Series.Sequence durationInFrames={120}>
          <SceneIntro />
        </Series.Sequence>
        <Series.Sequence durationInFrames={180}>
          <SceneHero />
        </Series.Sequence>
        <Series.Sequence durationInFrames={210}>
          <SceneTransform />
        </Series.Sequence>
        <Series.Sequence durationInFrames={200}>
          <SceneTypes />
        </Series.Sequence>
        <Series.Sequence durationInFrames={190}>
          <SceneOutro />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
