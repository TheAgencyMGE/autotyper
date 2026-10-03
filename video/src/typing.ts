// Turns a script of keystrokes into "what's on screen at frame N", with uneven
// human timing and slips that get noticed and fixed.

export type Step =
  | { type: string } // type these characters
  | { slip: string; fix: string } // type a wrong string, pause, delete it, type the right one
  | { pause: number }; // frames

type Frame = { at: number; text: string };

const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

export const buildTimeline = (steps: Step[], perKey = 2.2): Frame[] => {
  const out: Frame[] = [{ at: 0, text: "" }];
  let t = 0;
  let text = "";
  let n = 0;
  const key = (next: string) => {
    n += 1;
    const ch = next[next.length - 1] ?? "";
    let d = perKey * (0.55 + rand(n) * 0.9);
    if (ch === " ") d += perKey * 0.4;
    if (ch === "\n") d += perKey * 3;
    t += d;
    text = next;
    out.push({ at: t, text });
  };
  for (const s of steps) {
    if ("pause" in s) t += s.pause;
    else if ("type" in s) for (const c of s.type) key(text + c);
    else {
      for (const c of s.slip) key(text + c);
      t += perKey * 5;
      for (let i = 0; i < s.slip.length; i++) key(text.slice(0, -1));
      for (const c of s.fix) key(text + c);
    }
  }
  return out;
};

export const textAt = (timeline: Frame[], frame: number) => {
  let lo = 0;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].at <= frame) lo = i;
    else break;
  }
  return timeline[lo].text;
};

export const endOf = (timeline: Frame[]) => timeline[timeline.length - 1].at;
