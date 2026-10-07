import { describe, expect, it } from 'vitest';
import { sniff } from '../../src/io/sniff';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function file(bytes: ArrayLike<number> | string, name: string): File {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : Uint8Array.from(bytes);
  return new File([data], name);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function riff(form: string): number[] {
  return [
    ...ascii('RIFF'),
    36,
    0,
    0,
    0,
    ...ascii(form),
    ...ascii('fmt '),
    16,
    0,
    0,
    0,
    ...new Array(16).fill(0),
  ];
}

function ftyp(brand: string): number[] {
  return [
    0,
    0,
    0,
    24,
    ...ascii('ftyp'),
    ...ascii(brand),
    0,
    0,
    0,
    0,
    ...ascii(brand),
    ...ascii('isom'),
  ];
}

describe('sniff', () => {
  it.each([
    ['png', Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0)), 'photo.png', 'image'],
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0], 'photo.jpg', 'image'],
    ['wav', riff('WAVE'), 'sound.wav', 'audio'],
    ['mp4', ftyp('isom'), 'clip.mp4', 'video'],
    ['mov', ftyp('qt  '), 'clip.mov', 'video'],
  ] as const)('detects %s via file-type', async (format, bytes, name, kind) => {
    expect(await sniff(file(bytes, name))).toMatchObject({ format, kind });
  });

  it.each([
    ['exr', [0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0], 'image'],
    ['hdr', '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n', 'image'],
    ['dds', 'DDS |\0\0\0', 'image'],
    ['qoi', 'qoif\0\0\0\x01\0\0\0\x01\x04\0', 'image'],
    ['fits', 'SIMPLE  =                    T', 'image'],
    ['pnm', 'P6\n1 1\n255\n', 'image'],
    ['tak', 'tBaK\0\0\0\0', 'audio'],
    ['tta', 'TTA1\x01\0', 'audio'],
    ['caf', 'caff\0\x01\0\0', 'audio'],
    ['rf64', 'RF64\xff\xff\xff\xffWAVE', 'audio'],
    ['dts', [0x7f, 0xfe, 0x80, 0x01, 0, 0], 'audio'],
    ['dff', 'FRM8\0\0\0\0\0\0\0\0DSD ', 'audio'],
    ['nut', 'nut/multimedia container\0', 'video'],
    ['svg', '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image'],
  ] as const)('detects %s by our own signature', async (format, bytes, kind) => {
    expect(await sniff(file(bytes, 'no-extension'))).toMatchObject({ format, kind });
  });

  it('trusts the extension only for formats without a signature', async () => {
    expect(await sniff(file([0, 0, 2, 0, 0, 0, 0, 0], 'image.tga'))).toMatchObject({
      format: 'tga',
    });
    expect(await sniff(file([9, 8, 7, 6, 5, 4, 3, 2], 'image.png'))).toMatchObject({
      format: null,
    });
  });

  it('goes by content, not the extension', async () => {
    const result = await sniff(file(riff('WAVE'), 'sound.wma'));
    expect(result.format).toBe('wav');
  });

  it('names what it found when it cannot handle it', async () => {
    const pdf = await sniff(file('%PDF-1.7\n', 'report.pdf'));
    expect(pdf).toEqual({ format: null, kind: null, label: 'PDF file' });
    const midi = await sniff(file([...ascii('MThd'), 0, 0, 0, 6, 0, 1, 0, 1, 0, 96], 'song.mid'));
    expect(midi.label).toBe('MIDI (not supported yet)');
  });

  it('does not take XML for SVG', async () => {
    expect(await sniff(file('<?xml version="1.0"?><note></note>', 'note.xml'))).toMatchObject({
      format: null,
    });
  });
});
