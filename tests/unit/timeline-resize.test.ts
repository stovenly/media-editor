import { describe, expect, it } from 'vitest';
import { drawText } from '../../src/engine/video/text';
import { TITLE_STYLE } from '../../src/project/text';
import {
  addMusic,
  addText,
  appendMain,
  clipEnd,
  newVideoProject,
  resizeItem,
  type VideoAsset,
} from '../../src/project/video';

const CLIP: VideoAsset = {
  id: 'a',
  name: 'a.mp4',
  kind: 'video',
  duration: 10,
  width: 1280,
  height: 720,
  fps: 0,
  bitrate: 0,
  hasAudio: true,
  hasVideo: true,
};
const assets = new Map([[CLIP.id, CLIP]]);

describe('resizing timeline items', () => {
  it('stretches and shortens text from either edge', () => {
    const p = addText(newVideoProject(CLIP), 2);
    const id = p.texts[0]!.id;
    expect(resizeItem(p, assets, id, 'end', 9).texts[0]).toMatchObject({
      start: 2,
      duration: 7,
    });
    expect(resizeItem(p, assets, id, 'start', 1).texts[0]).toMatchObject({
      start: 1,
      duration: 4,
    });
    expect(resizeItem(p, assets, id, 'start', 8).texts[0]!.duration).toBeCloseTo(0.1);
  });

  it('trims a clip but never past its source', () => {
    const p = appendMain(newVideoProject(CLIP), CLIP);
    const id = p.main[0]!.id;
    expect(resizeItem(p, assets, id, 'end', 4).main[0]).toMatchObject({ in: 0, out: 4 });
    expect(resizeItem(p, assets, id, 'end', 30).main[0]!.out).toBe(10);
    const trimmed = resizeItem(p, assets, id, 'start', 3);
    expect(trimmed.main[0]).toMatchObject({ start: 3, in: 3, out: 10 });
    expect(clipEnd(trimmed.main[0]!)).toBe(10);
  });

  it('trims music from the start without moving the rest of it', () => {
    const p = addMusic(newVideoProject(CLIP), CLIP, 5);
    const id = p.music[0]!.id;
    const trimmed = resizeItem(p, assets, id, 'start', 7).music[0]!;
    expect(trimmed).toMatchObject({ start: 7, in: 2, out: 10 });
    expect(resizeItem(p, assets, id, 'start', 1).music[0]).toMatchObject({
      start: 5,
      in: 0,
    });
  });
});

describe('text wrapping', () => {
  // Measures 10 px per character and records the lines drawn.
  function lines(margin: number) {
    const drawn: string[] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      roundRect() {},
      fill() {},
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (s: string) => drawn.push(s),
      strokeText() {},
    } as unknown as OffscreenCanvasRenderingContext2D;
    const style = { ...TITLE_STYLE, margin, outline: 0, shadow: false, size: 0.1 };
    drawText(ctx, 'one two three four five six seven eight nine ten', style, 300, 200);
    return drawn;
  }

  it('does not change when the text is moved away from the edge', () => {
    expect(lines(0.25)).toEqual(lines(0.02));
  });
});
