// Styled text for the video editor: text clips on the timeline and the caption track.
import type { Cue } from '../captions/cues';

export type Anchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export type TextStyle = {
  font: string; // CSS family name, bundled or from ProjectFont
  bold: boolean;
  italic: boolean;
  size: number; // fraction of the frame height
  color: string;
  outline: number; // fraction of the font size; 0 for none
  outlineColor: string;
  shadow: boolean;
  box: string | null; // #rrggbbaa behind each line
  anchor: Anchor;
  margin: number; // fraction of the shorter frame side
};

export type TextClip = {
  id: string;
  text: string;
  start: number; // timeline seconds
  duration: number;
  fadeIn: number;
  fadeOut: number;
  style: TextStyle;
};

export type Captions = {
  cues: Cue[];
  style: TextStyle;
  burn: boolean; // drawn into the picture
  track: boolean; // added as a subtitle track viewers can switch
  language: string; // ISO 639-2, or '' for unknown
};

// User fonts travel with the project bundle; `id` names the file inside it.
export type ProjectFont = { id: string; family: string; name: string };

export const TITLE_STYLE: TextStyle = {
  font: 'Inter',
  bold: true,
  italic: false,
  size: 0.08,
  color: '#ffffff',
  outline: 0.06,
  outlineColor: '#000000',
  shadow: true,
  box: null,
  anchor: 'center',
  margin: 0.06,
};

export const CAPTION_STYLE: TextStyle = {
  font: 'Inter',
  bold: false,
  italic: false,
  size: 0.05,
  color: '#ffffff',
  outline: 0,
  outlineColor: '#000000',
  shadow: false,
  box: '#000000b3',
  anchor: 'bottom',
  margin: 0.06,
};

export const NO_CAPTIONS: Captions = {
  cues: [],
  style: CAPTION_STYLE,
  burn: true,
  track: false,
  language: '',
};
