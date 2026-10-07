import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framesOf } from '../../src/engine/audio/dsp';
import { renderMix } from '../../src/engine/audio/render';
import { openAsset } from '../../src/engine/audio/source';
import { newProject, type AudioProject } from '../../src/project/audio';

const tone = () =>
  new File([readFileSync(join(__dirname, '../fixtures/generated/tone.wav'))], 'tone.wav');

async function peak(
  project: AudioProject,
  assets: Map<string, Awaited<ReturnType<typeof openAsset>>>,
) {
  let max = 0;
  for await (const block of renderMix(project, assets, { from: 0, to: 1, gain: 1 }))
    for (const plane of block)
      for (let i = 0; i < framesOf(block); i++) max = Math.max(max, Math.abs(plane[i]!));
  return max;
}

describe('overall volume', () => {
  it('scales the mix used for playback and export', async () => {
    const asset = await openAsset(tone());
    const assets = new Map([['a', asset]]);
    const project = newProject([
      {
        id: 'a',
        name: 'tone.wav',
        duration: asset.duration,
        sampleRate: asset.sampleRate,
        channels: asset.channels,
      },
    ]);
    const unity = await peak(project, assets);
    const half = await peak({ ...project, gain: 0.5 }, assets);
    expect(unity).toBeGreaterThan(0.1);
    expect(half / unity).toBeCloseTo(0.5, 2);
  });
});
