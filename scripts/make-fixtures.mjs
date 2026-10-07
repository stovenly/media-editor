// Generates the small image corpus in tests/fixtures/generated. Run with `npm run fixtures`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Vips from 'wasm-vips';
import { ImageMagick, initializeImageMagick, MagickFormat } from '@imagemagick/magick-wasm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests', 'fixtures', 'generated');
mkdirSync(out, { recursive: true });

const vips = await Vips({
  dynamicLibraries: ['vips-jxl.wasm', 'vips-heif.wasm', 'vips-resvg.wasm'],
});
await initializeImageMagick(
  readFileSync(join(root, 'node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm')),
);

const W = 64;
const H = 48;

function rgbGradient() {
  const x = vips.Image.xyz(W, H);
  const r = x.extractBand(0).linear(255 / W, 0);
  const g = x.extractBand(1).linear(255 / H, 0);
  const b = r.linear(-1, 255);
  return r.bandjoin([g, b]).cast('uchar').copy({ interpretation: 'srgb' });
}

function rgbaGradient() {
  const rgb = rgbGradient();
  const alpha = vips.Image.xyz(W, H)
    .extractBand(0)
    .linear(255 / W, 0)
    .cast('uchar');
  return rgb.bandjoin(alpha).copy({ interpretation: 'srgb' });
}

const write = (name, bytes) => writeFileSync(join(out, name), bytes);

// Minimal big-endian EXIF with orientation 6 and a GPS position, for metadata tests.
function exifApp1() {
  const entries = [];
  const u16 = (v) => [v >> 8, v & 255];
  const u32 = (v) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const tiff = [0x4d, 0x4d, 0, 42, ...u32(8)];
  const ifd0 = [
    ...u16(2),
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(6),
    0,
    0,
    ...u16(0x8825),
    ...u16(4),
    ...u32(1),
    ...u32(38),
    ...u32(0),
  ];
  const gpsData = 38 + 2 + 4 * 12 + 4;
  const gps = [
    ...u16(4),
    ...u16(1),
    ...u16(2),
    ...u32(2),
    0x4e,
    0,
    0,
    0,
    ...u16(2),
    ...u16(5),
    ...u32(3),
    ...u32(gpsData),
    ...u16(3),
    ...u16(2),
    ...u32(2),
    0x57,
    0,
    0,
    0,
    ...u16(4),
    ...u16(5),
    ...u32(3),
    ...u32(gpsData + 24),
    ...u32(0),
    ...u32(51),
    ...u32(1),
    ...u32(30),
    ...u32(1),
    ...u32(0),
    ...u32(1),
    ...u32(0),
    ...u32(1),
    ...u32(7),
    ...u32(1),
    ...u32(0),
    ...u32(1),
  ];
  entries.push(...tiff, ...ifd0, ...gps);
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...entries];
  return Uint8Array.from([0xff, 0xe1, ...u16(body.length + 2), ...body]);
}

const jpeg = rgbGradient().jpegsaveBuffer({ Q: 90, keep: 'none' });
const exif = exifApp1();
const trailer = new TextEncoder().encode('TRAILING-SECRET');
const withExif = new Uint8Array(jpeg.length + exif.length + trailer.length);
withExif.set(jpeg.subarray(0, 2));
withExif.set(exif, 2);
withExif.set(jpeg.subarray(2), 2 + exif.length);
withExif.set(trailer, jpeg.length + exif.length);
write('photo-gps.jpg', withExif);

write('gradient.jpg', jpeg);
write('alpha.png', rgbaGradient().pngsaveBuffer());
write('alpha.webp', rgbaGradient().webpsaveBuffer({ Q: 90 }));
write('alpha.avif', rgbaGradient().heifsaveBuffer({ Q: 60, compression: 'av1' }));
write('gradient.jxl', rgbGradient().jxlsaveBuffer({ Q: 90 }));
write(
  'deep.tif',
  rgbGradient()
    .cast('ushort')
    .linear(257, 0)
    .cast('ushort')
    .copy({ interpretation: 'rgb16' })
    .tiffsaveBuffer(),
);
write('gradient.ppm', rgbGradient().writeToBuffer('.ppm'));
write(
  'stripes.png',
  vips.Image.xyz(4000, 3000)
    .extractBand(0)
    .remainder(2)
    .linear(255, 0)
    .cast('uchar')
    .pngsaveBuffer(),
);
write(
  'shape.svg',
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><circle cx="24" cy="24" r="20" fill="#4f46e5"/><rect x="40" y="8" width="20" height="32" fill="#f59e0b" opacity="0.6"/></svg>',
  ),
);

const frames = [0, 80, 160].map((shift) => rgbGradient().linear(1, shift).cast('uchar'));
const strip = vips.Image.arrayjoin(frames, { across: 1 }).copy({ interpretation: 'srgb' });
strip.setInt('page-height', H);
strip.setArrayInt('delay', [100, 100, 100]);
write('anim.gif', strip.gifsaveBuffer());
write('anim.webp', strip.webpsaveBuffer({ Q: 80 }));

const png = rgbaGradient().pngsaveBuffer();
const viaMagick = (name, format, bytes = png) =>
  ImageMagick.read(bytes, (image) =>
    write(
      name,
      image.write(format, (data) => data.slice()),
    ),
  );
