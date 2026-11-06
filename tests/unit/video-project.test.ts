import { describe, expect, it } from 'vitest';
import {
  addMusic,
  addOverlay,
  addRedaction,
  addText,
  appendMain,
  clipEnd,
  copyableCuts,
  duplicateItem,
  fromFirstItem,
  resizeItem,
  laneCount,
  moveItem,
  moveToLane,
  newVideoProject,
  removeAny,
  splitAt,
  updateMain,
  videoDuration,
  visualsAt,
  type VideoAsset,
} from '../../src/project/video';
import { soundOf } from '../../src/project/video-audio';

const CLIP: VideoAsset = {
  id: 'a',
  name: 'a.mp4',
  kind: 'video',
  duration: 4,
  width: 1280,
  height: 720,
  fps: 0,
  bitrate: 0,
  hasAudio: true,
  hasVideo: true,
};
const STILL: VideoAsset = {
  id: 'b',
  name: 'b.png',
  kind: 'image',
  duration: 0,
  width: 800,
  height: 800,
  fps: 0,
  bitrate: 0,
  hasAudio: false,
  hasVideo: true,
};

function twoClips() {
  return appendMain(appendMain(newVideoProject(CLIP), CLIP), STILL);
}

describe('video project', () => {
  it('takes its shape from the first clip and places added clips one after another', () => {
    const project = twoClips();
    expect([project.width, project.height]).toEqual([1280, 720]);
    expect(project.main.map((c) => [c.start, clipEnd(c), c.lane])).toEqual([
      [0, 4, 0],
      [4, 7, 0],
    ]);
    expect(videoDuration(project)).toBe(7);
  });

  it('keeps the frame rate of the first clip', () => {
    expect(newVideoProject({ ...CLIP, fps: 24000 / 1001 }).fps).toBe(23.976);
    expect(newVideoProject(CLIP).fps).toBe(30);
  });

  it('accounts for speed changes', () => {
    let project = twoClips();
    project = updateMain(project, project.main[0]!.id, { speed: 2 });
    expect(clipEnd(project.main[0]!)).toBe(2);
    const [first] = visualsAt(project, 1);
    expect(first).toMatchObject({ kind: 'clip', source: 2 });
  });

  it('splits a clip into halves that can be dragged apart', () => {
    let project = splitAt(appendMain(newVideoProject(CLIP), CLIP), 1, null);
    expect(project.main).toHaveLength(2);
    const [first, second] = project.main;
    expect([first!.out, second!.in, second!.start]).toEqual([1, 1, 1]);
    project = moveItem(project, second!.id, 2);
    expect(project.main[1]!.start).toBe(2);
    expect(visualsAt(project, 1.5)).toEqual([]);
  });

  it('lets a dragged item pass its neighbours and drop into a gap that fits', () => {
    // Clips at 0–1 and 3–4 leave a 2 s gap; a 2 s copy dragged from the end lands in it.
    let project = splitAt(appendMain(newVideoProject(CLIP), CLIP), 1, null);
    project = moveItem(project, project.main[1]!.id, 3);
    project = updateMain(project, project.main[1]!.id, { in: 3 });
    project = appendMain(project, CLIP);
    const copy = project.main[2]!.id;
    project = updateMain(project, copy, { out: 2 });
    project = moveToLane(moveItem(project, copy, 1.2), copy, 0);
    expect(project.main.find((c) => c.id === copy)).toMatchObject({ start: 1, lane: 0 });
  });

  it('puts new text on a layer above what it covers, and drops emptied layers', () => {
    let project = addText(twoClips(), 1);
    expect(project.texts[0]!.lane).toBe(1);
    expect(visualsAt(project, 2).map((v) => v.kind)).toEqual(['clip', 'text']);
    project = moveToLane(project, project.texts[0]!.id, -1);
    expect(project.texts[0]!.lane).toBe(0);
    expect(project.main[0]!.lane).toBe(1);
    expect(visualsAt(project, 2).map((v) => v.kind)).toEqual(['text', 'clip']);
    project = removeAny(project, project.texts[0]!.id);
    expect(laneCount(project)).toBe(1);
    expect(project.main[0]!.lane).toBe(0);
  });

  it('drops an item over others into the nearest room on that layer', () => {
    const project = addText(twoClips(), 1);
    const dropped = moveToLane(project, project.texts[0]!.id, 0);
    expect(dropped.texts[0]).toMatchObject({ lane: 0, start: 7 });
    const top = moveToLane(project, project.main[0]!.id, laneCount(project));
    expect(top.main.map((c) => c.lane)).toEqual([2, 0]);
    expect(top.texts[0]!.lane).toBe(1);
  });

  it('duplicates an item right after itself, or onto a free layer', () => {
    const project = twoClips();
    const after = duplicateItem(project, project.main[1]!.id)!;
    expect(after.project.main.find((c) => c.id === after.id)).toMatchObject({ start: 7, lane: 0 });
    const blocked = duplicateItem(project, project.main[0]!.id)!;
    expect(blocked.project.main.find((c) => c.id === blocked.id)).toMatchObject({
      start: 4,
      lane: 1,
    });
  });

  it('adds music at full volume with no fades or ducking', () => {
    expect(addMusic(newVideoProject(CLIP), CLIP, 0).music[0]).toMatchObject({
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      duck: false,
    });
  });

  it('covers only what is beneath a redaction', () => {
    let project = addText(twoClips(), 0);
    project = addRedaction(project, { x: 0, y: 0, width: 1, height: 1 }, 0, 2).project;
    expect(visualsAt(project, 1).map((v) => v.kind)).toEqual(['clip', 'text', 'redaction']);
  });

  it('maps clip sound to an audio project, skipping silent and muted clips', () => {
    let project = twoClips();
    const assets = new Map([CLIP, STILL].map((a) => [a.id, a]));
    expect(soundOf(project, assets).tracks[0]!.clips).toHaveLength(1);
    project = updateMain(project, project.main[0]!.id, { muted: true });
    expect(soundOf(project, assets).tracks[0]!.clips).toHaveLength(0);
  });

  it('exports a left-trimmed clip from its new start', () => {
    const assets = new Map([[CLIP.id, CLIP]]);
    const single = appendMain(newVideoProject(CLIP), CLIP);
    const trimmed = resizeItem(single, assets, single.main[0]!.id, 'start', 1);
    expect(trimmed.main[0]).toMatchObject({ start: 1, in: 1 });
    const exported = fromFirstItem(trimmed);
    expect(exported.main[0]).toMatchObject({ start: 0, in: 1, out: 4 });
    expect(videoDuration(exported)).toBe(3);
    expect(copyableCuts(exported, assets)?.ranges).toEqual([{ in: 1, out: 4 }]);
  });

  it("plays an overlay's sound unless it is muted", () => {
    const assets = new Map([[CLIP.id, CLIP]]);
    let project = addOverlay(appendMain(newVideoProject(CLIP), CLIP), CLIP, 1);
    const overlay = project.overlay[0]!;
    expect(soundOf(project, assets).tracks[0]!.clips.map((c) => [c.id, c.start])).toEqual([
      [project.main[0]!.id, 0],
      [overlay.id, 1],
    ]);
    project = { ...project, overlay: [{ ...overlay, muted: true }] };
    expect(soundOf(project, assets).tracks[0]!.clips).toHaveLength(1);
  });

  it('recognises cut-only edits of one video', () => {
    const assets = new Map([[CLIP.id, CLIP]]);
    const single = appendMain(newVideoProject(CLIP), CLIP);
    const cut = splitAt(splitAt(single, 1, null), 3, null);
    const removed = removeAny(cut, cut.main[1]!.id);
    const kept = moveItem(removed, removed.main[1]!.id, 1);
    expect(copyableCuts(kept, assets)).toEqual({
      assetId: 'a',
      ranges: [
        { in: 0, out: 1 },
        { in: 3, out: 4 },
      ],
    });
    expect(copyableCuts(removed, assets)).toBeNull();
    expect(copyableCuts(addText(kept, 0), assets)).toBeNull();
    expect(copyableCuts(updateMain(kept, kept.main[0]!.id, { speed: 2 }), assets)).toBeNull();
    expect(copyableCuts({ ...kept, width: 1920, height: 1080 }, assets)).toBeNull();
    expect(
      copyableCuts(
        twoClips(),
        new Map([
          [CLIP.id, CLIP],
          [STILL.id, STILL],
        ]),
      ),
    ).toBeNull();
  });
});
