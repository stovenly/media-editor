# Settings UI — Specification

Replaces the native checkboxes, dropdowns, range sliders and colour inputs in
every settings panel with a small set of shared controls, so the editors and
the converter look and behave the same, and common choices take one click.

Status: v0.3 · 2026-11-06

---

## 1. Goals

1. **One click for common choices.** Small sets of options are visible at once
   instead of hidden in a dropdown.
2. **Always show the current value, and a way back to the default.** Every
   slider shows its number, accepts a typed value, and can be reset.
3. **One look everywhere.** A control behaves the same in the converter and in
   the image, audio and video editors. Today each panel builds its own, with
   different sizes, radii and reset behaviour.
4. **Outcomes before parameters.** Export and quality settings lead with named
   results ("Original quality", "Small") and a size, not a bare slider.

## 2. Non-goals

- Keyframes, animation curves or per-property animation.
- New editing features. This changes how existing settings are presented, not
  what they do.
- Phone layouts. Desktop only.
- New keyboard shortcuts. Controls get the standard keyboard behaviour of
  their ARIA role (arrow keys in a radio group or slider) and nothing more.
- Rewriting the timeline, the preview or the format picker
  (`OutputBar.svelte`), which already uses buttons rather than a dropdown.

## 3. Shared controls

All live in `src/app/ui/` and are built on `bits-ui` primitives where one
exists. They use the existing theme tokens (`accent`, `line`, `surface`,
`muted`) and one size scale: 32 px control height, `rounded-lg`, `text-sm`
values, `text-xs` labels.

### 3.1 `Field`

The wrapper every setting sits in: label, the control, an optional hint
line, and a **Reset** button that appears only when the value differs from its
default. The converter's `field` snippet (`OptionsPanel.svelte`) already does
this and becomes this component.

- Props: `label`, `hint?`, `changed: boolean`, `onReset`.
- Single controls (`Slider`, `NumberField`, `Select`, `Segmented`, `Switch`)
  take their own `label` prop and render it, so the label is tied to the
  control for screen readers and tests. `Field` is for a group of controls
  under one label.
- Reset is a small text button after the label, never next to a destructive
  action.

### 3.2 `Segmented`

A row of buttons for one choice out of 2–5. Built on bits-ui `ToggleGroup`
(`type="single"`), with the radio-group keyboard behaviour.

- Exactly one option is always selected; clicking the selected one does
  nothing.
- Options are text, an icon, or both. An icon-only option has a tooltip and an
  `aria-label`.
- Fills the panel width; options share it equally.
- Use it when there are at most 5 options **and** every label fits in about 10
  characters. Otherwise keep a dropdown (§3.7).

### 3.3 `IconToggle`

A single on/off icon button (`aria-pressed`), for independent toggles such as
bold, italic, mute, flip and "keep proportions". Several can sit in a row.

### 3.4 `Slider`

Replaces every `<input type="range">`. Built on bits-ui `Slider`.

- Value box at the right that shows the value with its unit (`−3.5 dB`,
  `1.25×`, `40%`) and accepts a typed value; out-of-range input clamps.
- A tick on the track marks the default, when the default isn't an end of
  the range.
- Double-clicking the track or the label resets to the default. The `Field`
  reset button does the same.
- The value updates live while dragging. A drag is one undo step: the editors
  already merge same-label commands in quick succession
  (`src/project/history.svelte.ts`), and the control must keep using one label
  per drag.
- Optional `marks` for named points, such as `1×` on speed or `0 dB` on
  volume.

### 3.5 `SectionToggle`

A section heading with a switch, for a group of settings that only applies
when it's on: chroma key, text outline, text background.

- Off: only the heading and switch show; the fields below collapse.
- Switching off keeps the values, so switching back on restores them. Where
  the data model stores "off" as a value (text `outline: 0`, `box: null`,
  chroma `key: null`), the panel remembers the last on value in local state and
  falls back to the defaults in §7.5.
- Built on bits-ui `Switch` with the heading as its label.

### 3.5a `Switch`

