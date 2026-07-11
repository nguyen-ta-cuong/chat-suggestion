const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const combiningMark = /\p{Mark}/u;
const emoji = /\p{Extended_Pictographic}/u;

export function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((segment) => segment.segment);
}

export function graphemeWidth(grapheme: string): number {
  if (grapheme === "\n" || grapheme === "\r") return 0;
  if (grapheme === "\t") return 4;
  if (emoji.test(grapheme)) return 2;
  const base = [...grapheme].find(
    (character) => !combiningMark.test(character),
  );
  if (base === undefined) return 0;
  const codePoint = base.codePointAt(0) ?? 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

export function displayWidth(value: string): number {
  return graphemes(value).reduce(
    (width, grapheme) => width + graphemeWidth(grapheme),
    0,
  );
}

export function truncateToWidth(value: string, maximumWidth: number): string {
  let width = 0;
  let output = "";
  for (const grapheme of graphemes(value)) {
    const nextWidth = width + graphemeWidth(grapheme);
    if (nextWidth > maximumWidth) break;
    output += grapheme;
    width = nextWidth;
  }
  return output;
}

export function renderDimSuggestion(
  value: string,
  maximumWidth: number,
): string {
  const safe = sanitizeSingleLine(value);
  const visible = truncateToWidth(safe, maximumWidth);
  return visible.length === 0 ? "" : `\u001b[2m${visible}\u001b[22m`;
}

function sanitizeSingleLine(value: string): string {
  const withoutEscapes = value.replace(
    /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)|P[^\u001b]*(?:\u001b\\|$)|[@-_]?)/gu,
    "",
  );
  let output = "";
  for (const character of withoutEscapes) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\n" || character === "\r") break;
    if (
      codePoint > 0x1f &&
      codePoint !== 0x7f &&
      codePoint !== 0x1b &&
      !(codePoint >= 0x80 && codePoint <= 0x9f)
    )
      output += character;
  }
  return output;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}
