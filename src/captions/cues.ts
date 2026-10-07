// Timed text cues and the SRT, WebVTT and ASS/SSA formats they are read from and written to.

export type Cue = {
  id: string;
  start: number; // seconds
  end: number;
  text: string; // plain text, lines separated by \n
};

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

let counter = 0;
const cueId = () => `cue-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function detectSubtitles(text: string): SubtitleFormat | null {
  const head = text.trimStart().slice(0, 2048);
  if (/^WEBVTT(?:[ \t]|\r?\n|$)/.test(head)) return 'vtt';
  if (/^\[Script Info\]/i.test(head)) return 'ass';
  if (/^\d+[ \t]*\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}[ \t]*-->/.test(head)) return 'srt';
  return null;
}

export function parseSubtitles(text: string, format = detectSubtitles(text)): Cue[] {
  const clean = text.trimStart().replace(/\r\n?/g, '\n');
  if (format === 'ass') return sorted(parseAss(clean));
  if (format === 'srt' || format === 'vtt') return sorted(parseBlocks(clean));
  throw new Error("This doesn't look like an SRT, WebVTT or ASS subtitle file");
}

const TIMING =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})/;

function parseBlocks(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => TIMING.test(line));
    if (at < 0) continue;
    const [, from, to] = TIMING.exec(lines[at]!)!;
    const body = lines
      .slice(at + 1)
      .join('\n')
      .trim();
    if (!body) continue;
    cues.push({ id: cueId(), start: clock(from!), end: clock(to!), text: stripMarkup(body) });
  }
  return cues;
}

function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let fields: string[] | null = null;
  let inEvents = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEvents = /^\[Events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      fields = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line) || !fields) continue;
    const values = line.slice(line.indexOf(':') + 1).split(',');
    const textIndex = fields.indexOf('text');
    const head = values.slice(0, textIndex).map((v) => v.trim());
    const body = values.slice(textIndex).join(',');
    const start = head[fields.indexOf('start')];
    const end = head[fields.indexOf('end')];
    if (!start || !end) continue;
    const plain = body
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (plain) cues.push({ id: cueId(), start: clock(start), end: clock(end), text: plain });
  }
  return cues;
}

function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Accepts h:mm:ss.fff, mm:ss.fff and ASS's h:mm:ss.cc, with either separator.
export function clock(value: string): number {
  const [hms, frac = '0'] = value.trim().split(/[,.]/);
  const parts = hms!.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  return h * 3600 + m * 60 + s + Number(`0.${frac}`);
}

function sorted(cues: Cue[]): Cue[] {
  return cues
    .filter((cue) => Number.isFinite(cue.start) && cue.end > cue.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function stamp(seconds: number, separator: ',' | '.', hourDigits = 2): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h, hourDigits)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text.trim()}\n`,
    )
    .join('\n');
}

export function toVtt(cues: readonly Cue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text.trim().replace(/-->/g, '→')}\n`,
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

export function toAss(cues: readonly Cue[], width = 1920, height = 1080): string {
  const centi = (seconds: number) => {
    const cs = Math.max(0, Math.round(seconds * 100));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(cs / 360_000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
  };
  const size = Math.round(height * 0.05);
  const events = cues
    .map(
      (cue) =>
        `Dialogue: 0,${centi(cue.start)},${centi(cue.end)},Default,,0,0,0,,${cue.text.trim().replace(/\n/g, '\\N')}`,
    )
    .join('\n');
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    events,
    '',
  ].join('\n');
}

export function writeSubtitles(cues: readonly Cue[], format: SubtitleFormat): string {
  return format === 'srt' ? toSrt(cues) : format === 'vtt' ? toVtt(cues) : toAss(cues);
}

export function shiftCues(cues: readonly Cue[], seconds: number): Cue[] {
  return cues
    .map((cue) => ({ ...cue, start: cue.start + seconds, end: cue.end + seconds }))
    .filter((cue) => cue.end > 0)
    .map((cue) => ({ ...cue, start: Math.max(0, cue.start) }));
}

export function cueAt(cues: readonly Cue[], time: number): Cue[] {
  return cues.filter((cue) => time >= cue.start && time < cue.end);
}

export function newCue(start: number, text = ''): Cue {
  return { id: cueId(), start, end: start + 2, text };
}
