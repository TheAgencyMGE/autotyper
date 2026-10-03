import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { LogoMark } from "../Logo";
import { colors, fonts } from "../theme";
import { buildTimeline, Step, textAt } from "../typing";

const Caret: React.FC<{ height: number; solid?: boolean }> = ({ height, solid }) => {
  const frame = useCurrentFrame();
  const on = solid || Math.floor(frame / 16) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: Math.max(3, height * 0.06),
        height,
        background: colors.accent,
        marginLeft: height * 0.06,
        transform: "skewX(-12deg) translateY(12%)",
        opacity: on ? 1 : 0,
      }}
    />
  );
};

const useTyped = (steps: Step[], perKey: number, delay = 0) => {
  const frame = useCurrentFrame();
  const timeline = buildTimeline(steps, perKey);
  const text = textAt(timeline, frame - delay);
  const typing = frame - delay < timeline[timeline.length - 1].at + 6;
  return { text, typing };
};

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14 } });
  const { text, typing } = useTyped([{ pause: 12 }, { type: "AutoTyper" }], 3);
  return (
    <AbsoluteFill style={{ background: colors.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
        <div style={{ transform: `scale(${pop})` }}>
          <LogoMark size={220} />
        </div>
        <div style={{ fontFamily: fonts.serif, fontSize: 168, color: colors.ink, letterSpacing: -3, minWidth: 760 }}>
          {text}
          <Caret height={140} solid={typing} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Headline: React.FC = () => {
  const frame = useCurrentFrame();
  const { text, typing } = useTyped(
    [{ type: "Describe it." }, { pause: 10 }, { type: "\nWatch it " }, { slip: "tpye", fix: "type" }, { type: "." }],
    2.6,
    6,
  );
  const sub = interpolate(frame, [130, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lines = text.split("\n");
  return (
    <AbsoluteFill style={{ background: colors.paper, justifyContent: "center", padding: "0 220px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={{ fontFamily: fonts.serif, fontSize: 150, lineHeight: 1.08, color: colors.ink, letterSpacing: -3, minHeight: 330 }}>
          {lines.map((l, i) => (
            <div key={i}>
              {i === 1 ? <span style={{ fontFamily: fonts.serifItalic, fontStyle: "italic" }}>{l}</span> : l}
              {i === lines.length - 1 && <Caret height={124} solid={typing} />}
            </div>
          ))}
        </div>
        <div style={{ fontFamily: fonts.sans, fontSize: 48, color: colors.graphite, opacity: sub }}>
          AutoTyper types code and writing into any app, like a person would.
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Shot: React.FC<{ src: string; caption: string; focus?: [number, number]; zoom?: number }> = ({
  src,
  caption,
  focus = [50, 50],
  zoom = 1.12,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const scale = interpolate(frame, [0, durationInFrames], [1, zoom]);
  return (
    <AbsoluteFill style={{ background: colors.cream, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 64,
            color: colors.ink,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 20}px)`,
          }}
        >
          {caption}
        </div>
        <div
          style={{
            width: 1360,
            height: 850,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 2px 0 #e2ddd1, 0 40px 80px -40px rgba(35,33,29,0.45)",
            transform: `translateY(${(1 - enter) * 40}px)`,
            background: colors.paper,
          }}
        >
          <Img
            src={staticFile(src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top",
              transform: `scale(${scale})`,
              transformOrigin: `${focus[0]}% ${focus[1]}%`,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const code: Step[] = [
  { type: "function " },
  { slip: "gerte", fix: "greet" },
  { type: "(name) {\n  return `Hello, ${name}!`\n}\n\n" },
  { pause: 14 },
  { type: "// TODO: come back to this later\n" },
  { pause: 8 },
  { type: "console." },
  { slip: "lgo", fix: "log" },
  { type: "(greet('world'))" },
];

export const Editor: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const { text, typing } = useTyped(code, 2.1, 12);
  const lines = text.split("\n");
  return (
    <AbsoluteFill style={{ background: colors.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
        <div style={{ fontFamily: fonts.serif, fontSize: 64, color: colors.ink, opacity: enter }}>
          Real pacing. Real slips. Real fixes.
        </div>
        <div
          style={{
            width: 1280,
            height: 640,
            background: colors.paperRaised,
            borderRadius: 18,
            boxShadow: "0 2px 0 #e2ddd1, 0 40px 80px -40px rgba(35,33,29,0.45)",
            transform: `translateY(${(1 - enter) * 40}px)`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 76,
              borderBottom: `2px solid ${colors.rule}`,
              display: "flex",
              alignItems: "center",
              padding: "0 36px",
              fontFamily: fonts.mono,
              fontSize: 28,
              color: colors.graphite,
            }}
          >
            greet<span style={{ color: colors.pencil }}>.js</span>
          </div>
          <div style={{ padding: "32px 36px", fontFamily: fonts.mono, fontSize: 38, lineHeight: 1.55 }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: "flex", whiteSpace: "pre" }}>
                <span style={{ width: 64, color: colors.pencil }}>{i + 1}</span>
                <span style={{ color: l.trim().startsWith("//") ? colors.pencil : colors.ink }}>{l}</span>
                {i === lines.length - 1 && <Caret height={44} solid={typing} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 200 } });
  const b = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: colors.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 48 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40, opacity: a, transform: `scale(${0.9 + a * 0.1})` }}>
          <LogoMark size={160} />
          <div style={{ fontFamily: fonts.serif, fontSize: 128, color: colors.ink, letterSpacing: -2 }}>AutoTyper</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: b }}>
          <div style={{ fontFamily: fonts.sans, fontSize: 48, color: colors.graphite }}>Free and open source. Windows.</div>
          <div style={{ fontFamily: fonts.mono, fontSize: 40, color: colors.accent }}>github.com/TheAgencyMGE/autotyper</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
