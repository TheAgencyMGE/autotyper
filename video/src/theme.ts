import { loadFont as loadSerif } from "@remotion/google-fonts/Newsreader";
import { loadFont as loadSans } from "@remotion/google-fonts/SchibstedGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";

// Same palette and type as the app (src/renderer/src/styles.css).
export const colors = {
  paper: "#f6f3ec",
  paperRaised: "#fbf9f4",
  cream: "#efebe1",
  rule: "#e2ddd1",
  ink: "#23211d",
  graphite: "#6f6a60",
  pencil: "#9a9486",
  accent: "#2a3fb0",
  brick: "#9e3b2e",
};

export const fonts = {
  serif: loadSerif("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily,
  serifItalic: loadSerif("italic", { weights: ["400"], subsets: ["latin"] }).fontFamily,
  sans: loadSans("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily,
  mono: loadMono("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily,
};
