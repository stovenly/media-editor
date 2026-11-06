// The video project: clips, overlays, text, music and redactions placed freely on stacked timeline layers.
import type { Cue } from '../captions/cues';
import { newId } from './audio';
import type { Rect } from './image-edit';
import { NO_CAPTIONS, TITLE_STYLE, type Captions, type ProjectFont, type TextClip } from './text';

export type AssetKind = 'video' | 'image' | 'audio';

export type VideoAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  duration: number; // seconds; images use STILL_SECONDS when placed
  width: number;
  height: number;
  fps: number; // 0 when not a video
  bitrate: number; // video bits per second; 0 when not a video or unknown
  hasAudio: boolean;
  hasVideo: boolean;
};

export type Transform = {
  crop: Rect | null;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
};

// Every timeline item sits on a layer; higher layers draw over lower ones and items on one layer never overlap.
// similarity, smoothness and spill are 0..1.
export type ChromaKey = { color: string; similarity: number; smoothness: number; spill: number };

export const DEFAULT_KEY: ChromaKey = {
  color: '#00ff00',
  similarity: 0.7,
  smoothness: 0.2,
  spill: 0.5,
};

export type MainClip = {
  id: string;
  assetId: string;
  start: number; // timeline seconds
  lane: number;
  in: number; // seconds into the source
  out: number;
  speed: number; // 0.25..4
  volume: number; // linear
  muted: boolean;
  fadeIn: number; // seconds, from whatever is beneath and from silence
  fadeOut: number;
  transform: Transform;
  key: ChromaKey | null;
};

export type OverlayClip = {
  id: string;
  assetId: string;
  start: number;
  lane: number;
  in: number;
  out: number;
  rect: Rect; // fractions of the output frame
  opacity: number; // 0..1
  key: ChromaKey | null;
  volume: number; // linear
  muted: boolean;
};

export type MusicClip = {
  id: string;
  assetId: string;
  start: number;
  lane: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duck: boolean; // lowered while clips have sound
};

export type TimedRedaction = {
  id: string;
  lane: number;
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
  gain?: number; // linear overall volume of the sound; 1 when absent
};

export type ItemKind = 'clip' | 'overlay' | 'text' | 'music' | 'redaction';

export type LaneItem = { id: string; kind: ItemKind; lane: number; start: number; end: number };

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

export function clipEnd(clip: MainClip): number {
  return clip.start + mainLength(clip);
}

export function laneItems(project: VideoProject): LaneItem[] {
  return [
    ...project.main.map((c) => ({
      id: c.id,
      kind: 'clip' as const,
      lane: c.lane,
      start: c.start,
      end: clipEnd(c),
    })),
    ...project.overlay.map((o) => ({
      id: o.id,
      kind: 'overlay' as const,
      lane: o.lane,
      start: o.start,
      end: o.start + o.out - o.in,
    })),
    ...project.texts.map((t) => ({
      id: t.id,
      kind: 'text' as const,
      lane: t.lane,
      start: t.start,
      end: t.start + t.duration,
    })),
    ...project.music.map((m) => ({
      id: m.id,
      kind: 'music' as const,
      lane: m.lane,
      start: m.start,
      end: m.start + m.out - m.in,
    })),
    ...project.redactions.map((r) => ({
      id: r.id,
      kind: 'redaction' as const,
      lane: r.lane,
      start: r.from,
      end: r.to,
    })),
  ];
}

export function laneCount(project: VideoProject): number {
  return Math.max(0, ...laneItems(project).map((i) => i.lane + 1));
}

