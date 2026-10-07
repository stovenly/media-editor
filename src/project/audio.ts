// The audio project: tracks of clips on a timeline, plus whole-mix processing. Times are in seconds.
import type { ChannelOp } from '../engine/audio/dsp';

export type AudioClip = {
  id: string;
  assetId: string;
  start: number; // on the timeline
  in: number; // into the source
  out: number; // into the source
  gain: number; // linear, 1 = unity
  fadeIn: number;
  fadeOut: number;
  speed?: number; // source seconds per timeline second, pitch kept; 1 when absent
};

// `duck` lowers the track while any other unmuted track is sounding.
export type AudioTrack = {
  id: string;
  clips: AudioClip[];
  gain: number;
  muted: boolean;
  duck?: boolean;
};

export type Normalize =
  { mode: 'off' } | { mode: 'peak'; db: number } | { mode: 'lufs'; target: number };

export type AudioProject = {
  tracks: AudioTrack[];
  sampleRate: number; // Hz
  channels: 1 | 2;
  channelOp: ChannelOp;
  normalize: Normalize;
  trimSilence: boolean;
  speed: number; // 0.5..2, pitch kept
};

export type AudioAssetInfo = {
  id: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
};

let counter = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function clipLength(clip: AudioClip): number {
  return (clip.out - clip.in) / (clip.speed ?? 1);
}

export function clipEnd(clip: AudioClip): number {
  return clip.start + clipLength(clip);
}

export function projectDuration(project: AudioProject): number {
  let end = 0;
  for (const track of project.tracks)
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  return end;
}

export function newProject(assets: readonly AudioAssetInfo[]): AudioProject {
  const rate = Math.max(...assets.map((a) => a.sampleRate), 44100);
  const channels = assets.some((a) => a.channels > 1) ? 2 : 1;
  let at = 0;
  const clips = assets.map((asset) => {
    const clip: AudioClip = {
      id: newId('clip'),
      assetId: asset.id,
      start: at,
      in: 0,
      out: asset.duration,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
    };
    at += asset.duration;
    return clip;
  });
  return {
    tracks: [{ id: newId('track'), clips, gain: 1, muted: false }],
    sampleRate: Math.min(rate, 96000),
    channels,
    channelOp: 'none',
    normalize: { mode: 'off' },
    trimSilence: false,
    speed: 1,
  };
}

function mapTrack(
  project: AudioProject,
  trackId: string,
  fn: (track: AudioTrack) => AudioTrack,
): AudioProject {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function sorted(clips: AudioClip[]): AudioClip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

export function findClip(
  project: AudioProject,
  clipId: string,
): { track: AudioTrack; clip: AudioClip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function updateClip(
  project: AudioProject,
  clipId: string,
  patch: Partial<AudioClip>,
): AudioProject {
  const found = findClip(project, clipId);
  if (!found) return project;
  return mapTrack(project, found.track.id, (t) => ({
    ...t,
    clips: sorted(t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))),
  }));
}

// Splits every clip under `time` (on one track, or all) into two.
export function splitAt(project: AudioProject, time: number, trackId?: string): AudioProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      if (trackId && track.id !== trackId) return track;
      const clips = track.clips.flatMap((clip) => {
        if (time <= clip.start + 0.001 || time >= clipEnd(clip) - 0.001) return [clip];
        const cut = clip.in + (time - clip.start);
        return [
          { ...clip, out: cut, fadeOut: 0 },
          { ...clip, id: newId('clip'), start: time, in: cut, fadeIn: 0 },
        ];
      });
      return { ...track, clips };
    }),
  };
}

// Removes [from, to) from the timeline, closing the gap on the affected tracks.
export function deleteRange(
  project: AudioProject,
  from: number,
  to: number,
  trackIds?: readonly string[],
): AudioProject {
  const length = to - from;
  if (length <= 0) return project;
  const split = splitAt(splitAt(project, from), to);
  return {
    ...split,
    tracks: split.tracks.map((track) => {
      if (trackIds && !trackIds.includes(track.id)) return track;
      const clips = track.clips
        .filter((clip) => !(clip.start >= from - 0.0005 && clipEnd(clip) <= to + 0.0005))
        .map((clip) =>
          clip.start >= to - 0.0005 ? { ...clip, start: clip.start - length } : clip,
        );
      return { ...track, clips };
    }),
  };
}

// Pushes everything at or after `at` later by `seconds` on every track.
export function insertSilence(project: AudioProject, at: number, seconds: number): AudioProject {
  const split = splitAt(project, at);
  return {
    ...split,
    tracks: split.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        clip.start >= at - 0.0005 ? { ...clip, start: clip.start + seconds } : clip,
      ),
    })),
  };
}

export function moveClip(
  project: AudioProject,
  clipId: string,
  start: number,
  trackId?: string,
): AudioProject {
  const found = findClip(project, clipId);
  if (!found) return project;
  const moved = { ...found.clip, start: Math.max(0, start) };
  const target = trackId ?? found.track.id;
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      const others = track.clips.filter((c) => c.id !== clipId);
      return { ...track, clips: sorted(track.id === target ? [...others, moved] : others) };
    }),
  };
}

// Keeps the source position under the edge fixed: trimming the start moves both `start` and `in`.
export function trimClip(
  project: AudioProject,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
  sourceDuration: number,
): AudioProject {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { clip } = found;
  if (edge === 'start') {
    const delta = Math.max(-clip.in, Math.min(time - clip.start, clipLength(clip) - 0.01));
    return updateClip(project, clipId, { start: clip.start + delta, in: clip.in + delta });
  }
  const out = Math.min(sourceDuration, Math.max(clip.in + 0.01, clip.in + (time - clip.start)));
  return updateClip(project, clipId, { out });
}

export function removeClip(project: AudioProject, clipId: string): AudioProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })),
  };
}

export function addTrack(
  project: AudioProject,
  asset: AudioAssetInfo,
  start: number,
): AudioProject {
  const clip: AudioClip = {
    id: newId('clip'),
    assetId: asset.id,
    start,
    in: 0,
    out: asset.duration,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
  };
  return {
    ...project,
    tracks: [...project.tracks, { id: newId('track'), clips: [clip], gain: 1, muted: false }],
  };
}

export function appendToTrack(
  project: AudioProject,
  trackId: string,
  asset: AudioAssetInfo,
): AudioProject {
  return mapTrack(project, trackId, (track) => {
    const end = track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
    const clip: AudioClip = {
      id: newId('clip'),
      assetId: asset.id,
      start: end,
      in: 0,
      out: asset.duration,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
    };
    return { ...track, clips: [...track.clips, clip] };
  });
}

// Overlaps adjacent clips on a track by `seconds` and fades across the overlap.
export function crossfade(project: AudioProject, leftId: string, seconds: number): AudioProject {
  const found = findClip(project, leftId);
  if (!found) return project;
  const clips = sorted(found.track.clips);
  const index = clips.findIndex((c) => c.id === leftId);
  const right = clips[index + 1];
  if (!right) return project;
  const overlap = Math.min(seconds, clipLength(found.clip) / 2, clipLength(right) / 2);
  const shift = clipEnd(found.clip) - overlap - right.start;
  return mapTrack(project, found.track.id, (track) => ({
    ...track,
    clips: track.clips.map((c) => {
      if (c.id === leftId) return { ...c, fadeOut: overlap };
      if (c.start >= right.start)
        return { ...c, start: c.start + shift, fadeIn: c.id === right.id ? overlap : c.fadeIn };
      return c;
    }),
  }));
}
