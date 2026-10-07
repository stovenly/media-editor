import { DEFAULT_OPTIONS, type ConvertOptions } from './options';

type Key = keyof ConvertOptions;

const METADATA_LABELS = {
  none: 'remove metadata',
  technical: 'keep colour profile',
  all: 'keep all metadata',
};

// Plain-language summary of each changed setting, shown on a collapsed Options panel.
export function describeChanges(options: ConvertOptions, keys: readonly Key[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    if (options[key] === DEFAULT_OPTIONS[key]) continue;
    const value = options[key];
    switch (key) {
      case 'quality':
        out.push(`quality ${value as number}`);
        break;
      case 'maxEdge':
        out.push(value ? `${value as number} px` : 'original size');
        break;
      case 'height':
        out.push(value ? `${value as number}p` : 'original size');
        break;
      case 'targetMb':
        out.push(`fit to ${value as number} MB`);
        break;
      case 'background':
        out.push(`background ${value as string}`);
        break;
      case 'metadata':
        out.push(METADATA_LABELS[value as ConvertOptions['metadata']]);
        break;
      case 'removeAudio':
        out.push('no audio');
        break;
      case 'keepHdr':
        out.push('drop HDR');
        break;
      case 'lossless':
        out.push('lossless');
        break;
      case 'fps':
        out.push(`${value as number} fps`);
        break;
      case 'audioKbps':
        out.push(`${value as number} kbps audio`);
        break;
      case 'trimStart':
        out.push(`from ${value as number} s`);
        break;
      case 'trimEnd':
        out.push(`to ${value as number} s`);
        break;
      case 'videoCodec':
        out.push(String(value).toUpperCase());
        break;
      case 'sampleRate':
        out.push(`${(value as number) / 1000} kHz`);
        break;
      case 'gifFps':
        out.push(`${value as number} fps animation`);
        break;
      case 'gifWidth':
        out.push(`${value as number} px animation`);
        break;
      case 'channels':
        out.push(value === 1 ? 'mono' : `${value as number} channels`);
        break;
      default:
        out.push(String(key).replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`));
    }
  }
  return out;
}

export function changedKeys(options: ConvertOptions, keys: readonly Key[]): Key[] {
  return keys.filter((key) => options[key] !== DEFAULT_OPTIONS[key]);
}