export function videoDuration(project: VideoProject): number {
  let end = 0;
  for (const i of laneItems(project)) end = Math.max(end, i.end);
  for (const c of project.captions.cues) end = Math.max(end, c.end);
  return end;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end - 0.001 && b.start < a.end - 0.001;

function fits(
  items: LaneItem[],
  lane: number,
  span: { start: number; end: number },
  except?: string,
): boolean {
  return !items.some((i) => i.id !== except && i.lane === lane && overlaps(i, span));
}

// The lowest layer with room for `start..end`; with `onTop`, the lowest above everything the span overlaps.
export function freeLane(project: VideoProject, start: number, end: number, onTop = false): number {
  const items = laneItems(project);
  const span = { start, end };
  let lane = onTop
    ? Math.max(0, ...items.filter((i) => overlaps(i, span)).map((i) => i.lane + 1))
    : 0;
  while (!fits(items, lane, span)) lane++;
  return lane;
}

function mapLanes(
  project: VideoProject,
  lanes: (lane: number, id: string) => number,
): VideoProject {
  return {
    ...project,
    main: project.main.map((c) => ({ ...c, lane: lanes(c.lane, c.id) })),
    overlay: project.overlay.map((o) => ({ ...o, lane: lanes(o.lane, o.id) })),
    texts: project.texts.map((t) => ({ ...t, lane: lanes(t.lane, t.id) })),
    music: project.music.map((m) => ({ ...m, lane: lanes(m.lane, m.id) })),
    redactions: project.redactions.map((r) => ({ ...r, lane: lanes(r.lane, r.id) })),
  };
}

// Renumbers the layers in use to 0..n-1, so emptied layers disappear.
export function compactLanes(project: VideoProject): VideoProject {
  const used = [...new Set(laneItems(project).map((i) => i.lane))].sort((a, b) => a - b);
  if (used.every((lane, index) => lane === index)) return project;
  return mapLanes(project, (lane) => used.indexOf(lane));
}

// Moves an item to another layer. `lane` -1 makes a new bottom layer and laneCount() a new top one.
// Refuses to overlap anything already on the target layer.
export function moveToLane(project: VideoProject, id: string, lane: number): VideoProject {
  const item = laneItems(project).find((i) => i.id === id);
  if (!item || item.lane === lane) return settleItem(project, id);
  const moved =
    lane < 0
      ? mapLanes(project, (l, other) => (other === id ? 0 : l + 1))
      : mapLanes(project, (l, other) => (other === id ? lane : l));
  return compactLanes(settleItem(moved, id));
}

// Where an item dropped over others on its layer goes: the nearest start on that layer where it fits.
export function settleItem(project: VideoProject, id: string): VideoProject {
  const items = laneItems(project);
  const item = items.find((i) => i.id === id);
  if (!item || fits(items, item.lane, item, id)) return project;
  const length = item.end - item.start;
  const others = items.filter((i) => i.id !== id && i.lane === item.lane);
  const starts = [0, ...others.map((o) => o.end), ...others.map((o) => o.start - length)];
  const best = starts
    .filter((s) => s >= 0 && fits(items, item.lane, { start: s, end: s + length }, id))
    .sort((a, b) => Math.abs(a - item.start) - Math.abs(b - item.start))[0];
  return best === undefined ? project : moveItem(project, id, best);
}

// The free stretch of its layer around an item, which a move or resize may not cross.
function gap(project: VideoProject, item: LaneItem): { from: number; to: number } {
  let from = 0;
  let to = Infinity;
  for (const other of laneItems(project)) {
    if (other.id === item.id || other.lane !== item.lane) continue;
    if (other.end <= item.start + 0.001) from = Math.max(from, other.end);
    else if (other.start >= item.end - 0.001) to = Math.min(to, other.start);
  }
  return { from, to };
}

export function newVideoProject(first: VideoAsset | undefined): VideoProject {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const width = first?.hasVideo ? even(first.width) : 1920;
  const height = first?.hasVideo ? even(first.height) : 1080;
  return {
    width,
    height,
    fps: first?.fps ? Math.round(first.fps * 1000) / 1000 : 30,
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

// The densest video placed in the project, in bits per source pixel per frame.
export function sourceBitsPerPixel(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
): number {
  let most = 0;
  for (const clip of [...project.main, ...project.overlay]) {
    const a = assets.get(clip.assetId);
    if (a?.bitrate && a.fps && a.width && a.height)
      most = Math.max(most, a.bitrate / (a.width * a.height * a.fps));
  }
  return most;
}

// Places a clip after the last clip, on the lowest layer with room.
export function appendMain(project: VideoProject, asset: VideoAsset): VideoProject {
  const start = Math.max(0, ...project.main.map(clipEnd));
  const out = asset.kind === 'image' ? STILL_SECONDS : asset.duration;
  const clip: MainClip = {
    id: newId('clip'),
    assetId: asset.id,
    start,
    lane: freeLane(project, start, start + out),
    in: 0,
    out,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: IDENTITY,
    key: null,
  };
  return { ...project, main: [...project.main, clip] };
}

export function addOverlay(project: VideoProject, asset: VideoAsset, start: number): VideoProject {
  const aspect = asset.width / Math.max(1, asset.height) / (project.width / project.height);
  const width = 0.3;
  const height = Math.min(1, width / aspect);
  const out = asset.kind === 'image' ? STILL_SECONDS : asset.duration;
  const clip: OverlayClip = {
    id: newId('overlay'),
    assetId: asset.id,
    start,
    lane: freeLane(project, start, start + out, true),
    in: 0,
    out,
    rect: { x: 1 - width - 0.03, y: 0.03, width, height },
    opacity: 1,
    key: null,
    volume: 1,
    muted: false,
  };
  return { ...project, overlay: [...project.overlay, clip] };
}

export function addMusic(project: VideoProject, asset: VideoAsset, start: number): VideoProject {
  const clip: MusicClip = {
    id: newId('music'),
    assetId: asset.id,
    start,
    lane: freeLane(project, start, start + asset.duration),
    in: 0,
    out: asset.duration,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    duck: false,
  };
  return { ...project, music: [...project.music, clip] };
}

// Preview only: just one layer's pictures. Burned-in captions belong to no layer, so they go too.
export function seeOnlyLane(project: VideoProject, lane: number): VideoProject {
  return {
    ...project,
    main: project.main.filter((c) => c.lane === lane),
    overlay: project.overlay.filter((o) => o.lane === lane),
    texts: project.texts.filter((t) => t.lane === lane),
    redactions: project.redactions.filter((r) => r.lane === lane),
    captions: { ...project.captions, burn: false },
  };
}

// Preview only: just one layer's sound.
export function hearOnlyLane(project: VideoProject, lane: number): VideoProject {
  return {
    ...project,
    main: project.main.map((c) => (c.lane === lane ? c : { ...c, muted: true })),
    overlay: project.overlay.map((o) => (o.lane === lane ? o : { ...o, muted: true })),
    music: project.music.filter((m) => m.lane === lane),
  };
}

// A copy of an item, placed right after it on the same layer, or on the lowest layer with room there.
export function duplicateItem(
  project: VideoProject,
  id: string,
): { project: VideoProject; id: string } | null {
  const item = laneItems(project).find((i) => i.id === id);
  if (!item) return null;
  const length = item.end - item.start;
  const start = item.end;
  const items = laneItems(project);
  const lane = fits(items, item.lane, { start, end: start + length })
    ? item.lane
    : freeLane(project, start, start + length);
  const copy = newId(item.kind === 'redaction' ? 'redact' : item.kind);
  const place = <T extends { id: string }>(list: T[], patch: (it: T) => Partial<T>) => {
    const original = list.find((it) => it.id === id)!;
    return [...list, { ...original, ...patch(original), id: copy }];
  };
  const next = (() => {
    switch (item.kind) {
      case 'clip':
        return { ...project, main: place(project.main, () => ({ start, lane })) };
      case 'overlay':
        return { ...project, overlay: place(project.overlay, () => ({ start, lane })) };
      case 'music':
        return { ...project, music: place(project.music, () => ({ start, lane })) };
      case 'text':
        return { ...project, texts: place(project.texts, () => ({ start, lane })) };
      case 'redaction':
        return {
          ...project,
          redactions: place(project.redactions, () => ({ from: start, to: start + length, lane })),
        };
    }
  })();
  return { project: next, id: copy };
}

export function addText(project: VideoProject, start: number, text = 'Your text'): VideoProject {
  const clip: TextClip = {
    id: newId('text'),
    text,
    start,
    duration: 3,
    lane: freeLane(project, start, start + 3, true),
    rect: { x: 0.1, y: 0.4, width: 0.8, height: 0.2 },
    fadeIn: 0,
    fadeOut: 0,
    style: project.texts.at(-1)?.style ?? TITLE_STYLE,
  };
  return { ...project, texts: [...project.texts, clip] };
}

export function addRedaction(
  project: VideoProject,
  rect: Rect,
  from: number,
  to: number,
): { project: VideoProject; id: string } {
  const redaction: TimedRedaction = {
    id: newId('redact'),
    lane: freeLane(project, from, to, true),
    rect,
    from,
    to,
    kind: 'fill',
    color: '#000000',
  };
  return {
    project: { ...project, redactions: [...project.redactions, redaction] },
    id: redaction.id,
  };
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

export function updateRedaction(
  project: VideoProject,
  id: string,
  patch: Partial<TimedRedaction>,
): VideoProject {
  return {
    ...project,
    redactions: project.redactions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
}

export function updateText(
  project: VideoProject,
  id: string,
  patch: Partial<TextClip>,
): VideoProject {
  return { ...project, texts: project.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function removeAny(project: VideoProject, id: string): VideoProject {
  return compactLanes({
    ...project,
    main: project.main.filter((c) => c.id !== id),
    overlay: project.overlay.filter((c) => c.id !== id),
    music: project.music.filter((c) => c.id !== id),
    redactions: project.redactions.filter((r) => r.id !== id),
    texts: project.texts.filter((t) => t.id !== id),
    captions: { ...project.captions, cues: project.captions.cues.filter((c) => c.id !== id) },
  });
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

// Splits the item `id` at `time`, or when that isn't under the playhead, the topmost item that is.
// What a split at `time` cuts: the item `id` when it is under the playhead, else the topmost item that is.
export function splitTarget(
  project: VideoProject,
  time: number,
  id: string | null,
): LaneItem | null {
  const under = laneItems(project)
    .filter((i) => time > i.start + 0.02 && time < i.end - 0.02)
    .sort((a, b) => b.lane - a.lane);
  return under.find((i) => i.id === id) ?? under[0] ?? null;
}

export function splitAt(project: VideoProject, time: number, id: string | null): VideoProject {
  const item = splitTarget(project, time, id);
  if (!item) return project;
  const offset = time - item.start;
  const cut = <T extends { id: string }>(list: T[], halves: (it: T) => [T, T]) =>
    list.flatMap((it) => (it.id === item.id ? halves(it) : [it]));
  switch (item.kind) {
    case 'clip':
      return {
        ...project,
        main: cut(project.main, (c) => {
          const at = c.in + offset * c.speed;
          return [
            { ...c, out: at, fadeOut: 0 },
            { ...c, id: newId('clip'), start: time, in: at, fadeIn: 0 },
          ];
        }),
      };
    case 'overlay':
      return {
        ...project,
        overlay: cut(project.overlay, (o) => [
          { ...o, out: o.in + offset },
          { ...o, id: newId('overlay'), start: time, in: o.in + offset },
        ]),
      };
    case 'music':
      return {
        ...project,
        music: cut(project.music, (m) => [
          { ...m, out: m.in + offset, fadeOut: 0 },
          { ...m, id: newId('music'), start: time, in: m.in + offset, fadeIn: 0 },
        ]),
      };
    case 'text':
      return {
        ...project,
        texts: cut(project.texts, (t) => [
          { ...t, duration: offset, fadeOut: 0 },
          { ...t, id: newId('text'), start: time, duration: t.duration - offset, fadeIn: 0 },
        ]),
      };
    case 'redaction':
      return {
        ...project,
        redactions: cut(project.redactions, (r) => [
          { ...r, to: time },
          { ...r, id: newId('redact'), from: time },
        ]),
      };
  }
}

export type Visual =
  | { kind: 'clip'; clip: MainClip; source: number; alpha: number }
  | { kind: 'overlay'; overlay: OverlayClip; source: number }
  | { kind: 'text'; text: TextClip; alpha: number }
  | { kind: 'redaction'; redaction: TimedRedaction };

// What is visible at `time`, bottom layer first. `alpha` folds in the fades.
export function visualsAt(project: VideoProject, time: number): Visual[] {
  const fade = (local: number, length: number, fadeIn: number, fadeOut: number) => {
    let alpha = 1;
    if (fadeIn > 0 && local < fadeIn) alpha *= local / fadeIn;
    if (fadeOut > 0 && local > length - fadeOut) alpha *= (length - local) / fadeOut;
    return Math.max(0, Math.min(1, alpha));
  };
  const placed: { lane: number; visual: Visual }[] = [];
  for (const clip of project.main) {
    const local = time - clip.start;
    const length = mainLength(clip);
    if (local < 0 || local >= length) continue;
    placed.push({
      lane: clip.lane,
      visual: {
        kind: 'clip',
        clip,
        source: clip.in + local * clip.speed,
        alpha: fade(local, length, clip.fadeIn, clip.fadeOut),
      },
    });
  }
  for (const overlay of project.overlay) {
    const local = time - overlay.start;
    if (local < 0 || local >= overlay.out - overlay.in) continue;
    placed.push({
      lane: overlay.lane,
      visual: { kind: 'overlay', overlay, source: overlay.in + local },
    });
  }
  for (const text of project.texts) {
    const local = time - text.start;
    if (local < 0 || local >= text.duration) continue;
    placed.push({
      lane: text.lane,
      visual: { kind: 'text', text, alpha: fade(local, text.duration, text.fadeIn, text.fadeOut) },
    });
  }
  for (const redaction of project.redactions) {
    if (time < redaction.from || time >= redaction.to) continue;
    placed.push({ lane: redaction.lane, visual: { kind: 'redaction', redaction } });
  }
  return placed.sort((a, b) => a.lane - b.lane).map((p) => p.visual);
}

// The project as exported: empty time before the first item is dropped, so trimming the start of the first
// clip trims the export too.
export function fromFirstItem(project: VideoProject): VideoProject {
  const starts = [
    ...laneItems(project).map((i) => i.start),
    ...project.captions.cues.map((c) => c.start),
  ];
  const offset = starts.length ? Math.min(...starts) : 0;
  if (offset <= 0) return project;
  return {
    ...project,
    main: project.main.map((c) => ({ ...c, start: c.start - offset })),
    overlay: project.overlay.map((o) => ({ ...o, start: o.start - offset })),
    texts: project.texts.map((t) => ({ ...t, start: t.start - offset })),
    music: project.music.map((m) => ({ ...m, start: m.start - offset })),
    redactions: project.redactions.map((r) => ({ ...r, from: r.from - offset, to: r.to - offset })),
    captions: {
      ...project.captions,
      cues: project.captions.cues.map((c) => ({
        ...c,
        start: c.start - offset,
        end: c.end - offset,
      })),
    },
  };
}

// The source ranges of a cut-only edit of one video, which can be exported by copying packets.
export function copyableCuts(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
): { assetId: string; ranges: { in: number; out: number }[] } | null {
  const clips = [...project.main].sort((a, b) => a.start - b.start);
  const first = clips[0];
  const asset = first && assets.get(first.assetId);
  if (!first || !asset || asset.kind !== 'video') return null;
  if (project.overlay.length || project.music.length || project.texts.length) return null;
  if ((project.gain ?? 1) !== 1) return null;
  if (project.redactions.length || (project.captions.burn && project.captions.cues.length))
    return null;
  if (project.width !== Math.round(asset.width / 2) * 2) return null;
  if (project.height !== Math.round(asset.height / 2) * 2) return null;
  const back = (c: MainClip, i: number) =>
    Math.abs(c.start - (i ? clipEnd(clips[i - 1]!) : 0)) < 0.001;
  const plain = clips.every(
    (c, i) =>
      back(c, i) &&
      c.assetId === first.assetId &&
      c.speed === 1 &&
      c.volume === 1 &&
      !c.muted &&
      c.fadeIn === 0 &&
      c.fadeOut === 0 &&
      !c.key &&
      c.transform.crop === null &&
      c.transform.rotate === 0 &&
      !c.transform.flipH &&
      !c.transform.flipV,
  );
  return plain
    ? { assetId: first.assetId, ranges: clips.map((c) => ({ in: c.in, out: c.out })) }
    : null;
}

// Slides an item to `start`, stopping at its neighbours on the layer. Captions move freely.
// Moves freely, even over other items; settleItem finds it room once it is dropped.
export function moveItem(project: VideoProject, id: string, start: number): VideoProject {
  const item = laneItems(project).find((i) => i.id === id);
  if (!item) {
    const cue = project.captions.cues.find((c) => c.id === id);
    if (!cue) return project;
    const at = Math.max(0, start);
    return updateCue(project, id, { start: at, end: at + cue.end - cue.start });
  }
  const length = item.end - item.start;
  const at = Math.max(0, start);
  switch (item.kind) {
    case 'clip':
      return updateMain(project, id, { start: at });
    case 'overlay':
      return updateOverlay(project, id, { start: at });
    case 'music':
      return updateMusic(project, id, { start: at });
    case 'text':
      return updateText(project, id, { start: at });
    case 'redaction':
      return updateRedaction(project, id, { from: at, to: at + length });
  }
}

const MIN_LENGTH = 0.1; // seconds
const STILL_LIMIT = 3600; // seconds an image may be stretched to

// Drags one edge of an item to `time` (timeline seconds). Media can't stretch past its source, and nothing
// can stretch over its neighbours on the layer.
export function resizeItem(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
  id: string,
  edge: 'start' | 'end',
  time: number,
): VideoProject {
  const limit = (assetId: string) => {
    const asset = assets.get(assetId);
    return !asset || asset.kind === 'image' ? STILL_LIMIT : asset.duration;
  };
  const item = laneItems(project).find((i) => i.id === id);
  if (!item) {
    const cue = project.captions.cues.find((c) => c.id === id);
    if (!cue) return project;
    return edge === 'end'
      ? updateCue(project, id, { end: Math.max(cue.start + MIN_LENGTH, time) })
      : updateCue(project, id, { start: Math.max(0, Math.min(cue.end - MIN_LENGTH, time)) });
  }
  const { from, to } = gap(project, item);
  time = Math.max(from, Math.min(to, time));
  if (edge === 'end') time = Math.max(item.start + MIN_LENGTH, time);
  else time = Math.min(item.end - MIN_LENGTH, time);

  if (item.kind === 'text' || item.kind === 'redaction') {
    const start = edge === 'start' ? time : item.start;
    const end = edge === 'end' ? time : item.end;
    return item.kind === 'text'
      ? updateText(project, id, { start, duration: end - start })
      : updateRedaction(project, id, { from: start, to: end });
  }
  const clip =
    project.main.find((c) => c.id === id) ??
    project.overlay.find((c) => c.id === id) ??
    project.music.find((c) => c.id === id)!;
  const speed = 'speed' in clip ? clip.speed : 1;
  const update = (patch: { start?: number; in?: number; out?: number }) =>
    item.kind === 'clip'
      ? updateMain(project, id, patch)
      : item.kind === 'overlay'
        ? updateOverlay(project, id, patch)
        : updateMusic(project, id, patch);
  if (edge === 'end')
    return update({ out: Math.min(limit(clip.assetId), clip.in + (time - item.start) * speed) });
  // Moving the start edge trims the source too, so the rest stays where it is on the timeline.
  const shift = Math.max(-clip.in / speed, time - item.start);
  return update({ start: item.start + shift, in: clip.in + shift * speed });
}
