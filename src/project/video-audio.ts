// The sound of a video project, as an audio project the audio renderer can play and export.
import type { AudioClip, AudioProject } from './audio';
import { clipEnd, type VideoAsset, type VideoProject } from './video';

export function soundOf(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
): AudioProject {
  // A clip fading in over the tail of another one crossfades their sound too.
  const main: AudioClip[] = [];
  for (const clip of project.main) {
    const asset = assets.get(clip.assetId);
    if (!asset?.hasAudio || clip.muted) continue;
    const end = clipEnd(clip);
    let fadeOut = clip.fadeOut;
    for (const next of project.main) {
      if (next.id !== clip.id && next.fadeIn > 0 && next.start > clip.start && next.start < end)
        fadeOut = Math.max(fadeOut, end - next.start);
    }
    main.push({
      id: clip.id,
      assetId: clip.assetId,
      start: clip.start,
      in: clip.in,
      out: clip.out,
      gain: clip.volume,
      fadeIn: clip.fadeIn,
      fadeOut,
      speed: clip.speed,
    });
  }
  for (const overlay of project.overlay) {
    if (!assets.get(overlay.assetId)?.hasAudio || overlay.muted) continue;
    main.push({
      id: overlay.id,
      assetId: overlay.assetId,
      start: overlay.start,
      in: overlay.in,
      out: overlay.out,
      gain: overlay.volume,
      fadeIn: 0,
      fadeOut: 0,
    });
  }
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
    gain: project.gain ?? 1,
  };
}
