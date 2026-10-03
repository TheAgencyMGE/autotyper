import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Editor, Headline, Intro, Outro, Shot } from "./scenes/Scenes";

const T = 15;
const scenes = [
  { d: 90, el: <Intro /> },
  { d: 175, el: <Headline /> },
  { d: 120, el: <Shot src="01-coder-idea.png" caption="Describe an idea, or paste your own code." focus={[50, 0]} /> },
  { d: 120, el: <Shot src="05-coder-workspace.png" caption="Read it over before anything gets typed." focus={[65, 0]} /> },
  { d: 270, el: <Editor /> },
  { d: 130, el: <Shot src="08b-writer-tells.png" caption="AutoWriter flags phrases that read as AI." focus={[20, 0]} zoom={1.2} /> },
  { d: 120, el: <Shot src="09-writer-typing.png" caption="Pause or stop any time. Ctrl+Alt+Esc." focus={[30, 0]} /> },
  { d: 120, el: <Outro /> },
];

export const DEMO_DURATION = scenes.reduce((s, x) => s + x.d, 0) - T * (scenes.length - 1);

export const Demo: React.FC = () => (
  <TransitionSeries>
    {scenes.flatMap((s, i) => [
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.d}>
        {s.el}
      </TransitionSeries.Sequence>,
      ...(i < scenes.length - 1
        ? [<TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: T })} />]
        : []),
    ])}
  </TransitionSeries>
);