viaMagick('gradient.bmp', MagickFormat.Bmp, rgbGradient().pngsaveBuffer());
viaMagick('alpha.tga', MagickFormat.Tga);
viaMagick('alpha.qoi', MagickFormat.Qoi);
viaMagick('gradient.pcx', MagickFormat.Pcx);
viaMagick('alpha.psd', MagickFormat.Psd);
viaMagick('gradient.exr', MagickFormat.Exr);
viaMagick('gradient.hdr', MagickFormat.Hdr);
viaMagick('gradient.jp2', MagickFormat.Jp2);
viaMagick('gradient.sgi', MagickFormat.Sgi);
viaMagick('gradient.ras', MagickFormat.Sun);
viaMagick('gradient.xpm', MagickFormat.Xpm);
viaMagick('gradient.dds', MagickFormat.Dds);
viaMagick('gradient.fits', MagickFormat.Fits);
viaMagick('mono.wbmp', MagickFormat.Wbmp);
viaMagick('mono.xbm', MagickFormat.Xbm);
viaMagick('alpha.ico', MagickFormat.Ico);

const { assembleApng } = await import('../src/engine/image/apng.ts');
write(
  'anim.png',
  assembleApng(
    frames.map((frame) => frame.bandjoin(255).pngsaveBuffer()),
    [100, 100, 100],
  ),
);
console.log(`Wrote fixtures to ${out}`);

// Audio and video fixtures need a native ffmpeg; they are skipped without one.
import { spawnSync } from 'node:child_process';

write(
  'captions.srt',
  new TextEncoder().encode(
    '1\n00:00:00,200 --> 00:00:00,900\nFirst caption\n\n2\n00:00:01,000 --> 00:00:01,800\nSecond, with\ntwo lines\n',
  ),
);

const ffmpeg = (name, args) => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...args,
    join(out, name),
  ]);
  if (result.error) return false;
  if (result.status !== 0) console.warn(`ffmpeg failed for ${name}: ${result.stderr}`);
  return true;
};
const video = ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2'];
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=44100'];
if (
  ffmpeg('clip.mp4', [
    ...video,
    ...tone,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-metadata',
    'location=+51.5000+000.0000/',
    '-shortest',
  ])
) {
  ffmpeg('clip.webm', [...video, ...tone, '-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-shortest']);
  ffmpeg('clip.mov', [
    ...video,
    ...tone,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ]);
  ffmpeg('clip.mkv', [
    ...video,
    ...tone,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'libopus',
    '-shortest',
  ]);
  ffmpeg('clip.avi', [...video, ...tone, '-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-shortest']);
  ffmpeg('clip.mpg', [...video, ...tone, '-c:v', 'mpeg2video', '-c:a', 'mp2', '-shortest']);
  ffmpeg('clip.wmv', [...video, ...tone, '-c:v', 'wmv2', '-c:a', 'wmav2', '-shortest']);
  ffmpeg('clip.ogv', [...video, ...tone, '-c:v', 'libtheora', '-c:a', 'libvorbis', '-shortest']);
  ffmpeg('alpha.webm', [
    '-f',
    'lavfi',
    '-i',
    'color=c=red@0.5:size=160x120:rate=10:duration=1,format=yuva420p',
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
  ]);
  ffmpeg('tone.wav', [...tone]);
  ffmpeg('tone.mp3', [...tone, '-c:a', 'libmp3lame']);
  ffmpeg('tone.flac', [...tone, '-c:a', 'flac']);
  ffmpeg('tone.ogg', [...tone, '-c:a', 'libvorbis']);
  ffmpeg('tone.opus', [...tone, '-c:a', 'libopus']);
  ffmpeg('tone.m4a', [...tone, '-c:a', 'aac']);
  ffmpeg('tone.aiff', [...tone]);
  ffmpeg('tone.ac3', [...tone, '-c:a', 'ac3']);
  ffmpeg('tone.wma', [...tone, '-c:a', 'wmav2']);
  const subs = join(out, 'captions.srt');
  const withSubs = (name, codec, videoCodec, audioCodec) =>
    ffmpeg(name, [
      ...video,
      ...tone,
      '-i',
      subs,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:s',
      '-c:v',
      videoCodec,
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      audioCodec,
      '-c:s',
      codec,
      '-metadata:s:s:0',
      'language=eng',
      '-shortest',
    ]);
  ffmpeg('keyed.mp4', [
    ...video,
    ...tone,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '10',
    '-keyint_min',
    '10',
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-shortest',
  ]);
  withSubs('subs.mp4', 'mov_text', 'libx264', 'aac');
  withSubs('subs.mkv', 'srt', 'libx264', 'libopus');
  withSubs('subs.webm', 'webvtt', 'libvpx-vp9', 'libopus');
} else {
  console.warn('No ffmpeg on PATH: skipped audio and video fixtures');
}

// A Google-style Motion Photo: XMP marker in the JPEG, MP4 appended after the image.
if (existsSync(join(out, 'clip.mp4'))) {
  const xmp = new TextEncoder().encode(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description GCamera:MotionPhoto="1"/></x:xmpmeta>',
  );
  const app1 = new Uint8Array(4 + xmp.length);
  app1.set([0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 255]);
  app1.set(xmp, 4);
  const still = rgbGradient().jpegsaveBuffer({ Q: 90, keep: 'none' });
  const clip = readFileSync(join(out, 'clip.mp4'));
  write('motion.jpg', Buffer.concat([still.subarray(0, 2), app1, still.subarray(2), clip]));
}
