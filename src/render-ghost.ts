import {
  CURSOR_MARKER,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export interface GhostDecorationOptions {
  readonly line: string;
  readonly suffix: string;
  readonly width: number;
  readonly styleDim: (text: string) => string;
}

const REVERSE_ON = "\u001b[7m";
const REVERSE_OFF = "\u001b[27m";
const RESET = "\u001b[0m";
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export function decorateEolGhostLine(
  options: GhostDecorationOptions,
): string | undefined {
  const markerIndex = options.line.indexOf(CURSOR_MARKER);
  if (markerIndex < 0 || options.width <= 0) {
    return undefined;
  }

  const prefix = options.line.slice(0, markerIndex);
  const availableWidth = options.width - visibleWidth(prefix);
  if (availableWidth <= 0) {
    return undefined;
  }

  const visibleSuffix = truncateToWidth(options.suffix, availableWidth, "");
  const segments = graphemeSegmenter.segment(visibleSuffix);
  const firstSegment = segments[Symbol.iterator]().next();
  if (firstSegment.done) {
    return undefined;
  }

  const firstGrapheme = firstSegment.value.segment;
  const remainingSuffix = visibleSuffix.slice(firstGrapheme.length);
  const cursor = `${REVERSE_ON}${options.styleDim(firstGrapheme)}${REVERSE_OFF}`;
  const ghost = options.styleDim(remainingSuffix);
  const decorated = `${prefix}${CURSOR_MARKER}${cursor}${ghost}${RESET}`;

  return visibleWidth(decorated) <= options.width ? decorated : undefined;
}
