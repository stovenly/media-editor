// Pure planning for audio and video jobs: route, codecs, bitrates, size estimates and FFmpeg arguments.
import type { AvProbe } from '../../media/probe';
import type { MetadataMode } from '../image/settings';
import { target } from '../targets';

export type AvSettings = {
  target: string;
  quality: number; // 1..100
  height: number | null;
  fps: number | null;
  removeAudio: boolean;
  audioKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
  videoCodec: string | null;
  targetBytes: number | null;
  metadata: MetadataMode;
  trimStart: number | null; // seconds
  trimEnd: number | null;
  gif: {
    fps: number;
    width: number;
    dither: 'none' | 'bayer' | 'floyd';
    palette: 'global' | 'per-frame' | 'diff' | 'gifski';
  };
  allowCopy: boolean; // streams may be copied without re-encoding when nothing about them changes
};

export type Route = 'native' | 'ffmpeg';

export type NativeContainer = 'mp4' | 'webm' | 'mov' | 'mkv' | 'mp3' | 'wav' | 'flac' | 'ogg';

export type NativeTarget = {
  container: NativeContainer;
  video?: 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';
  audio: 'aac' | 'opus' | 'mp3' | 'flac' | 'pcm-s16' | 'vorbis';
};

export const NATIVE_TARGETS: Record<string, NativeTarget> = {
  mp4: { container: 'mp4', video: 'avc', audio: 'aac' },
  mov: { container: 'mov', video: 'avc', audio: 'aac' },
  mkv: { container: 'mkv', video: 'avc', audio: 'aac' },
  webm: { container: 'webm', video: 'vp9', audio: 'opus' },
  mp3: { container: 'mp3', audio: 'mp3' },
  m4a: { container: 'mp4', audio: 'aac' },
  m4r: { container: 'mp4', audio: 'aac' },
  m4b: { container: 'mp4', audio: 'aac' },
  wav: { container: 'wav', audio: 'pcm-s16' },
  flac: { container: 'flac', audio: 'flac' },
  opus: { container: 'ogg', audio: 'opus' },
};

export const RINGTONE_SECONDS = 40;

const AUDIO_ONLY = new Set([
  'mp3',
  'm4a',
  'm4r',
  'm4b',
  'wav',
  'flac',
  'opus',
  'ogg',
  'alac',
  'aiff',
  'caf',
  'wv',
  'ac3',
  'au',
]);
const IMAGE_FROM_VIDEO = new Set(['jpeg', 'png', 'webp', 'avif', 'jxl', 'tiff']);

export function isAudioTarget(id: string): boolean {
  return AUDIO_ONLY.has(id);
}

export function isFrameTarget(id: string): boolean {
  return IMAGE_FROM_VIDEO.has(id);
}

// Where the job should start. The native path can still hand over to FFmpeg once it sees the real tracks.
export function routeAv(probe: AvProbe | undefined, settings: AvSettings): Route {
  const spec = NATIVE_TARGETS[settings.target];
  if (!probe?.native || !spec) return 'ffmpeg';
  const wantsVideo = Boolean(spec.video) && Boolean(probe.video);
  if (wantsVideo && !probe.video!.decodable) return 'ffmpeg';
  const wantsAudio = Boolean(probe.audio) && !(settings.removeAudio && wantsVideo);
  if (wantsAudio && !probe.audio!.decodable) return 'ffmpeg';
  if (!wantsVideo && !wantsAudio) return 'ffmpeg';
  if (settings.videoCodec === 'prores') return 'ffmpeg';
  return 'native';
}

const CODEC_EFFICIENCY: Record<string, number> = {
  avc: 1,
  h264: 1,
  hevc: 0.65,
  vp9: 0.7,
  av1: 0.55,
  vp8: 1.1,
  mpeg4: 1.4,
  mpeg2: 2,
  theora: 1.3,
};

// Bits per pixel per frame for H.264 at a 1..100 quality; other codecs scale by efficiency.
export function bitsPerPixel(quality: number): number {
  const q = Math.min(100, Math.max(1, quality)) / 100;
  return 0.02 + q * q * 0.12;
}

export function videoBitrate(
  width: number,
  height: number,
  fps: number,
  quality: number,
  codec = 'avc',
): number {
  const efficiency = CODEC_EFFICIENCY[codec] ?? 1;
  return Math.round(width * height * fps * bitsPerPixel(quality) * efficiency);
}

