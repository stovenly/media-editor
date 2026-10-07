// The video project: a main track played in order, an overlay track, a music track and timed redactions.
import type { Cue } from '../captions/cues';
import { newId } from './audio';
import type { Rect } from './image-edit';
import { NO_CAPTIONS, TITLE_STYLE, type Captions, type ProjectFont, type TextClip } from './text';

export type AssetKind = 'video' | 'image' | 'audio';

export type VideoAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  duration: number; // seconds; images use STILL_SECONDS on the main track
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
};

export type Transform = {
  crop: Rect | null;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
};

export type MainClip = {
  id: string;
  assetId: string;
  in: number; // seconds into the source
  out: number;
  speed: number; // 0.25..4
  volume: number; // linear
  muted: boolean;
  fadeIn: number; // seconds, from black and silence
  fadeOut: number;
  transition: number; // seconds of crossfade into the next clip
  transform: Transform;
};

export type OverlayClip = {
  id: string;
  assetId: string;
  start: number; // timeline seconds
  in: number;
  out: number;
  rect: Rect; // fractions of the output frame
  opacity: number; // 0..1
};

export type MusicClip = {
  id: string;
  assetId: string;
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duck: boolean; // lowered while main clips have sound
};

export type TimedRedaction = {
  id: string;
  rect: Rect; // fractions of the output frame
  from: number;
  to: number;
  kind: 'fill' | 'blur' | 'pixelate';
  color: string;
};

export type VideoProject = {
  width: number;
  height: number;
  fps: number;
  fit: 'contain' | 'cover'; // letterbox, or crop to fill
  background: string;
  main: MainClip[];
  overlay: OverlayClip[];
  music: MusicClip[];
  redactions: TimedRedaction[];
  texts: TextClip[];
  captions: Captions;
  fonts: ProjectFont[];
};

export const STILL_SECONDS = 3;
export const IDENTITY: Transform = { crop: null, rotate: 0, flipH: false, flipV: false };

export const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '4:3': [1440, 1080],
} as const;

export function mainLength(clip: MainClip): number {
  return (clip.out - clip.in) / clip.speed;
}

// Start time of each main clip on the timeline; a transition overlaps a clip with the one before it.
export function layout(project: VideoProject): { clip: MainClip; start: number; end: number }[] {
  let at = 0;
  return project.main.map((clip, index) => {
    const previous = project.main[index - 1];
    const overlap = previous
      ? Math.min(previous.transition, mainLength(previous) / 2, mainLength(clip) / 2)
      : 0;
    const start = Math.max(0, at - overlap);
    const end = start + mainLength(clip);
    at = end;
    return { clip, start, end };
  });
}

export function videoDuration(project: VideoProject): number {
  const placed = layout(project);
  let end = placed.at(-1)?.end ?? 0;
  for (const o of project.overlay) end = Math.max(end, o.start + (o.out - o.in));
  for (const t of project.texts) end = Math.max(end, t.start + t.duration);
  for (const c of project.captions.cues) end = Math.max(end, c.end);
  return end;
}

export function newVideoProject(first: VideoAsset | undefined): VideoProject {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const width = first?.hasVideo ? even(first.width) : 1920;
  const height = first?.hasVideo ? even(first.height) : 1080;
  return {
    width,
    height,
    fps: 30,
    fit: 'contain',
    background: '#000000',
    main: [],
    overlay: [],
    music: [],
    redactions: [],
    texts: [],
    captions: NO_CAPTIONS,
    fonts: [],
  };
}

export function newMainClip(asset: VideoAsset): MainClip {
  return {
    id: newId('clip'),
    assetId: asset.id,
    in: 0,
    out: asset.kind === 'image' ? STILL_SECONDS : asset.duration,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transition: 0,
    transform: IDENTITY,
  };
}

export function appendMain(project: VideoProject, asset: VideoAsset): VideoProject {
  return { ...project, main: [...project.main, newMainClip(asset)] };
}

export function addOverlay(project: VideoProject, asset: VideoAsset, start: number): VideoProject {
  const aspect = asset.width / Math.max(1, asset.height) / (project.width / project.height);
  const width = 0.3;
  const height = Math.min(1, width / aspect);
  const clip: OverlayClip = {
    id: newId('overlay'),
    assetId: asset.id,
    start,
    in: 0,
    out: asset.kind === 'image' ? STILL_SECONDS : asset.duration,
    rect: { x: 1 - width - 0.03, y: 0.03, width, height },
    opacity: 1,
  };
  return { ...project, overlay: [...project.overlay, clip] };
}

export function addMusic(project: VideoProject, asset: VideoAsset, start: number): VideoProject {
  const clip: MusicClip = {
    id: newId('music'),
    assetId: asset.id,
    start,
    in: 0,
    out: asset.duration,
    volume: 0.5,
    fadeIn: 1,
    fadeOut: 2,
    duck: true,
  };
  return { ...project, music: [...project.music, clip] };
}

