import { Composition, Still } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";
import { AppIcon, SocialCard } from "./Logo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Demo" component={Demo} durationInFrames={DEMO_DURATION} fps={30} width={1920} height={1080} />
    <Still id="Icon" component={AppIcon} width={1024} height={1024} />
    <Still id="Social" component={SocialCard} width={1280} height={640} />
  </>
);