export function audioBitrate(quality: number, channels: number): number {
  const stereo =
    quality >= 90
      ? 256_000
      : quality >= 70
        ? 160_000
        : quality >= 50
          ? 128_000
          : quality >= 30
            ? 96_000
            : 64_000;
  return channels === 1 ? Math.round(stereo / 2) : stereo;
}

export type Dimensions = { width: number; height: number };

export function outputSize(source: Dimensions, height: number | null): Dimensions {
  if (!height || height >= source.height) return even(source);
  return even({ width: (source.width * height) / source.height, height });
}

function even(size: Dimensions): Dimensions {
  return {
    width: Math.max(2, Math.round(size.width / 2) * 2),
    height: Math.max(2, Math.round(size.height / 2) * 2),
  };
}

export function clipDuration(probe: AvProbe, settings: AvSettings): number {
  const start = settings.trimStart ?? 0;
  const end = Math.min(settings.trimEnd ?? probe.duration, probe.duration);
  let duration = Math.max(0, end - start);
  if (settings.target === 'm4r') duration = Math.min(duration, RINGTONE_SECONDS);
  return duration;
}

export type Bitrates = {
  video: number | null; // bits per second
  audio: number | null;
  channels: number | null;
  size: Dimensions | null;
  notes: string[];
};

const HEIGHT_STEPS = [2160, 1440, 1080, 720, 480, 360, 240];
const AUDIO_STEPS = [128_000, 96_000, 64_000];
const MIN_BPP = 0.04;
const CONTAINER_OVERHEAD = 0.03;

export function planBitrates(probe: AvProbe, settings: AvSettings): Bitrates {
  const notes: string[] = [];
  const keepsVideo = Boolean(probe.video) && !isAudioTarget(settings.target);
  const keepsAudio = Boolean(probe.audio) && !(keepsVideo && settings.removeAudio);
  const fps = settings.fps ?? probe.video?.fps ?? 30;
  const sourceChannels = probe.audio?.channels ?? 2;
  let channels = settings.channels ?? Math.min(2, sourceChannels);
  let size = probe.video && keepsVideo ? outputSize(probe.video, settings.height) : null;
  const codec = settings.videoCodec ?? NATIVE_TARGETS[settings.target]?.video ?? 'avc';
  let audio = keepsAudio
    ? settings.audioKbps
      ? settings.audioKbps * 1000
      : audioBitrate(settings.quality, channels)
    : null;
  let video = size ? videoBitrate(size.width, size.height, fps, settings.quality, codec) : null;

  const duration = clipDuration(probe, settings);
  if (settings.targetBytes && duration > 0) {
    const total = (settings.targetBytes * 8 * (1 - CONTAINER_OVERHEAD)) / duration;
    if (!size) {
      audio = Math.max(8_000, Math.min(audio ?? total, total));
    } else {
      audio = keepsAudio ? (AUDIO_STEPS.find((step) => step * 4 <= total) ?? 48_000) : null;
      if (audio === 48_000) {
        channels = 1;
        notes.push('Audio reduced to mono to fit');
      }
      video = Math.max(50_000, total - (audio ?? 0));
      const efficiency = CODEC_EFFICIENCY[codec] ?? 1;
      let reduced: number | null = null;
      while (size.height > 240 && video / (size.width * size.height * fps * efficiency) < MIN_BPP) {
        const next = HEIGHT_STEPS.find((h) => h < size!.height);
        if (!next) break;
        size = outputSize(probe.video!, next);
        reduced = next;
      }
      if (reduced) notes.push(`Reduced to ${reduced}p to fit`);
    }
  }
  return { video, audio, channels: keepsAudio ? channels : null, size, notes };
}

const LOSSLESS_BYTES_PER_SAMPLE: Record<string, number> = {
  wav: 2,
  aiff: 2,
  au: 2,
  caf: 2,
  flac: 1.2,
  alac: 1.25,
  wv: 1.2,
};

// Expected output size in bytes, or null where a heuristic would mislead (animated images).
export function estimateBytes(probe: AvProbe, settings: AvSettings): number | null {
  const out = target(settings.target);
  if (out.group === 'animated' || out.group === 'image') return null;
  const duration = clipDuration(probe, settings);
  const perSample = LOSSLESS_BYTES_PER_SAMPLE[settings.target];
  if (perSample && probe.audio) {
    const rate = settings.sampleRate ?? probe.audio.sampleRate;
    const channels = settings.channels ?? Math.min(2, probe.audio.channels);
    return Math.round(rate * channels * perSample * duration);
  }
  if (settings.target === 'ffv1') return null;
  const plan = planBitrates(probe, settings);
  const bits = ((plan.video ?? 0) + (plan.audio ?? 0)) * duration;
  return Math.round((bits / 8) * (1 + CONTAINER_OVERHEAD));
}