An on/off setting with a text label and an optional hint: bits-ui `Switch`,
label on the left, switch on the right. Replaces every settings checkbox.

### 3.5b `Section`

A sidebar section: heading (with optional icon), a collapse chevron, and its
content. Built on bits-ui `Collapsible`. Takes an `id` so its open state can be
remembered for the session, and `collapsible={false}` for Export.

### 3.6 `ColourField`

Replaces every `<input type="color">`.

- A swatch showing the current colour, which opens a popover (bits-ui
  `Popover`).
- The popover has a row of preset swatches (white, black, the accent, red,
  yellow, `#00ff00` green and blue), a row of up to 8 colours already used in
  this project, a saturation/brightness square with a hue strip, and a hex
  field.
- An optional `alpha` prop adds an opacity strip, replacing the separate
  "Background opacity" slider for text.
- For the chroma-key colour only, a **Pick from video** button: the next click
  on the preview takes the colour under the pointer from the drawn frame. This
  works in every browser, unlike the Chromium-only `EyeDropper` API.

### 3.7 `Select`

The dropdown that's left, for long or rare lists (codec, sample rate, font,
metadata). A styled bits-ui `Select` instead of the native one, so it matches
the other controls. Same height and radius as `Segmented`.

### 3.8 `NumberField`

Replaces every `<input type="number">`.

- Shows the unit inside the field (`px`, `s`, `%`).
- Time fields accept `m:ss.ff` as well as plain seconds, and show `m:ss.ff`.
- Arrow up/down change the value by its step (standard number-input
  behaviour).

### 3.9 `LinkedPair`

Two `NumberField`s with a chain-link `IconToggle` between them. When linked,
changing one changes the other in proportion. Used for width × height
("Keep proportions") and for the border's four sides.

### 3.10 `QualityPicker`

The export and conversion quality control.

- A `Segmented` with **Original quality**, **Balanced**, **Small** and
  **Custom**. Each preset shows its estimated file size under its label.
- **Original quality** is the default. For video it means the source-matched
  bitrate already in `videoBitrate` (`src/engine/av/plan.ts`). Balanced and
  Small are fixed points on the same quality scale (70 and 40). No preset changes the resolution; that stays its own setting.
- **Custom** reveals the existing quality `Slider` and the "Fit to MB"
  `NumberField`. A target size overrides the slider, as it does now.
- Where the size estimate isn't known (an image before conversion), the size
  line is left out rather than guessed.

---

## 4. Panels

What each control becomes. Anything not listed stays as it is.

### 4.1 Video editor (`VideoEditor.svelte`, `TextStyleFields.svelte`, `ChromaKeyFields.svelte`, `TextPanel.svelte`)

