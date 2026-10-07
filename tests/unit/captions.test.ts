import { describe, expect, it } from 'vitest';
import {
  clock,
  detectSubtitles,
  parseSubtitles,
  shiftCues,
  toAss,
  toSrt,
  toVtt,
  type Cue,
} from '../../src/captions/cues';

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello <i>there</i>

2
00:00:03,000 --> 00:00:05,250
Two
lines
`;

const VTT = `WEBVTT
Kind: captions

NOTE a comment

intro
00:01.000 --> 00:02.500 align:start
Hello &amp; welcome

00:00:03.000 --> 00:00:05.250
<v Speaker>Second</v>
`;

const ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\b1}Hello{\\b0}, world\\Nagain
Comment: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,ignored
Dialogue: 0,0:00:03.00,0:00:05.25,Default,,0,0,0,,Second
`;

const plain = (cues: Cue[]) => cues.map(({ start, end, text }) => ({ start, end, text }));

describe('captions', () => {
  it('detects formats', () => {
    expect(detectSubtitles(SRT)).toBe('srt');
    expect(detectSubtitles(String.fromCharCode(0xfeff) + VTT)).toBe('vtt');
    expect(detectSubtitles(ASS)).toBe('ass');
    expect(detectSubtitles('hello')).toBeNull();
  });

  it('reads SRT', () => {
    expect(plain(parseSubtitles(SRT.replace(/\n/g, '\r\n')))).toEqual([
      { start: 1, end: 2.5, text: 'Hello there' },
      { start: 3, end: 5.25, text: 'Two\nlines' },
    ]);
  });

  it('reads WebVTT with short timestamps, settings, notes and markup', () => {
    expect(plain(parseSubtitles(VTT))).toEqual([
      { start: 1, end: 2.5, text: 'Hello & welcome' },
      { start: 3, end: 5.25, text: 'Second' },
    ]);
  });

  it('reads ASS dialogue with commas, override tags and line breaks', () => {
    expect(plain(parseSubtitles(ASS))).toEqual([
      { start: 1, end: 2.5, text: 'Hello, world\nagain' },
      { start: 3, end: 5.25, text: 'Second' },
    ]);
  });

  it('round-trips through every writer', () => {
    const cues = parseSubtitles(SRT);
    for (const write of [toSrt, toVtt, (c: Cue[]) => toAss(c)])
      expect(plain(parseSubtitles(write(cues)))).toEqual(plain(cues));
  });

  it('writes standard timestamps', () => {
    const [cue] = parseSubtitles(SRT);
    expect(toSrt([{ ...cue!, start: 3723.4, end: 3724 }])).toContain(
      '01:02:03,400 --> 01:02:04,000',
    );
    expect(toVtt([cue!])).toMatch(/^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.500\n/);
  });

  it('parses clock values', () => {
    expect(clock('1:02:03.5')).toBeCloseTo(3723.5);
    expect(clock('02:03,040')).toBeCloseTo(123.04);
  });

  it('shifts cues and drops the ones pushed before zero', () => {
    const shifted = shiftCues(parseSubtitles(SRT), -2);
    expect(plain(shifted)).toEqual([
      { start: 0, end: 0.5, text: 'Hello there' },
      { start: 1, end: 3.25, text: 'Two\nlines' },
    ]);
    expect(shiftCues(parseSubtitles(SRT), -10)).toEqual([]);
  });
});
