import { AbsoluteFill } from "remotion";
import { colors, fonts } from "./theme";

// App icon: an ink "A" on paper, followed by the blue caret from the wordmark.
export const LogoMark: React.FC<{ size: number; caretOpacity?: number }> = ({ size, caretOpacity = 1 }) => {
  const r = size * 0.225;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: colors.paper,
        boxShadow: `inset 0 0 0 ${size * 0.012}px ${colors.rule}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", transform: `translate(${size * 0.02}px, ${size * 0.035}px)` }}>
        <span
          style={{
            fontFamily: fonts.serif,
            fontWeight: 500,
            fontSize: size * 0.62,
            lineHeight: 1,
            color: colors.ink,
            letterSpacing: -size * 0.01,
          }}
        >
          A
        </span>
        <span
          style={{
            width: size * 0.065,
            height: size * 0.46,
            marginLeft: size * 0.06,
            marginTop: -size * 0.13,
            borderRadius: size * 0.02,
            background: colors.accent,
            transform: "skewX(-12deg)",
            opacity: caretOpacity,
          }}
        />
      </div>
    </div>
  );
};

// Square icon for electron-builder and the README (transparent corners).
export const AppIcon: React.FC = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <LogoMark size={1024} />
  </AbsoluteFill>
);

// Wide social preview image for GitHub (1280x640).
export const SocialCard: React.FC = () => (
  <AbsoluteFill style={{ background: colors.paper, alignItems: "center", justifyContent: "center", gap: 36 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
      <LogoMark size={170} />
      <div style={{ fontFamily: fonts.serif, fontSize: 132, color: colors.ink, letterSpacing: -2 }}>AutoTyper</div>
    </div>
    <div style={{ fontFamily: fonts.sans, fontSize: 40, color: colors.graphite }}>
      Types your code and writing into any app at a human pace.
    </div>
  </AbsoluteFill>
);