| Setting                                            | Now                       | Becomes                                                                                                                                                     |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clip speed (0.25–4×)                               | dropdown, 9 values        | `Slider` with marks at 0.5×, 1× and 2×                                                                                                                      |
| Clip, overlay and music volume                     | range + dB label          | `Slider` (dB), with a mute `IconToggle` beside it                                                                                                           |
| Mute clip / overlay / music                        | checkbox                  | mute `IconToggle` next to the volume slider                                                                                                                 |
| Fade in, fade out                                  | number fields (s)         | `Slider` (s), matching the audio editor                                                                                                                     |
| Start / end in source, starts at, lasts, from / to | number fields (s)         | `NumberField`, time format                                                                                                                                  |
| Overlay opacity                                    | range                     | `Slider` (%)                                                                                                                                                |
| Redaction kind                                     | dropdown                  | `Segmented`, icons: fill / blur / pixelate                                                                                                                  |
| Shape                                              | dropdown                  | `Segmented` of ratio tiles drawn to shape: Source, 16:9, 9:16, 1:1, 4:5, 4:3. Six tiles, the one exception to the 5-option rule, because they're icons      |
| Clips that don't match the shape                   | dropdown                  | `Segmented`, icons: fit with bars / fill and crop                                                                                                           |
| Frame rate                                         | dropdown                  | `Segmented`: 24, 25, 30, 50, 60, plus the project's own rate when it isn't one of those (e.g. 23.976), in ascending order                                   |
| Export format                                      | dropdown                  | `Segmented`: MP4 / WebM                                                                                                                                     |
| Fast export without re-encoding                    | checkbox + paragraph      | `Segmented`: **Fast** (no quality loss, cuts snap to key frames) / **Exact**, with the explanation as the hint. Shown only when copying is possible, as now |
| Quality slider + Fit to MB                         | range + number            | `QualityPicker`                                                                                                                                             |
| Timeline zoom (toolbar above the timeline)         | range                     | compact `Slider`: inline label, no value box                                                                                                                |
| Text font                                          | dropdown                  | `Select` showing each font in its own face                                                                                                                  |
| Bold, italic                                       | icon buttons              | `IconToggle`                                                                                                                                                |
| Text size, outline width, distance from edge       | range                     | `Slider`                                                                                                                                                    |
| Text colour, outline colour                        | colour input              | `ColourField`                                                                                                                                               |
| Text background on/off + colour + opacity          | checkbox + colour + range | `SectionToggle` "Background" holding a `ColourField` with `alpha`                                                                                           |
| Text outline on/off                                | checkbox                  | `SectionToggle` "Outline"                                                                                                                                   |
| Chroma key on/off                                  | checkbox                  | `SectionToggle` "Remove a colour"                                                                                                                           |
| Key colour                                         | colour input              | `ColourField` with **Pick from video**                                                                                                                      |
| Similarity, smoothness, spill                      | range                     | `Slider` (%)                                                                                                                                                |
| Text starts at, lasts (`TextPanel`)                | number fields (s)         | `NumberField`, time format                                                                                                                                  |
| Text fade in, fade out (`TextPanel`)               | number fields (s)         | `Slider` (s)                                                                                                                                                |
| Text shadow                                        | checkbox                  | `Switch`                                                                                                                                                    |
| Music: lower the music while clips have sound      | checkbox                  | `Switch`                                                                                                                                                    |
| Download when it's done                            | checkbox                  | `Switch`                                                                                                                                                    |

Captions panel (`CaptionsPanel.svelte`):

| Setting                                         | Now               | Becomes                    |
| ----------------------------------------------- | ----------------- | -------------------------- |
| Cue from / to                                   | number fields (s) | `NumberField`, time format |
| Move all by                                     | number field (s)  | `NumberField` (s)          |
| Draw them into the picture                      | checkbox          | `Switch`                   |
| Also add a subtitle track viewers can switch on | checkbox          | `Switch` (keep this label) |
| Caption style                                   | `<details>`       | collapsible `Section`      |
| Caption file format (SRT / WebVTT / ASS)        | dropdown          | `Segmented`                |

The sidebar keeps its current order: selection first, then captions, project,
export. Each section becomes collapsible with its open state remembered for
the session (module-level state, not storage). Export stays expanded.

### 4.2 Audio editor (`AudioEditor.svelte`)

| Setting                         | Now                     | Becomes                                                                                                                        |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Clip volume, fades              | range                   | `Slider`                                                                                                                       |
| Track volume                    | range                   | `Slider` (dB)                                                                                                                  |
| Track mute                      | checkbox                | mute `IconToggle` next to the track volume slider                                                                              |
| Normalise                       | dropdown, 5 long labels | `Segmented` **Off / Peak / Loudness**; Loudness reveals a second `Segmented`: Streaming −14 / Podcast −16 / Broadcast −23 LUFS |
| Remove silence at start and end | checkbox                | switch in a `Field`                                                                                                            |
| Channels                        | dropdown, 5 options     | `Select` (labels too long for `Segmented`)                                                                                     |
| Speed                           | range                   | `Slider` with a mark at 1×                                                                                                     |
| Sample rate                     | dropdown                | `Select`, moved under a collapsed "Advanced"                                                                                   |
| Seconds of silence (insert)     | number                  | `NumberField` (s)                                                                                                              |
| Export format                   | dropdown, 14 formats    | `Select`, with the common four (MP3, M4A, WAV, FLAC) listed first                                                              |
| Export quality + target size    | range + number          | `QualityPicker`                                                                                                                |