export function updateMain(
  project: VideoProject,
  id: string,
  patch: Partial<MainClip>,
): VideoProject {
  return { ...project, main: project.main.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function updateOverlay(
  project: VideoProject,
  id: string,
  patch: Partial<OverlayClip>,
): VideoProject {
  return {
    ...project,
    overlay: project.overlay.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

export function updateMusic(
  project: VideoProject,
  id: string,
  patch: Partial<MusicClip>,
): VideoProject {
  return { ...project, music: project.music.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function removeAny(project: VideoProject, id: string): VideoProject {
  return {
    ...project,
    main: project.main.filter((c) => c.id !== id),
    overlay: project.overlay.filter((c) => c.id !== id),
    music: project.music.filter((c) => c.id !== id),
    redactions: project.redactions.filter((r) => r.id !== id),
    texts: project.texts.filter((t) => t.id !== id),
    captions: { ...project.captions, cues: project.captions.cues.filter((c) => c.id !== id) },
  };
}

export function addText(project: VideoProject, start: number, text = 'Your text'): VideoProject {
  const clip: TextClip = {
    id: newId('text'),
    text,
    start,
    duration: 3,
    fadeIn: 0.3,
    fadeOut: 0.3,
    style: project.texts.at(-1)?.style ?? TITLE_STYLE,
  };
  return { ...project, texts: [...project.texts, clip] };
}

export function updateText(
  project: VideoProject,
  id: string,
  patch: Partial<TextClip>,
): VideoProject {
  return { ...project, texts: project.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function updateCaptions(project: VideoProject, patch: Partial<Captions>): VideoProject {
  return { ...project, captions: { ...project.captions, ...patch } };
}

export function updateCue(project: VideoProject, id: string, patch: Partial<Cue>): VideoProject {
  const cues = project.captions.cues
    .map((c) => (c.id === id ? { ...c, ...patch } : c))
    .sort((a, b) => a.start - b.start);
  return updateCaptions(project, { cues });
}

// Fills in fields added after a project was saved.
export function normalizeVideoProject(project: VideoProject): VideoProject {
  return {
    ...project,
    texts: project.texts ?? [],
    captions: { ...NO_CAPTIONS, ...project.captions },
    fonts: project.fonts ?? [],
  };
}

// Splits the main clip under `time` into two at that point.
export function splitMain(project: VideoProject, time: number): VideoProject {
  const placed = layout(project).find((p) => time > p.start + 0.02 && time < p.end - 0.02);
  if (!placed) return project;
  const { clip, start } = placed;
  const cut = clip.in + (time - start) * clip.speed;
  const first = { ...clip, out: cut, fadeOut: 0, transition: 0 };
  const second = { ...clip, id: newId('clip'), in: cut, fadeIn: 0 };
  const index = project.main.indexOf(clip);
  return {
    ...project,
    main: [...project.main.slice(0, index), first, second, ...project.main.slice(index + 1)],
  };
}

export function moveMain(project: VideoProject, id: string, toIndex: number): VideoProject {
  const from = project.main.findIndex((c) => c.id === id);
  if (from < 0) return project;
  const main = [...project.main];
  const [clip] = main.splice(from, 1);
  main.splice(Math.max(0, Math.min(main.length, toIndex)), 0, clip!);
  return { ...project, main };
}

// Main clips visible at `time` with their source times, in drawing order. During a transition the incoming
// clip is drawn over the outgoing one with `alpha` rising from 0 to 1.
export function mainAt(
  project: VideoProject,
  time: number,
): { clip: MainClip; source: number; alpha: number }[] {
  const out: { clip: MainClip; source: number; alpha: number }[] = [];
  const placed = layout(project);
  placed.forEach((p, index) => {
    if (time < p.start || time >= p.end) return;
    const previous = placed[index - 1];
    const alpha =
      previous && time < previous.end
        ? (time - p.start) / Math.max(0.001, previous.end - p.start)
        : 1;
    out.push({ clip: p.clip, source: p.clip.in + (time - p.start) * p.clip.speed, alpha });
  });
  return out;
}

// The source ranges of a cut-only edit of one video, which can be exported by copying packets.
export function copyableCuts(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
): { assetId: string; ranges: { in: number; out: number }[] } | null {
  const first = project.main[0];
  const asset = first && assets.get(first.assetId);
  if (!first || !asset || asset.kind !== 'video') return null;
  if (project.overlay.length || project.music.length || project.texts.length) return null;
  if (project.redactions.length || (project.captions.burn && project.captions.cues.length))
    return null;
  if (project.width !== Math.round(asset.width / 2) * 2) return null;
  if (project.height !== Math.round(asset.height / 2) * 2) return null;
  const plain = project.main.every(
    (c) =>
      c.assetId === first.assetId &&
      c.speed === 1 &&
      c.volume === 1 &&
      !c.muted &&
      c.fadeIn === 0 &&
      c.fadeOut === 0 &&
      c.transition === 0 &&
      c.transform.crop === null &&
      c.transform.rotate === 0 &&
      !c.transform.flipH &&
      !c.transform.flipV,
  );
  return plain
    ? { assetId: first.assetId, ranges: project.main.map((c) => ({ in: c.in, out: c.out })) }
    : null;
}
