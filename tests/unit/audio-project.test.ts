import { describe, expect, it } from 'vitest';
import {
  clipEnd,
  crossfade,
  deleteRange,
  insertSilence,
  newProject,
  projectDuration,
  splitAt,
  trimClip,
} from '../../src/project/audio';

const ASSETS = [
  { id: 'a', name: 'a.wav', duration: 10, sampleRate: 48000, channels: 2 },
  { id: 'b', name: 'b.wav', duration: 5, sampleRate: 44100, channels: 1 },
];

describe('audio project', () => {
  it('joins files end to end on one track', () => {
    const project = newProject(ASSETS);
    expect(project.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 10]);
    expect(projectDuration(project)).toBe(15);
    expect(project.channels).toBe(2);
    expect(project.sampleRate).toBe(48000);
  });

  it('splits a clip at the playhead, keeping the source positions', () => {
    const project = splitAt(newProject(ASSETS), 4);
    const [first, second] = project.tracks[0]!.clips;
    expect([first!.in, first!.out, second!.start, second!.in]).toEqual([0, 4, 4, 4]);
  });

  it('deletes a range and closes the gap', () => {
    const project = deleteRange(newProject(ASSETS), 8, 12);
    expect(projectDuration(project)).toBe(11);
    const clips = project.tracks[0]!.clips;
    expect(clips.map((c) => [c.start, c.in, c.out])).toEqual([
      [0, 0, 8],
      [8, 2, 5],
    ]);
  });

  it('inserts silence after the playhead', () => {
    const project = insertSilence(newProject(ASSETS), 10, 2);
    expect(project.tracks[0]!.clips[1]!.start).toBe(12);
    expect(projectDuration(project)).toBe(17);
  });

  it('trims either edge without moving the audio under it', () => {
    let project = newProject(ASSETS);
    const id = project.tracks[0]!.clips[0]!.id;
    project = trimClip(project, id, 'start', 2, 10);
    project = trimClip(project, id, 'end', 7, 10);
    const clip = project.tracks[0]!.clips[0]!;
    expect([clip.start, clip.in, clip.out, clipEnd(clip)]).toEqual([2, 2, 7, 7]);
  });

  it('crossfades adjacent clips by overlapping them', () => {
    const project = newProject(ASSETS);
    const [left] = project.tracks[0]!.clips;
    const faded = crossfade(project, left!.id, 1);
    const [a, b] = faded.tracks[0]!.clips;
    expect(a!.fadeOut).toBe(1);
    expect(b!.fadeIn).toBe(1);
    expect(b!.start).toBe(9);
  });
});
