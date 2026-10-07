// The sound of a video project, as an audio project the audio renderer can play and export.
import type { AudioClip, AudioProject } from './audio';
import { layout, type VideoAsset, type VideoProject } from './video';

export function soundOf(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
): AudioProject {
  const main: AudioClip[] = [];
  const placed = layout(project);
  placed.forEach(({ clip, start }, index) => {
    const asset = assets.get(clip.assetId);
    if (!asset?.hasAudio || clip.muted) return;
    const previous = placed[index - 1];
    const next = placed[index + 1];
    const fadeIn = Math.max(clip.fadeIn, previous ? previous.end - start : 0);
    const fadeOut = Math.max(clip.fadeOut, next ? placed[index]!.end - next.start : 0);
    main.push({
      id: clip.id,
      assetId: clip.assetId,
      start,
      in: clip.in,
      out: clip.out,
      gain: clip.volume,
      fadeIn,
      fadeOut,
      speed: clip.speed,
    });
  });
  const music: AudioClip[] = project.music.map((m) => ({
    id: m.id,
    assetId: m.assetId,
    start: m.start,
    in: m.in,
    out: m.out,
    gain: m.volume,
    fadeIn: m.fadeIn,
    fadeOut: m.fadeOut,
  }));
  const duck = project.music.some((m) => m.duck);
  return {
    tracks: [
      { id: 'main', clips: main, gain: 1, muted: false },
      { id: 'music', clips: music, gain: 1, muted: false, duck },
    ],
    sampleRate: 48000,
    channels: 2,
    channelOp: 'none',
    normalize: { mode: 'off' },
    trimSilence: false,
    speed: 1,
  };
}