### 4.3 Image editor (`ImageEditor.svelte`)

| Setting                                  | Now                          | Becomes                                                                     |
| ---------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Crop x / y / width / height              | number fields                | `NumberField` (px)                                                          |
| Straighten                               | range                        | `Slider` (°), default tick at 0                                             |
| Adjustments (brightness etc.)            | ranges + "Reset adjustments" | `Slider` each, default tick at 0; the section reset stays                   |
| Redaction kind                           | 3 radios                     | `Segmented`, icons: fill / blur / pixelate                                  |
| Redaction fill colour                    | colour input                 | `ColourField`                                                               |
| Resize width / height + Keep proportions | 2 numbers + checkbox         | `LinkedPair`                                                                |
| Border all sides + four sides            | 5 numbers                    | `LinkedPair`-style link toggle: linked shows one field, unlinked shows four |
| Border colour                            | colour input                 | `ColourField`                                                               |
| Apply these edits to all N images        | checkbox                     | stays a checkbox. It's a one-off confirmation, not a setting                |

### 4.4 Converter (`OptionsPanel.svelte`, `CombinePanel.svelte`, `SubtitlePanel.svelte`)

| Setting                                                                                               | Now                                | Becomes                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Quality                                                                                               | range                              | `QualityPicker`, size per preset when the estimate is known                                                               |
| Image size                                                                                            | dropdown, 8 sizes + custom         | `Segmented`: Original / 1920 / 1280 / 800 / Custom; Custom reveals a `NumberField`. The other sizes go into Custom's list |
| Video size                                                                                            | dropdown, 6 heights                | `Segmented`: Original / 1080p / 720p / 480p / Custom                                                                      |
| Background, icon background                                                                           | colour input                       | `ColourField`                                                                                                             |
| Remove audio, keep HDR, lossless                                                                      | checkbox                           | switch in a `Field`                                                                                                       |
| Trim start / end                                                                                      | number fields                      | `NumberField`, time format                                                                                                |
| GIF transparency threshold                                                                            | range                              | `Slider`                                                                                                                  |
| Cursor hotspot X / Y                                                                                  | number fields                      | `NumberField` (px)                                                                                                        |
| Metadata, codec, frame rate, audio bitrate, sample rate, channels, GIF fps / width / dither / palette | dropdowns in Advanced              | `Select`, staying under Advanced                                                                                          |
| Combine: Make                                                                                         | dropdown, 5 targets                | `Segmented`: MP4 / WebM / GIF / WebP / APNG                                                                               |
| Combine: Sound                                                                                        | dropdown of the user's audio files | `Select`                                                                                                                  |
| Combine: seconds per image                                                                            | number                             | `NumberField` (s)                                                                                                         |
| Subtitles: video, subtitles                                                                           | dropdowns                          | `Select` (lists of the user's files)                                                                                      |

---

## 5. Phases

Phases run in order, each building on the controls the earlier ones made, and
each leaves the app working. Browser tests that drive the old controls
(`selectOption`, `check`, `getByLabel` on a checkbox) are updated in the phase
that replaces those controls, but not run (§7.7).

### Phase 1 — Shared controls and the video editor sidebar

- Build `Field`, `Segmented`, `IconToggle`, `Slider`, `SectionToggle`,
  `Switch`, `Section`, `Select` and `NumberField` in `src/app/ui/`.
- Convert every setting in §4.1 and the captions panel, including export
  format and Fast/Exact. Leave the colour inputs (Phase 2) and the export
  quality slider and "Fit to MB" (Phase 3) as they are.
- Convert `OverallVolume.svelte` to `Slider`. It's shared with the audio
  editor, which picks the change up.
- Unit tests for the time parse/format functions.
- Update the browser tests that drive the replaced controls (§7.6).

**Done when:** the video sidebar and captions panel have no native `select`,
`checkbox`, `range` or `number` input left, other than the colour inputs, the
export quality slider and "Fit to MB"; a slider drag is still one undo step.

### Phase 2 — Colours

- Build `ColourField` with presets, project colours, the picker and hex entry,
  and `alpha`.
- Replace every colour input: video text, outline, background, key colour;
  image redaction and border; converter backgrounds.
- **Pick from video** for the key colour.

**Done when:** no `<input type="color">` remains.

### Phase 3 — Quality and export

- Build `QualityPicker`.
- Use it in the video export, audio export and converter quality.

**Done when:** each export shows Original quality / Balanced / Small / Custom
with a size where one is known, Original quality is the default everywhere, and
"Fit to MB" still works under Custom.

### Phase 4 — Audio editor, image editor and converter

- Convert every remaining setting in §4.2, §4.3 and §4.4 to the shared
  controls, including `LinkedPair` for resize and border.
- Remove the per-panel control styling these replace.

**Done when:** no settings panel in the app renders a native `select`,
`checkbox`, `range`, `number` or `color` input, apart from the "Apply to all"
confirmation.

## 6. Decisions

1. Balanced and Small are 70 and 40 on the quality scale and keep the
   resolution.
2. The key colour is picked by clicking the preview, not with the `EyeDropper`
   API.
3. Out of scope: dragging on a number's label to change it, and a before/after
   split view for image quality. Typing and arrow keys cover number entry.

## 7. Implementation notes

Facts about the codebase that every phase needs.

### 7.1 Stack

- Svelte 5 with runes (`$state`, `$derived`, `$props`), TypeScript, Tailwind
  v4. Theme tokens and the `icon-button` utility are in `src/app.css`. Use the
  token classes (`bg-surface`, `bg-raised`, `bg-sunken`, `border-line`,
  `text-fg`, `text-muted`, `text-accent`, `bg-accent`, `bg-accent-soft`,
  `text-on-accent`, `text-danger`, `text-warning`).
- `bits-ui` 2.19 is installed and already used (`Collapsible` in
  `src/converter/OptionsPanel.svelte`, `Dialog` and others elsewhere). Icons
  come from `@lucide/svelte`.
- `src/app/ui/` holds only `VirtualList.svelte` today.
- Editors call `apply(label, nextProject)` to change the project and record an
  undo step.

### 7.2 bits-ui behaviour to rely on

- `ToggleGroup` with `type="single"`: the root gets `role="group"`, and each
  item gets `role="radio"` and `aria-checked`. Clicking the selected item
  clears the value to `''`, so `Segmented` must ignore an empty value to keep
  one option selected. Values are strings; map to and from numbers in
  `Segmented`.
- `Slider` with `type="single"`: `value`, `onValueChange` (fires while
  dragging), `onValueCommit` (on release). `Slider.Root` is the container;
  render your own track `span` holding `Slider.Range`, then
  `Slider.Thumb index={0}`. The thumb has `role="slider"`: give it
  `aria-label={label}`, because tests find sliders by name.
- `Switch`: `checked`, `onCheckedChange`, renders `role="switch"`.
  Playwright's `.check()` and `toBeChecked()` work on it.
- `Select` with `type="single"`: `Root`, `Trigger`, `Portal`, `Content`,
  `Viewport`, `Item`. It isn't a native `<select>`, so a test's
  `selectOption()` stops working: tests must click the trigger, then the
  option.

### 7.3 Undo

`src/project/history.svelte.ts` merges repeated commands with the same label
inside a short window into one undo step. A slider must call its `onChange`
with one constant label for the whole drag. A typed value is one command.

### 7.4 Existing helpers and components

- `VideoEditor.svelte` has `db(gain)` (linear gain → dB string), `num(event)`
  and a `field` class string.
- `src/app/format.ts` has `formatDuration` (whole seconds, for clocks). The
  time `NumberField` needs its own parse and format with hundredths (`m:ss.ff`,
  `h:mm:ss.ff` past an hour; plain seconds accepted as input). Put them in a
  `.ts` file next to the control and unit-test them in `tests/unit/`.
- `src/editors/shared/OverallVolume.svelte` is a dB range with a `disabled`
  state and hint, imported by both the audio and video editors. Keep its
  slider's accessible name starting "Overall volume".
- `ChromaKeyFields.svelte` has Green/Blue preset buttons and an `EyeDropper`
  button. Phase 2 replaces the `EyeDropper` with **Pick from video**. Keep the
  section's accessible name "Chroma key".
- Shape: `setAspect(key)` in `VideoEditor.svelte` takes `'source'` or an
  `ASPECTS` key (`src/project/video.ts`). The selected tile is whichever
  matches the project's width and height: the first video clip's size rounded
  to even numbers for Source, otherwise the matching `ASPECTS` entry. No tile is
  selected for any other size.

### 7.5 Data-model defaults for on/off sections

- Text `outline: number` (fraction of the font size; `0` is off). Default on
  value: `0.06`, the title style's.
- Text `box: string | null`, as `#rrggbbaa`. Default on value: `#000000` at 0.7
  opacity, as `TextStyleFields.svelte` does now.
- Chroma `key: ChromaKey | null`; on value `DEFAULT_KEY` from
  `src/project/video.ts`.

### 7.6 Browser tests that touch these controls

Search `tests/e2e/` for every label you change. The known touchpoints:

| Test                          | Uses                                                            | Phase                                       |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `video-copy.spec.ts:101, 121` | `getByLabel(/Fast export without re-encoding/)` `toBeChecked()` | 1: radio "Fast" checked                     |
| `video-crop.spec.ts:39`       | combobox "Shape" `selectOption('1:1')`                          | 1: click radio "1:1"                        |
| `video-text.spec.ts:88`       | `getByLabel('Also add a subtitle track').check()`               | 1: works with a switch if the label is kept |
| `video-text.spec.ts:99–101`   | combobox "Export format" `selectOption('mp4' / 'webm')`         | 1: click radio "MP4" / "WebM"               |
| `audio-editor.spec.ts:77`     | slider `/^Overall volume/`                                      | 1: keep the name                            |
| `convert-image.spec.ts:105`   | slider "Quality"                                                | 3                                           |
| `a11y.spec.ts`                | axe checks over every screen                                    | all                                         |

### 7.7 Working rules

- **Never run Playwright.** It saturates the user's machine. Update the
  browser tests to match your changes, but don't run them, and list which ones
  you changed.
- Verify with `npx svelte-check --threshold error`, `npx eslint <changed
files>`, `npx prettier --check <changed files>` (`--write` to fix) and
  `npx vitest run <specific test files>`.
- Don't commit, don't build, and don't touch `docs/`, which is the generated
  site.
- Comments: none unless they carry a unit, a cross-file contract or a gotcha
  the code can't show, one line each. No narration, no history.
- Build exactly what this spec says for your phase. No extra features, no
  keyboard shortcuts beyond the standard ARIA ones, desktop layouts only. No
  migration or backwards-compatibility code; nothing is deployed.
- If the spec is wrong or impossible somewhere, do the closest sensible thing
  and say so in your report rather than stopping.
- Don't write any person's real name into code, tests or comments.
- Other uncommitted work may be in the tree. Leave anything outside your phase
  alone.

### 7.8 Controls built in Phase 1

In `src/app/ui/`. Read the source for detail; this is the summary.

- `Field`: `label`, `hint?`, `changed?`, `onReset?`, `children`. A
  `role="group"` named by the label; Reset shows when `changed` and `onReset`
  are both set.
- `Segmented<T extends string | number>`: `label`, `hideLabel?`, `hint?`,
  `options: SegmentedOption<T>[]` (`{ value, label?, icon?, tooltip?,
disabled? }`, exported from the module script), `value: T | null` (`null`
  selects nothing), `disabled?`, `onChange(v)`, and an `option` snippet to
  replace an option's content. Items are `role="radio"`.
- `IconToggle`: `label`, `pressed`, `icon`, `pressedIcon?`, `disabled?`,
  `onChange(pressed)`.
- `Slider`: `label`, `value`, `min`, `max`, `step = 1`, `defaultValue?`,
  `unit = ''`, `decimals?`, `signed?`, `format?(v)`, `marks?: { value, label
}[]`, `compact?`, `disabled?`, `hint?`, `onChange(v)`. The thumb's name is
  `label`; the value box is a textbox named "`{label} value`". The caller
  converts model units (pass `opacity * 100`, get back `v / 100`).
- `Switch`: `label`, `hint?`, `checked`, `disabled?`, `onChange(checked)`.
- `SectionToggle`: `label`, `checked`, `disabled?`, `onChange`, `children`
  (shown only when on). The caller remembers the last on value.
- `Section`: `id`, `title`, `detail?`, `icon?`, `label?`, `level?: 3 | 4`,
  `collapsible = true`, `defaultOpen = true`, `children`. Open state is kept
  per `id` for the session.
- `Select<T extends string>`: `label`, `hideLabel?`, `options: SelectOption[]`
  (`{ value, label, style? }`), `value`, `disabled?`, `onChange`. The trigger
  is `role="combobox"` named by the label.
- `NumberField`: `label`, `hideLabel?`, `value: number | null`, `min?`,
  `max?`, `step?`, `unit?`, `time?`, `decimals?`, `placeholder?`,
  `disabled?`, `onChange(v)`, `onClear?`. A text input with
  `role="spinbutton"`; `time` shows `m:ss.ff`. Clearing it calls `onClear`, or
  restores the old value.
- `number.ts`: `formatTime`, `parseTime`, `parseNumber`, `formatValue`,
  `decimalsOf`, `clamp`, `snapToStep`.
- `ResetButton`: the small reset used by `Field` and `Slider`.

Phase 1 notes that later phases depend on:

- `TextStyleFields` takes a `defaults: TextStyle` prop (titles pass
  `TITLE_STYLE`, captions `CAPTION_STYLE`) for slider defaults and on values.
- Text background opacity is a temporary `Slider`; Phase 2 folds it into
  `ColourField`'s `alpha`.
- The video editor's Delete/undo key handler ignores focus in
  `[role=radio]`, `[role=switch]` and `[role=combobox]`. Any new focusable
  control role needs adding there.
- Music clips have no mute field, so music volume has no mute toggle. That's
  out of scope.

### 7.9 Built in Phase 2

- `ColourField` (`src/app/ui/ColourField.svelte`, helpers in `colour.ts`):
  `label`, `hideLabel?`, `value` (`#rrggbb`, or `#rrggbbaa` with `alpha`),
  `alpha?`, `disabled?`, `picking?`, `onPick?(picking)`, `onChange(value)`.
  The project-colour row comes from a context set with
  `provideProjectColours(() => string[])`, exported from its module script.
- Pick from video: `VideoEditor` owns the `pickingKey` state; the preview drops
  the selected clip's key while picking, and `session.colourAt(x, y)` reads the
  pixel in the worker.
- The image editor's Delete/undo key handler doesn't yet skip focus in
  `[role=slider]`, `[role=radio]`, `[role=switch]` or `[role=combobox]` as the
  video editor's does (§7.8). Fix that in Phase 4, when the image editor gets
  these controls. The audio editor's handler needs the same check.

### 7.10 Built in Phase 3

- `QualityPicker` (`src/app/ui/QualityPicker.svelte`): `label = 'Quality'`,
  `quality` (1..100), `targetMb?`, `estimate?(quality) => bytes | null`,
  `disabled?`, `onChange(quality)`, `onTargetMb?(mb | null)`. The module
  script exports `QUALITY_PRESETS`. Custom shows a "Quality level" `Slider` and,
  when `onTargetMb` is given, a "Fit to file size" `NumberField`.
- It's in use in the video export, the audio export and the converter's
  Quality. The converter doesn't pass `onTargetMb`: its own "fit to size" chips
  and field stay separate, because they also apply to outputs with no quality
  setting. Phase 4 converts that field to the shared controls but keeps it
  separate.
- The audio editor's Delete/undo key handler already ignores `[role=slider]`
  and `[role=radio]`. Check whether it also needs `[role=switch]` and
  `[role=combobox]` once Phase 4 adds those.
