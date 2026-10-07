import { describe, expect, it } from 'vitest';
import {
  addText,
  appendMain,
  copyableCuts,
  removeAny,
  layout,
  mainAt,
  moveMain,
  newVideoProject,
  splitMain,
  updateMain,
  videoDuration,
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
  hasAudio: false,
  hasVideo: true,
};

function twoClips() {
  return appendMain(appendMain(newVideoProject(CLIP), CLIP), STILL);
}

describe('video project', () => {
  it('takes its shape from the first clip and lays clips end to end', () => {
    const project = twoClips();
    expect([project.width, project.height]).toEqual([1280, 720]);
    expect(layout(project).map((p) => [p.start, p.end])).toEqual([
      [0, 4],
      [4, 7],
    ]);
    expect(videoDuration(project)).toBe(7);
  });

  it('overlaps clips for a crossfade and fades the incoming one in', () => {
    let project = twoClips();
    project = updateMain(project, project.main[0]!.id, { transition: 1 });
    expect(videoDuration(project)).toBe(6);
    const during = mainAt(project, 3.5);
    expect(during).toHaveLength(2);
    expect(during[1]!.alpha).toBeCloseTo(0.5);
  });

  it('accounts for speed changes', () => {
    let project = twoClips();
    project = updateMain(project, project.main[0]!.id, { speed: 2 });
    expect(layout(project)[0]!.end).toBe(2);
    expect(mainAt(project, 1)[0]!.source).toBe(2);
  });

  it('splits and reorders', () => {
    let project = splitMain(twoClips(), 1);
    expect(project.main).toHaveLength(3);
    expect([project.main[0]!.out, project.main[1]!.in]).toEqual([1, 1]);
    project = moveMain(project, project.main[2]!.id, 0);
    expect(project.main[0]!.assetId).toBe('b');
  });

  it('maps clip sound to an audio project, skipping silent and muted clips', () => {
    let project = twoClips();
    const assets = new Map([CLIP, STILL].map((a) => [a.id, a]));
    expect(soundOf(project, assets).tracks[0]!.clips).toHaveLength(1);
    project = updateMain(project, project.main[0]!.id, { muted: true });
    expect(soundOf(project, assets).tracks[0]!.clips).toHaveLength(0);
  });

  it('recognises cut-only edits of one video', () => {
    const assets = new Map([[CLIP.id, CLIP]]);
    const single = appendMain(newVideoProject(CLIP), CLIP);
    const cut = splitMain(splitMain(single, 1), 3);
    const kept = removeAny(cut, cut.main[1]!.id);
    expect(copyableCuts(kept, assets)).toEqual({
      assetId: 'a',
      ranges: [
        { in: 0, out: 1 },
        { in: 3, out: 4 },
      ],
    });
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
