import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip } from '../../src/io/unzip';
import { makeZip } from '../../src/io/zip';

const text = (s: string) => new TextEncoder().encode(s);

// A one-entry deflated archive, the kind most desktop tools write.
function deflatedZip(name: string, body: Uint8Array): Uint8Array {
  const data = deflateRawSync(body);
  const nameBytes = text(name);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, body.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, body.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  out.set(local);
  out.set(data, local.length);
  out.set(central, local.length + data.length);
  out.set(end, local.length + data.length + central.length);
  return out;
}

describe('readZip', () => {
  it('reads what makeZip writes', async () => {
    const zip = await makeZip([
      { name: 'project.json', bytes: text('{"a":1}') },
      { name: 'media/clip.mp4', bytes: new Uint8Array(70_000).fill(7) },
    ]);
    const entries = await readZip(new Blob([zip as Uint8Array<ArrayBuffer>]));
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['project.json', 7],
      ['media/clip.mp4', 70_000],
    ]);
    expect(await (await entries[0]!.read()).text()).toBe('{"a":1}');
    const media = new Uint8Array(await (await entries[1]!.read()).arrayBuffer());
    expect(media.length).toBe(70_000);
    expect(media.every((b) => b === 7)).toBe(true);
  });

  it('inflates deflated entries', async () => {
    const body = text('hello '.repeat(1000));
    const [entry] = await readZip(
      new Blob([deflatedZip('a.txt', body) as Uint8Array<ArrayBuffer>]),
    );
    expect(await (await entry!.read()).text()).toBe('hello '.repeat(1000));
  });

  it('rejects files that are not archives', async () => {
    await expect(readZip(new Blob(['not a zip']))).rejects.toThrow("This isn't a ZIP file");
  });
});
