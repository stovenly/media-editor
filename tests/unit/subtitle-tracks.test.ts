import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { subtitleTracks } from '../../src/media/subtitles';

const fixture = (name: string) =>
  new Blob([readFileSync(join(__dirname, '../fixtures/generated', name))]);

describe('subtitle track scan', () => {
  it('finds mov_text in MP4 with its language', async () => {
    expect(await subtitleTracks(fixture('subs.mp4'))).toEqual([
      { codec: 'tx3g', language: 'eng', text: true },
    ]);
  });

  it('finds SRT in Matroska', async () => {
    expect(await subtitleTracks(fixture('subs.mkv'))).toEqual([
      { codec: 'S_TEXT/UTF8', language: 'eng', text: true },
    ]);
  });

  it('finds WebVTT in WebM', async () => {
    const tracks = await subtitleTracks(fixture('subs.webm'));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.codec).toBe('D_WEBVTT/SUBTITLES');
  });

  it('reports none for files without subtitles', async () => {
    for (const name of ['clip.mp4', 'clip.mkv', 'clip.webm', 'clip.mov', 'tone.mp3'])
      expect(await subtitleTracks(fixture(name))).toEqual([]);
  });
});
