import React from "react";
import { Composition } from "remotion";
import { LetterPromo } from "./LetterPromo";
import { VIDEO } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LetterPromo"
      component={LetterPromo}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