const FILE_IN = '/in';
const FILE_OUT = '/out';

// zip: a directory whose files are zipped as the output. raw: RGBA frames of this size, for gifski.
export type FfmpegJob = {
  args: string[];
  output: string;
  zip?: string;
  raw?: Dimensions & { fps: number };
};

function crf(quality: number, low: number, high: number): number {
  return Math.round(high - ((high - low) * Math.min(100, Math.max(1, quality))) / 100);
}

function dither(mode: AvSettings['gif']['dither']): string {
  return mode === 'none' ? 'none' : mode === 'bayer' ? 'bayer:bayer_scale=3' : 'floyd_steinberg';
}

// FFmpeg command line for one job. The input is mounted read-only at /in/<name>.
export function ffmpegArgs(
  inputName: string,
  probe: AvProbe | undefined,
  settings: AvSettings,
): FfmpegJob {
  const out = target(settings.target);
  const output = `${FILE_OUT}/output.${out.ext}`;
  const args: string[] = ['-hide_banner', '-nostdin', '-y'];
  if (settings.trimStart) args.push('-ss', String(settings.trimStart));
  // FFmpeg's built-in VP8/VP9 decoders drop alpha; libvpx keeps it.
  const alpha = Boolean(probe?.video?.alpha) && out.alpha;
  const vpx =
    probe?.video?.codec === 'vp9' ? 'libvpx-vp9' : probe?.video?.codec === 'vp8' ? 'libvpx' : null;
  if (vpx && alpha) args.push('-c:v', vpx);
  args.push('-i', `${FILE_IN}/${inputName}`);
  if (settings.trimEnd !== null && settings.trimEnd !== undefined)
    args.push('-t', String(Math.max(0, settings.trimEnd - (settings.trimStart ?? 0))));
  else if (settings.target === 'm4r') args.push('-t', String(RINGTONE_SECONDS));

  if (settings.metadata !== 'all')
    args.push(
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-flags:a',
      '+bitexact',
    );
  args.push('-dn', '-sn');

  const plan = probe ? planBitrates(probe, settings) : null;
  const scale = (height: number | null) => (height ? [`scale=-2:${height}:flags=lanczos`] : []);
  const height =
    plan?.size && probe?.video && plan.size.height < probe.video.height
      ? plan.size.height
      : settings.height;
  const fps = settings.fps ? [`fps=${settings.fps}`] : [];

  if (out.group === 'animated') {
    const gif = settings.gif;
    const base = [`fps=${gif.fps}`, `scale='min(${gif.width},iw)':-2:flags=lanczos`];
    args.push('-map', '0:v:0', '-an');
    if (settings.target === 'gif-anim' && gif.palette === 'gifski' && probe?.video) {
      const width = Math.min(gif.width, probe.video.width);
      const size = even({ width, height: (probe.video.height * width) / probe.video.width });
      args.push(
        '-vf',
        `fps=${gif.fps},scale=${size.width}:${size.height}:flags=lanczos`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        `${FILE_OUT}/frames.rgba`,
      );
      return { args, output: `${FILE_OUT}/frames.rgba`, raw: { ...size, fps: gif.fps } };
    }
    if (settings.target === 'gif-anim') {
      const stats =
        gif.palette === 'diff'
          ? 'stats_mode=diff'
          : gif.palette === 'per-frame'
            ? 'stats_mode=single'
            : 'stats_mode=full';
      const use = `paletteuse=dither=${dither(gif.dither)}${gif.palette === 'diff' ? ':diff_mode=rectangle' : ''}${gif.palette === 'per-frame' ? ':new=1' : ''}`;
      args.push(
        '-filter_complex',
        `[0:v]${base.join(',')},split[a][b];[a]palettegen=${stats}:reserve_transparent=1[p];[b][p]${use}`,
        '-loop',
        '0',
        output,
      );
    } else if (settings.target === 'webp-anim') {
      args.push(
        '-vf',
        base.join(','),
        '-c:v',
        'libwebp_anim',
        '-q:v',
        String(settings.quality),
        '-loop',
        '0',
        output,
      );
    } else {
      args.push('-vf', base.join(','), '-plays', '0', '-f', 'apng', output);
    }
    return { args, output };
  }

  if (settings.target === 'frames') {
    args.push(
      '-map',
      '0:v:0',
      '-an',
      '-vf',
      [`fps=${settings.gif.fps}`, ...scale(height ?? null)].join(','),
      `${FILE_OUT}/frames/frame-%05d.png`,
    );
    return { args, output: `${FILE_OUT}/frames.zip`, zip: `${FILE_OUT}/frames` };
  }

  if (settings.target === 'contact-sheet') {
    const length = probe ? clipDuration(probe, settings) : 16;
    const rate = Math.max(0.001, 16 / Math.max(1, length));
    const sheet = `${FILE_OUT}/sheet.png`;
    args.push(
      '-map',
      '0:v:0',
      '-an',
      '-vf',
      `fps=${rate.toFixed(4)},scale=320:-2,tile=4x4:padding=4:margin=4:color=white`,
      '-frames:v',
      '1',
      '-update',
      '1',
      sheet,
    );
    return { args, output: sheet };
  }

  if (out.group === 'image') {
    const at = settings.trimStart ? 0 : Math.min((probe?.duration ?? 0) * 0.1, 3);
    if (at > 0) args.splice(args.indexOf('-i'), 0, '-ss', String(at));
    args.push('-map', '0:v:0', '-frames:v', '1', '-update', '1');
    if (height) args.push('-vf', scale(height).join(','));
    args.push(`${FILE_OUT}/frame.png`);
    return { args, output: `${FILE_OUT}/frame.png` };
  }

  if (isAudioTarget(settings.target)) {
    args.push('-map', '0:a:0', '-vn');
    const kbps = plan?.audio ? Math.round(plan.audio / 1000) : (settings.audioKbps ?? 160);
    if (settings.sampleRate) args.push('-ar', String(settings.sampleRate));
    const channels = plan?.channels ?? settings.channels;
    if (channels) args.push('-ac', String(channels));
    switch (settings.target) {
      case 'mp3':
        if (settings.targetBytes || settings.audioKbps)
          args.push('-c:a', 'libmp3lame', '-b:a', `${kbps}k`);
        else
          args.push(
            '-c:a',
            'libmp3lame',
            '-q:a',
            String(Math.max(0, Math.min(9, Math.round((100 - settings.quality) / 11)))),
          );
        break;
      case 'm4a':
      case 'm4r':
      case 'm4b':
        args.push('-c:a', 'aac', '-b:a', `${kbps}k`, '-f', 'ipod');
        break;
      case 'alac':
        args.push('-c:a', 'alac', '-f', 'ipod');
        break;
      case 'flac':
        args.push('-c:a', 'flac', '-compression_level', '5');
        break;
      case 'wav':
        args.push('-c:a', 'pcm_s16le');
        break;
      case 'aiff':
        args.push('-c:a', 'pcm_s16be', '-f', 'aiff');
        break;
      case 'caf':
        args.push('-c:a', 'pcm_s16le', '-f', 'caf');
        break;
      case 'au':
        args.push('-c:a', 'pcm_s16be', '-f', 'au');
        break;
      case 'opus':
        args.push('-c:a', 'libopus', '-b:a', `${Math.min(kbps, 256)}k`, '-f', 'ogg');
        break;
      case 'ogg':
        args.push('-c:a', 'libvorbis', '-b:a', `${kbps}k`);
        break;
      case 'wv':
        args.push('-c:a', 'wavpack');
        break;
      case 'ac3':
        args.push('-c:a', 'ac3', '-b:a', `${Math.max(kbps, 192)}k`);
        break;
    }
    args.push(output);
    return { args, output };
  }

  args.push('-map', '0:v:0');
  if (!settings.removeAudio) args.push('-map', '0:a:0?');
  else args.push('-an');
  const filters = [...scale(height ?? null), ...fps];
  if (filters.length) args.push('-vf', filters.join(','));
  const vb = plan?.video ? `${Math.round(plan.video / 1000)}k` : null;
  const ab = plan?.audio ? `${Math.round(plan.audio / 1000)}k` : '128k';
  const sized = Boolean(settings.targetBytes && vb);
  const x264 = (preset: string) =>
    sized
      ? ['-c:v', 'libx264', '-preset', preset, '-b:v', vb!, '-maxrate', vb!, '-bufsize', vb!]
      : ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf(settings.quality, 16, 40))];
  switch (settings.target) {
    case 'mp4':
    case 'mkv':
      args.push(...x264('veryfast'), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', ab);
      if (settings.target === 'mp4') args.push('-movflags', '+faststart');
      break;
    case 'mov':
      if (settings.videoCodec === 'prores')
        args.push(
          '-c:v',
          'prores_ks',
          '-profile:v',
          '4444',
          '-pix_fmt',
          'yuva444p10le',
          '-c:a',
          'pcm_s16le',
        );
      else args.push(...x264('veryfast'), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', ab);
      break;
    case 'webm':
      // The stock core's VP9 encoder crashes with "memory access out of bounds"; VP8 is the FFmpeg fallback.
      args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-auto-alt-ref', '0');
      if (sized) args.push('-b:v', vb!);
      else
        args.push(
          '-crf',
          String(crf(settings.quality, 4, 50)),
          '-b:v',
          `${Math.round((plan?.video ?? 2_000_000) / 1000)}k`,
        );
      args.push('-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', '-c:a', 'libopus', '-b:a', ab);
      break;
    case 'avi':
      args.push(
        '-c:v',
        'mpeg4',
        '-vtag',
        'xvid',
        '-q:v',
        String(Math.max(2, Math.min(31, Math.round((100 - settings.quality) / 4)))),
        '-c:a',
        'libmp3lame',
        '-b:a',
        ab,
      );
      break;
    case 'mpg':
      args.push(
        '-c:v',
        'mpeg2video',
        '-b:v',
        sized ? vb! : '6000k',
        '-maxrate',
        '9000k',
        '-bufsize',
        '1835k',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'mp2',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-f',
        'dvd',
      );
      break;
    case '3gp':
      args.push(
        '-c:v',
        'libx264',
        '-profile:v',
        'baseline',
        '-level',
        '3.0',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        String(crf(settings.quality, 20, 40)),
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-ac',
        '1',
        '-ar',
        '22050',
      );
      break;
    case 'ogv':
      args.push(
        '-c:v',
        'libtheora',
        '-q:v',
        String(Math.max(0, Math.min(10, Math.round(settings.quality / 10)))),
        '-c:a',
        'libvorbis',
        '-q:a',
        '4',
      );
      break;
    case 'ffv1':
      args.push('-c:v', 'ffv1', '-level', '3', '-c:a', 'flac');
      break;
  }
  args.push(output);
  return { args, output };
}

export type Slideshow = {
  frames: readonly string[]; // file names, in order
  secondsPerImage: number;
  audio: { name: string; duration: number } | null;
  target: 'mp4' | 'webm';
  size: Dimensions;
  quality: number;
};

// A concat list of still images, optionally over an audio track. The list itself is written to /list.txt.
export function slideshowJob(show: Slideshow): FfmpegJob & { list: string } {
  const single = show.frames.length === 1 && show.audio;
  const seconds = single ? show.audio!.duration : show.secondsPerImage;
  const lines = ['ffconcat version 1.0'];
  for (const name of show.frames) lines.push(`file '${FILE_IN}/${name}'`, `duration ${seconds}`);
  lines.push(`file '${FILE_IN}/${show.frames.at(-1)}'`);
  const { width, height } = even(show.size);
  const output = `${FILE_OUT}/output.${show.target}`;
  const args = ['-hide_banner', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', '/list.txt'];
  if (show.audio) args.push('-i', `${FILE_IN}/${show.audio.name}`);
  args.push(
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${single ? 2 : 30},format=yuv420p`,
    '-map',
    '0:v:0',
  );
  if (show.audio) args.push('-map', '1:a:0');
  if (single) args.push('-shortest');
  else args.push('-t', String(show.frames.length * show.secondsPerImage));
  if (show.target === 'mp4') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'stillimage',
      '-crf',
      String(crf(show.quality, 16, 40)),
    );
    if (show.audio) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-movflags', '+faststart');
  } else {
    args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M');
    if (show.audio) args.push('-c:a', 'libopus', '-b:a', '128k');
  }
  args.push('-map_metadata', '-1', '-fflags', '+bitexact', output);
  return { args, output, list: lines.join('\n') + '\n' };
}
