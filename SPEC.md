# Media Editor — Specification

A browser-based converter and editor for images, audio and video that runs
entirely on the user's device. No file, frame, byte of metadata or usage event
ever leaves the browser.

Status: draft v0.3 · 2026-10-05

---

## 1. Goals

1. **Convert** almost any common image, audio or video file into another format,
   one file or a batch at a time.
2. **Edit** with the basic operations people actually need: trim, cut, split,
   join, splice, crop, rotate, resize, levels and fades.
3. **Compose** several inputs into one output: join clips, lay music under
   video, build a slideshow from images, splice audio.
4. **Stay fully client-side.** The project is open source; the code is the
   evidence.

## 2. Non-goals

- Accounts, sync, sharing links, cloud storage, server-side rendering.
- Analytics, telemetry, crash reporting, A/B tests, third-party fonts or CDNs.
- Pro-grade editing: colour grading, keyframed effects, motion graphics,
  multicam, plugins.
- AI features that need a server (transcription, upscaling, background
  removal). On-device models can be revisited later.
- Document formats (PDF, DOCX) as input. Media only.
- Very long jobs. Outputs are held in memory; oversized jobs get a warning
  (§4.3), not a streaming-to-disk path (see §5.8).

## 3. Audience and security

Users are people who do not want to upload their media to a third party:
journalists, lawyers, medical staff, people handling personal photos and
recordings, and anyone who simply prefers not to.

The source is public, so the client-side claim is checked by reading the code,
not by machinery inside the app. What the app itself still does:

- **No server-side processing.** The host serves static files only.
- **No third-party requests.** No analytics, CDNs or external fonts; WASM cores
  are served from the same origin. A strict CSP (§4.5) backs this up.
- **Metadata stripped by default** on export, including the places it usually
  survives (§7.6).
- **Untrusted input stays sandboxed.** Decoders run as WASM in workers. SVG is
  rasterised in WASM with no network or file access, never inserted into the
  DOM.
- **Works offline** once loaded (§4.8).

## 4. Architecture

### 4.1 Overview

```
 UI (main thread)
   │  project state (EDL)  ·  job queue  ·  hosts preview canvases
   ▼
 Engine router ── probes inputs, picks an engine per job
   ├── Native engine     WebCodecs + Mediabunny (demux/mux) + WebGL2 compositor
   ├── FFmpeg engine     custom ffmpeg.wasm core (fallback, long tail)
   ├── Image engine      wasm-vips (common formats, colour, 16-bit)
   ├── Magick engine     magick-wasm (long-tail images, camera RAW, HEIC)
   └── Audio engine      PCM block DSP in a worker + streaming encoders
   ▼
 Output ── in-memory Blob → download / share
```

Every engine runs in Web Workers, scheduled by a pool that keeps the CPU busy
(§4.6). The main thread only runs the interface (§4.7). Web Audio
(`OfflineAudioContext`, `decodeAudioData`) is not available in workers, so the
audio engine does not use it (§7.3).

### 4.2 Two video/audio engines, on purpose

**Native engine (preferred).** WebCodecs gives hardware-accelerated decode and
encode and is typically an order of magnitude faster than WASM. Comparable
projects that relied on ffmpeg.wasm alone found video "painfully slow".
[Mediabunny](https://mediabunny.dev) (MPL-2.0) reads and writes MP4, MOV, MKV,
WebM, Ogg, MP3, WAV, ADTS, FLAC and MPEG-TS, streaming from `File` objects
without loading them into memory. Its extensions add WASM encoders for MP3,
AAC and FLAC and decoders for ProRes, AC-3/E-AC-3 and DTS, covering browsers
whose WebCodecs lack them.

**FFmpeg engine (fallback).** The stock ffmpeg.wasm core is FFmpeg 5.1 (2022),
barely maintained, and lacks AV1 and Speex. We maintain our own core build
(scripts in `wasm/ffmpeg/`):

- Current FFmpeg release, plus x264, x265, libvpx, LAME, Vorbis, Opus, Theora,
  libwebp, **dav1d** (AV1 decode), **SVT-AV1** (AV1 encode) and **libspeex**.
- A configurable pthread pool and `MAXIMUM_MEMORY`. The stock MT core pins a
  fixed 1 GB heap and pre-spawns 32 threads regardless of `-threads`.
- Loaded directly inside our own pool worker, not through the `@ffmpeg/ffmpeg`
  wrapper (which spawns a worker of its own).
- A fresh instance per job. Re-running `exec` in one instance eventually fails
  with "memory access out of bounds"; the compiled module is cached, so a
  fresh instance is cheap.

Step 27 (§12) also evaluates **libav.js** (modular builds, an API-level
demux/decode instead of a CLI) as the base for this engine before committing.

**Routing rule.** For each job:

1. Probe the input (Mediabunny first; FFmpeg if Mediabunny cannot open it).
2. If no re-encode is needed (container change only, or trim on keyframes),
   remux by copying packets directly. Mediabunny's Conversion API currently
   forces a transcode when trimming, so trims copy packets through
   `EncodedPacketSink` instead.
3. Else if Mediabunny can read the container, every input codec is decodable
   (WebCodecs or a Mediabunny extension), and the target codec is encodable,
   and the combination is not on the **quality denylist** → native.
4. Else → FFmpeg.

`isConfigSupported` answers "can it", not "does it do it well". The denylist
records known-bad combinations (e.g. Safari's low-quality H.264 encoder on
macOS) and routes them to FFmpeg.

The router is a pure function of (probe result, job, capability table,
denylist) and is unit-tested in isolation. Which engine ran, and why, is shown
only in a job's advanced details.

**Browser realities the capability table must encode** (verify at build time):

| | Gaps |
|---|---|
| Chrome / Edge | Edge on Windows often lacks HEVC encode. Quantizer (CRF-like) mode is Chromium-only. |
| Firefox | No AAC or HEVC encode (AAC via Mediabunny extension). No WebCodecs on Android. |
| Safari | No AV1 encode. AudioEncoder only from Safari 26. |
| All | No MP3 or FLAC encode via WebCodecs (Mediabunny extensions). |

### 4.3 Size limits

Outputs are built in memory and handed to the user as a `Blob`. Inputs are
read lazily from the `File`, so only output size and the working set matter.

| Platform | Default working-set budget per job | Warn when estimated output exceeds |
|---|---|---|
| Desktop | FFmpeg heap set by our build (2 GB) | FFmpeg path 1 GB · native path 2 GB |
| Mobile Chromium | ~600 MB | 300 MB |
| iOS / iPadOS | ~300 MB WASM | 150 MB; video through FFmpeg always warns |

- iOS kills the tab without an error once WASM memory runs out, and usable
  memory drops after a reload. `navigator.deviceMemory` is Chromium-only, so
  budgets are chosen by platform, refined by `deviceMemory` where present.
- A warning lets the user proceed anyway.
- Memory failures are caught (`RangeError` from allocation, worker crash) and
  the job is re-queued alone. If it fails alone, it fails with a clear message.
- Mediabunny's MP4 `fastStart: "in-memory"` holds every chunk until the end,
  doubling peak memory. Use it below ~500 MB of output; above that, write the
  index at the end.
- A job that stops reporting progress for 30 s is flagged as possibly stuck,
  with a cancel button. FFmpeg jobs can hang; this is not optional.
- Nothing is persisted between sessions unless the user explicitly saves a
  project.

### 4.4 Hosting and cross-origin isolation

The app is hosted on **GitHub Pages**, built and published by a GitHub Actions
workflow. Built WASM cores are deployed, never committed. Vite's `base` is the
project path (`/media-editor/`) unless a custom domain is used; the service
worker's scope follows it. Pages caps single files at 100 MB, well above any
core.

Threaded WASM (FFmpeg, wasm-vips, threaded encoders) needs
`SharedArrayBuffer`, which needs:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

GitHub Pages cannot send headers, so the service worker adds them:

- `index.html` registers the worker before the module script. On the very
  first visit, once the worker activates and the page is not yet controlled,
  the page reloads once so the document itself is served through the worker.
- The worker's `fetch` handler copies every response into a new `Response`
  with COOP, COEP and the CSP header (§4.5) set. Opaque responses
  (`status === 0`) pass through untouched.
- Registration is skipped when `crossOriginIsolated` is already true, which is
  the case on the Vite dev server: it sends the same headers natively.
- Detect `crossOriginIsolated` once at boot. Without it (service workers
  disabled, private modes that block them): single-threaded FFmpeg,
  magick-wasm in place of wasm-vips, more parallel jobs instead of threads.

### 4.5 Content Security Policy

```
default-src 'none';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
style-src 'self';
style-src-attr 'unsafe-inline';
font-src 'self';
img-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'self';
manifest-src 'self';
form-action 'none';
frame-ancestors 'none';
base-uri 'none';
```

- `style-src-attr 'unsafe-inline'` covers inline `style` attributes from Svelte
  templates and Bits UI. Drop it if the e2e suite passes without it.
- `connect-src 'self'` blocks `fetch(blob:)`, so WASM loads from same-origin
  URLs, never the `toBlobURL` pattern from ffmpeg.wasm's examples.
- `WebAssembly.compileStreaming` needs `Content-Type: application/wasm`. Fall
  back to `arrayBuffer()` + `compile` for misconfigured self-hosted servers.
- The service worker sends the policy as a header on every response (§4.4).
  The first, uncontrolled load gets it from a `<meta>` tag, where
  `frame-ancestors` is ignored.
- Trusted Types (now in all three engines) is optional later hardening.

### 4.6 Concurrency and scheduling

The goal is to keep every core busy during a batch or a long job, without
starving the interface or running out of memory.

**Budget.** The scheduler hands out *thread slots*, not worker counts. The
starting point is `navigator.hardwareConcurrency - 1`, but browsers falsify it:
Safari caps it at 8, Firefox's fingerprinting protection and Brave report small
or random values. So the scheduler **calibrates**: it adds a worker while
measured throughput keeps rising and stops when it plateaus. On Chromium,
`PressureObserver` (Compute Pressure API) backs it off under "serious" or
"critical" pressure.

**Choosing how to spend the slots.**

- *Many jobs* (a batch): one job per slot on single-threaded builds.
  Parallelism across files beats threading within a file.
- *Few large jobs*: threaded builds, with `-threads` (or the build's pool size)
  set to the slots the job holds. At most two threaded FFmpeg instances at
  once, since each reserves its own heap.
- *Mixed*: large jobs take threaded slots first; small jobs fill the rest.
- Without cross-origin isolation, everything is single-threaded and parallelism
  comes from running more jobs.

**Other limits the scheduler respects.**

- *Hardware codecs.* WebCodecs runs on the GPU/media engine, not CPU slots, and
  devices cap concurrent sessions without exposing the cap. Allow 2 concurrent
  native encode jobs and back off if `configure` starts failing.
- *Memory.* Each job carries a memory estimate; a job waits if it would exceed
  the platform budget (§4.3).
- *Backpressure.* Inside a native job, demux → decode → composite → encode →
  mux run as concurrent stages with bounded queues (`decodeQueueSize`,
  `encodeQueueSize`). Every `VideoFrame` and Mediabunny `VideoSample` is closed
  in a `finally`; frames come from a small hardware pool and a leak stalls the
  decoder.

**Worker lifecycle.** Pool workers are long-lived, but WASM instances are not:
FFmpeg gets a fresh instance per job and other engines are recycled every N
jobs, so leaked WASM heap is returned. Compiled modules are cached
(`compileStreaming` on stable URLs lets the browser cache compiled code, and
our own loaders can post the compiled `WebAssembly.Module` to workers).
Cancelling a job terminates its worker and the pool replaces it.

**User control.** One app setting, in plain language: *Speed* — "Balanced"
(default), "Leave room for other apps" (half the slots) and "Maximum".

### 4.7 Keeping the interface responsive

The main thread renders the interface and handles input. Nothing else. Buttons
must respond immediately even while every core is busy.

- **Off the main thread:** decoding, encoding, probing, type sniffing,
  metadata parsing, hashing, thumbnail and waveform generation, ZIP creation,
  size estimation and project (de)serialisation for large projects.
- **Previews render in workers.** Preview and timeline canvases are handed to
  workers with `transferControlToOffscreen()`. Audio preview plays through an
  `AudioWorklet` fed from the audio worker over a `SharedArrayBuffer` ring
  buffer.
- **No copies across threads.** `File` objects are posted as handles.
  `ArrayBuffer`, `ImageBitmap` and `VideoFrame` are always transferred
  (`Comlink.transfer()`; Comlink clones by default).
- **Throttled progress.** One progress channel per worker, at most ~10 updates
  a second per job, batched into one `requestAnimationFrame`. No per-call
  callback proxies (they leak ports and flood the thread).
- **Large state.** Big probe results and batch lists use `$state.raw` to avoid
  Svelte's deep proxies. Batches of hundreds of files use a virtualised list;
  the timeline is drawn on a canvas.
- **Budget.** No main-thread task longer than 50 ms. Long Animation Frames
  reports offenders on Chromium; on Firefox and WebKit, measure with Event
  Timing and `requestAnimationFrame` gaps.

### 4.8 Offline, storage and page lifecycle

- **Service worker.** One small hand-written worker does header injection
  (§4.4) and caching, so cached responses carry the headers too. Precache only
  the app shell. WASM cores (tens of MB) are
  cached at runtime, cache-first, on hashed URLs, one cache per core version,
  old versions deleted on activate. A "Download everything for offline use"
  button fetches them all and shows the total size.
- **Persistence.** Call `navigator.storage.persist()`. Safari deletes all
  script-writable storage, including the service worker, after 7 days without
  a visit unless the app is installed.
- **Background tabs.** Chrome freezes hidden, silent, CPU-heavy tabs after
  5 minutes under Energy Saver; iOS suspends hidden tabs almost at once; Memory
  Saver can discard a tab and its in-memory outputs. During jobs: hold a
  Screen Wake Lock, listen for `freeze`/`resume`, and show "Keep this tab open
  until your files are ready".

## 5. Formats

Intake is generic: the user can drop any file. Its type is detected from its
signature bytes, not its extension, and it is routed to the first engine that
can decode it. A file no engine can decode is reported by its detected type
and marked unsupported. **Nothing fails silently**: every job ends in a result
or a plain-language error.

The tables are what we test and advertise at launch. Every format is confirmed
against the pinned engine builds and the fixture corpus before it is listed in
the UI.

### 5.1 Images

- **wasm-vips** (MIT) is the main engine: JPEG, PNG, WebP, GIF, AVIF, JPEG XL,
  TIFF and SVG (via resvg). It keeps 16-bit and float precision, handles ICC
  profiles, and reads and writes Ultra HDR gain-map JPEGs. Needs cross-origin
  isolation.
- **magick-wasm** (Apache-2.0) covers the long tail: camera RAW (LibRaw, incl.
  CR3), HEIC, JPEG 2000, PSD, EXR, DDS, FITS, TGA, QOI and the legacy formats.
  It is an 8-bit (Q8, no HDRI) build: 16-bit and HDR sources it handles are
  reduced to 8 bits, and EXR/Radiance HDR are tone-mapped, with a note on the
  card.
- **HEIC:** Safari 17+ decodes it natively; other browsers use magick-wasm.
- **ICO, CUR, ICNS:** our own small readers and writers. magick-wasm has no
  ICNS support, and ICO/CUR need control over PNG entries and hotspots.
- `createImageBitmap` is used for previews and thumbnails only. Export always
  decodes in WASM, so output is identical across browsers.

| Input | Formats |
|---|---|
| Common | JPEG, PNG, WebP, GIF, AVIF, BMP, SVG, ICO |
| Modern / phone | HEIC/HEIF, JPEG XL, APNG, animated AVIF, Ultra HDR JPEG, Live Photos (HEIC + MOV pair), Motion Photos (JPEG with embedded clip; the clip can be extracted) |
| Camera RAW | DNG, CR2, CR3, NEF, ARW, ORF, RW2, RAF, PEF, SRW |
| Pro / design | TIFF (multi-page, 16-bit), PSD (flattened), EXR, Radiance HDR, JPEG 2000, DDS, TGA |
| Legacy / niche | PCX, PPM/PGM/PBM/PNM, XBM, XPM, SGI, Sun Raster, ICNS, CUR, WBMP, QOI, FITS |

**Output:** JPEG, PNG, WebP, AVIF, JPEG XL, GIF, APNG, BMP, TIFF, ICO, ICNS,
CUR, TGA, QOI, PPM, JPEG 2000, PDF (one image per page).

**Colour.** The source's ICC profile (or CICP tags) travels with the pixels.
Outputs that can embed a profile keep it; outputs that can't (BMP, GIF, ICO,
QOI) are converted to sRGB. Dropping the profile without converting is how
Display-P3 phone photos come out washed out.

**HDR.** Ultra HDR JPEGs and HEIC/AVIF gain maps are detected and noted on the
card. JPEG → JPEG offers "Keep HDR"; other conversions drop the gain map and
say so.

**Orientation.** Each decoder reports whether it already applied orientation
(`createImageBitmap` and libheif do; most WASM decoders don't). Pixels are
normalised once, then the tag is dropped. Applying EXIF orientation on top of a
HEIF `irot` rotates twice.

### 5.2 Audio

| Input | Formats |
|---|---|
| Common | MP3, AAC, M4A, WAV, FLAC, OGG Vorbis, Opus, WMA |
| Lossless | ALAC, AIFF/AIFC, WavPack, Monkey's Audio (APE), TTA, TAK, DSD (DSF/DFF) |
| Pro / broadcast | BWF, RF64, W64, CAF, AC-3, E-AC-3, DTS, TrueHD |
| Phone / voice | AMR-NB/WB, 3GA, M4B, Speex, GSM |
| Legacy | Musepack (MPC), AU/SND, VOC, RealAudio |

Plus the audio track of any supported video.

**Output:** MP3, AAC/M4A, M4R (iPhone ringtone), M4B (audiobook with chapters),
ALAC, FLAC, WAV, AIFF, CAF, OGG Vorbis, Opus, WavPack, AC-3, AU.

### 5.3 Video

| Input | Formats |
|---|---|
| Common | MP4, M4V, MOV, MKV, WebM, AVI, WMV |
| Camera | MTS/M2TS (AVCHD), MXF, DV, 3GP/3G2 |
| Disc / broadcast | MPEG-PS (.mpg, DVD .vob), MPEG-TS |
| Legacy | FLV/F4V, RealMedia (RM/RMVB), ASF, OGV, NUT |
| Animated images | GIF, APNG, animated WebP/AVIF |

Codecs inside those containers: H.264, HEVC, AV1, VP8/VP9, MPEG-1/2/4 Part 2
(DivX/Xvid), H.263, WMV/VC-1, Theora, ProRes, DNxHD/HR, CineForm, MJPEG, FFV1,
Cinepak, Indeo.

**Output:** MP4 (H.264, HEVC, AV1), WebM (VP8, VP9, AV1), MKV, MOV (incl.
ProRes), AVI, MPEG-2 (DVD-compatible), 3GP, OGV, FFV1 MKV (lossless archive),
GIF, APNG, animated WebP.

AV1 output is offered only where WebCodecs can encode it. Elsewhere (Safari)
it is hidden, and H.264 is the default. SVT-AV1 in WASM stays available to
the router for edge cases but is never offered as a choice.

### 5.4 Icon tools

- **Favicon pack.** One PNG or SVG in; a ZIP out with:
  - `favicon.ico` (32 px; 16 and 48 optional)
  - `icon.svg` (if the source was SVG), with an optional dark-mode variant via
    `prefers-color-scheme`
  - `apple-touch-icon.png` (180 px, solid background, ~20 px padding)
  - `icon-192.png`, `icon-512.png`, and a 512 px maskable icon with its safe
    zone shown
  - `manifest.webmanifest` and the `<link>` tags to paste

  Every size is previewed, because small sizes often need a simpler mark.
- **App icons.** Windows `.ico` (PNG entries up to 256 px) and macOS `.icns`.
  macOS 26 puts icons whose edges aren't opaque inside a grey rounded square,
  so a full-bleed squircle template is offered.
- **Cursor.** `.cur` with a chosen hotspot.

### 5.5 Cross-type conversions

Any input can become any output type that makes sense for it.

| From | To |
|---|---|
| Video | GIF, APNG, animated WebP/AVIF, audio (extract track), a single frame, a frame sequence (ZIP), a contact sheet (grid of thumbnails) |
| Animated image (GIF, APNG, animated WebP) | Video, another animated format, a frame sequence (ZIP) |
| Images | Video (slideshow, per-image duration, optional audio bed), animated GIF/APNG/WebP (frames in order) |
| Audio + image | Video (static cover with audio, the "upload a podcast" case) |
| Motion Photo / Live Photo | Video, or the still image alone |

**Video → GIF** gets dedicated options, because naive GIFs look bad and are
huge:

- Trim range, frame rate (default 15), width (default 480 px), loop count
- Palette via FFmpeg `palettegen`/`paletteuse`: one for the whole clip, one per
  frame (`stats_mode=single` + `new=1`; sharper, larger), or "smallest file"
  (`stats_mode=diff` + `diff_mode=rectangle`)
- Dithering: none, Bayer, Floyd–Steinberg
- Target size (§7.7), here trading off frame rate, width and palette size
- A size comparison with animated WebP and MP4 for the same clip, since both
  are usually several times smaller

A "Best quality" choice uses gifski (WASM, AGPL like the project, §13), which
gives noticeably better GIFs than FFmpeg's palettes at a higher CPU cost.

### 5.6 Transparency

Alpha is preserved end to end wherever the formats allow it. Every card shows
whether the input has transparency, and the UI warns when the chosen output
will drop it.

| | With alpha |
|---|---|
| Image input / output | PNG, APNG, WebP, AVIF, JPEG XL, TIFF, ICO, ICNS, CUR, TGA, QOI, PSD (input), EXR (input); GIF as 1-bit |
| Video input | WebM (VP8/VP9 alpha), MOV (ProRes 4444, PNG, Animation/QTRLE), animated GIF/APNG/WebP |
| Video output | WebM (VP9 alpha), MOV (ProRes 4444), APNG, animated WebP; GIF as 1-bit |

- **Flattening.** Outputs without alpha (JPEG, BMP, MP4/H.264, most video)
  are flattened onto a background colour the user picks (default white).
- **GIF.** Partial transparency becomes on/off at a user-adjustable threshold.
- **Resampling.** Resize, free rotate and compositing interpolate on
  premultiplied pixels and unpremultiply afterwards; interpolating straight
  alpha leaves dark fringes. Storage and encoding use straight alpha. Export
  never round-trips through a 2D canvas.
- **Alpha video.** WebCodecs encoders generally reject `alpha: "keep"`, so the
  native route is Mediabunny's alpha support (alpha written as side data in
  WebM). Otherwise FFmpeg: `libvpx-vp9` with `yuva420p`, `prores_ks` 4444. On
  input, FFmpeg's built-in VP8/VP9 decoder drops alpha; force `-c:v libvpx-vp9`
  before `-i`.
- **Editors.** Previews use a checkerboard background. Free rotation and
  canvas extend fill with transparency when the output supports it. The video
  compositor respects alpha on the overlay track (logos, cut-outs).

### 5.7 Presets

Presets are named for what people want, not how it's done: "Smaller file",
"Best quality", "Works everywhere", "For WhatsApp", "For Discord (≤ 10 MB)",
"For email (≤ 25 MB)", "Podcast", "Lossless". Platform size limits change, so
they live in one data file, not in code. Codec, bitrate/CRF, resolution, frame
rate, sample rate and channels sit under Advanced (§6.2).

### 5.8 Later

- MIDI → audio (needs a soundfont synthesiser)
- Tracker modules: MOD, XM, IT, S3M (needs a libopenmpt build)
- PSD with layers kept separate; GIMP XCF
- Save directly to disk for large native jobs. Mediabunny's `StreamTarget`
  can write to the Origin Private File System (all browsers) or a
  `showSaveFilePicker` stream (Chromium), lifting the in-memory ceiling where
  it matters. Cheap to add when needed.
- macOS Icon Composer `.icon` output

## 6. Interface

### 6.1 Principles

The core job is: pick a file, pick what you want, get it. Everything else is
optional and stays out of the way until asked for.

- **Two decisions to a result.** Drop a file, pick an output, press Convert.
  Nothing else is required, and the defaults must be good enough that most
  people never change them.
- **Suggest the likely answer.** The output picker leads with 3–5 suggestions
  for the input (HEIC → JPEG, MOV → MP4, WAV → MP3, video → GIF). The full list
  is one tap further, grouped by Image / Video / Audio / Animated / Icon and
  searchable.
- **Plain language on the surface.** "Smaller file ↔ Better quality", not CRF.
  "720p", not 1280×720. "Works everywhere" and "Not supported on iPhone"
  badges, not codec names. Errors say what happened and what to do next.
- **Warnings inline, not modal.** "This will remove transparency", "This may
  be too large for your browser · Convert anyway". A modal is reserved for
  destructive actions.
- **One screen.** The converter is a single page that grows downward: drop zone
  → file cards → output picker → result. No wizard, no page changes.
- **Editors are a side door.** Editing is an action on a file card, never a
  step in the conversion flow.

### 6.2 Progressive disclosure

Three levels, each fully optional:

| Level | Where | Contains |
|---|---|---|
| Default | Always visible | File, output picker, estimated size, Convert |
| Options | "Options" expander on the job | Quality slider, size (Original / 1080p / 720p / …), fit to file size, remove audio, keep metadata, keep HDR, background colour for transparency |
| Advanced | "Advanced" inside Options | Codec, bitrate/CRF, frame rate, sample rate, channels, GIF palette and dithering, colour profile handling, engine used, full metadata |

Expanders remember their open/closed state per device. Every setting changed
from its default shows a small reset control, and a changed collapsed section
shows a summary ("720p · no audio") so nothing is hidden silently.

### 6.3 Visual design

Modern, calm and quick to read.

- **Layout.** Generous spacing, a centred column for the converter, rounded
  cards with subtle depth, large thumbnails. Single column on mobile.
- **Colour.** Neutral surfaces with one accent colour for the primary action.
  Light and dark themes follow the system, with a manual toggle.
- **Type and icons.** One self-hosted variable font (e.g. Inter) and one
  self-hosted icon set (e.g. Lucide). No external font or icon services.
- **Motion.** Short, purposeful transitions: cards animating in on drop,
  progress that moves smoothly, expanders that slide. All of it is disabled
  under `prefers-reduced-motion`.
- **Feedback.** The whole window is a drop target with a clear highlight on
  drag. Previews are live: crop, rotate, quality and GIF settings update the
  preview as they change, with a before/after toggle.
- **Trust, quietly.** One line under the drop zone: "Your files never leave
  this device." No badges, banners or lectures.
- **Accessible.** Keyboard reachable throughout, visible focus, screen-reader
  labels, WCAG AA contrast in both themes.

Built on Tailwind CSS with headless, accessible primitives (Bits UI for
Svelte), so the look is ours and the behaviour (menus, dialogs, focus
handling) is not reinvented.

### 6.4 Getting files in and out

- **In:** drop files or folders, pick files, or paste from the clipboard.
  Folder drops use `webkitGetAsEntry`; `readEntries` returns at most 100
  entries per call, so loop until empty, and grab entries synchronously inside
  the drop handler.
- **Chromium extras** (progressive enhancement): "Open with" from the OS via
  the File Handling API and `launchQueue`; "Share to" on Android via Web Share
  Target.
- **Out:** download per file, or "Download all" as one ZIP. Browsers prompt
  before multiple automatic downloads, so batches always go through the ZIP.
- **iOS:** a blob download lands in Files. "Save to Photos" uses
  `navigator.share({ files })`.

## 7. Features

### 7.1 Converter (the front door)

The flow is the one in §6.1. Behind it:

- Each file card shows a thumbnail or waveform, the name, a plain type
  ("Video · 2:14 · 84 MB") and the estimated output size. Codec, dimensions,
  bitrate and the rest are in the card's details.
- With several files, one "Convert all to" picker applies to the batch and any
  card can override it. The batch shows a total estimated size.
- Jobs run through a queue with per-job progress, time remaining and cancel.
- Download individually or as a ZIP. Each card shows the actual size next to
  the estimate.
- Any card has an "Edit" action that opens it in the matching editor.

### 7.2 Image editor

- Crop (free, fixed aspect ratios, exact pixels)
- Rotate 90°/180°, free rotate with auto-crop, flip H/V
- Resize (by px, %, longest edge; Lanczos in WASM, on premultiplied pixels)
- Adjust: brightness, contrast, saturation, exposure, white balance
- Auto-orient (§5.1), then discard the orientation tag
- Pad/canvas extend with colour, background colour for transparent → JPEG
- **Redact:** solid-fill rectangles only. Pixelation and blur can be partly
  reversed, so they are offered separately as **"Obscure (cosmetic)"**, with a
  note that they are not safe for sensitive information. Redacting also drops
  embedded thumbnails and flattens every layer, page and auxiliary image.
- Batch: apply the same edit stack to every selected image

Edits are a non-destructive stack, rendered on export. Previews render from a
downscaled proxy (iOS caps a canvas at 4096 × 4096), with tiles for
full-resolution zoom. Export never goes through a canvas.

### 7.3 Audio editor

- Waveform view with zoom, scrub, selection
- Trim, cut, split, delete selection, insert silence
- Join multiple files; multi-track with per-track offset (splice/overlay)
- Gain per clip and per track, with a level meter
- Fade in/out, crossfade between adjacent clips
- Normalise (peak and loudness, EBU R128 / target LUFS)
- Channels: stereo → mono, swap, extract left/right
- Speed change with pitch preserved; sample rate conversion
- Remove leading/trailing silence

**Engine.** Web Audio's offline rendering can't run in a worker and holds the
whole render as Float32 (an hour of 48 kHz stereo is ~1.4 GB, twice that with
the decoded source). Instead, all in a worker:

- Decode through Mediabunny's `AudioSampleSink` / `AudioDecoder` (FFmpeg for
  formats they can't read), streamed in blocks.
- Gain, fades, crossfades, mixing, channel operations and resampling are a
  small block-based DSP of our own. Time-stretch uses a WASM library (Rubber
  Band or SoundTouch).
- Loudness is measured with libebur128 (or the Rust `ebur128` crate) in WASM,
  then applied as gain.
- Encoding is streamed: WebCodecs `AudioEncoder`, Mediabunny's MP3/AAC/FLAC
  extensions, or FFmpeg for the rest (Vorbis, WavPack, AC-3).
- Waveforms are multi-resolution min/max peak tables computed once per asset.

### 7.4 Video editor

A timeline with one main video track, one overlay track (picture-in-picture,
images, logos) and any number of audio tracks.

- Import clips, images and audio into a media bin
- Trim (in/out), split at playhead, delete, reorder by drag
- Join clips of different resolutions/frame rates (normalised to project
  settings, letterboxed or cropped as chosen)
- Crop, rotate, flip, resize; output aspect presets (16:9, 9:16, 1:1, 4:5)
- Per-clip volume, mute, detach audio, replace audio, music bed with ducking
- Fade in/out (video to/from black, audio), simple crossfade transition
- Speed change (0.25×–4×)
- Extract frame as image, extract audio
- **Redact** a region for a time range with solid fill; "Obscure (cosmetic)"
  blur/pixelate as in §7.2. Video depixelation is easier than for stills,
  because many frames add up.

**Preview.** Native-decodable clips preview through WebCodecs into a WebGL2
compositor in a worker. Seeking is frame-accurate: decode from the previous
key packet and discard frames up to the target (Mediabunny's
`VideoSampleSink` does this). Clips only FFmpeg can decode get a
low-resolution **proxy** transcoded in the background on import, used for
preview only; the original is used on export.

**Export.** The project's edit decision list (§8) is compiled either into a
native render (decode → composite in WebGL2 → encode → mux) or into an FFmpeg
filtergraph. Same router rules as §4.2, evaluated over all clips in the project.

**Smart rendering** (fast path for cut-only edits): re-encode only the GOPs
that contain a cut and copy the rest. The re-encoded H.264/HEVC segments carry
different parameter sets, so use in-band parameter sets (`avc3`/`hev1`) or a
second sample description, or restrict smart rendering to matching encoder
settings.

### 7.5 Text and captions

**Text clips** on the overlay track: bundled fonts plus the user's own font
files, size, colour, outline, shadow, background box, position presets, and
fade in/out.

- Text is drawn by our compositor (2D `OffscreenCanvas` in the worker,
  uploaded as a texture). The FFmpeg export path overlays frames we render
  ourselves rather than using `drawtext`, so export matches preview exactly.
- User fonts load as `FontFace` objects inside the compositor worker and are
  stored with the project bundle, never fetched.

**Captions** are a separate track of timed cues.

- Import SRT, WebVTT and ASS; edit cues in a list (text, start, end, nudge all).
- **Burn in:** rendered through the same text path.
- **Soft subtitles:** muxed as a track (`mov_text` in MP4, WebVTT in WebM,
  SRT/ASS in MKV).
- The converter can extract subtitle tracks from a video to SRT or VTT, and
  add a subtitle file to a video without re-encoding.

Automatic transcription is out of scope (§2).

### 7.6 Metadata

On export, metadata is **stripped by default**. Embedded cover art in audio is
kept by default and can be removed.

On the surface this is one plain line on the card, shown only when it matters:
"Location data found · will be removed". The full list of fields, and the
options to keep all, keep technical only (colour profile, orientation) or keep
selected fields, are in the card's details.

**Reading** uses ExifReader (MPL-2.0, maintained). **Stripping** is our own
rewriter per container (JPEG segments, PNG chunks, RIFF chunks, ISO-BMFF
boxes, ID3 / Vorbis comments), applied after encoding, because re-encoding
alone does not reliably remove everything. It covers the places stripping
usually misses:

- EXIF IFD1 thumbnails, Photoshop APP13 thumbnails, MPF previews, depth and
  gain-map images: these can contain the original, uncropped image
- MakerNotes
- PNG `eXIf`, `iTXt` (XMP) and `tEXt` chunks
- C2PA / Content Credentials (JPEG APP11, PNG `caBX`, ISO-BMFF `uuid`).
  Stripping removes provenance as well; the details panel says so.
- Bytes after the end-of-image marker (Motion Photo clips, Samsung trailers,
  the aCropalypse class of leak)
- MP4 `udta`/`meta`/`©xyz` atoms and data tracks (GoPro GPMF, Apple `mebx`,
  DJI GPS subtitles). FFmpeg jobs map streams explicitly, drop data streams
  (`-dn`), use `-map_metadata -1` and `-fflags +bitexact`.
- ID3 PRIV, GEOB, TXXX and COMM frames

### 7.7 Output size and target sizes

Every job, in the converter and in each editor's export dialog, shows an
estimated output size that updates as settings change. Every finished job shows
the actual size.

**Estimating.**

- *Images:* encode for real. Single images are fast enough to show the exact
  size; batches encode a sample and extrapolate until the real jobs run.
- *Constant or target bitrate (audio and video):* (video + audio bitrate) ×
  duration, plus a container overhead allowance.
- *Quality modes (CRF, VBR):* the bitrate is unknown up front. Encode three
  short samples spread across the source at the chosen settings and
  extrapolate. Show the result as a range ("38–47 MB"), not a single number.
  On the native path, quality mode uses WebCodecs `bitrateMode: "quantizer"`
  where supported (Chromium) and a VBR bitrate otherwise.

**Target size mode.** Under Options: "Fit to [ 10 ] MB", with quick picks (8,
10, 25, 50, 100 MB) and a custom value. The target is a hard maximum: the app
never hands over a file larger than the target without saying so.

- *Video:* reserve 3% for container overhead, give audio a fixed bitrate
  (stepping down 128 → 96 → 64 kbps, then mono, as the budget shrinks), and
  give the rest to video. FFmpeg uses two-pass encoding. WebCodecs has no
  two-pass mode and hardware encoders overshoot, so the native path aims 5–8%
  under the computed bitrate, measures, and re-encodes once with a corrected
  bitrate if still over.
- *Audio:* bitrate = budget ÷ duration, clamped to the codec's usable minimum.
- *Images:* binary search on quality; if the lowest acceptable quality is still
  too large, scale down and search again.

**Levers.** When the budget is tight, the app opens Options with a plan and
lets the user adjust it, with the estimate and a quality indicator updating
live:

- Resolution (2160p → 1080p → 720p → 480p, or longest edge for images)
- Frame rate (60 → 30 → 24)
- Codec (AV1 or HEVC are smaller than H.264, with a compatibility warning)
- Quality / bitrate slider
- Audio: bitrate, mono, or remove audio
- Trim, when no other lever gets there

The quality indicator is based on bits per pixel per frame. Below a floor, it
warns that the output will look blocky and suggests the lever that helps most,
usually dropping resolution.

## 8. Project model

One schema for all three editors. Projects are plain JSON, version-tagged.

```ts
type Project = {
  version: 1;
  kind: "image" | "audio" | "video";
  settings: OutputSettings;
  assets: Asset[];                   // references to user files, never the bytes
  tracks: Track[];                   // empty for image projects
  imageOps?: ImageOp[];              // image projects only
};

type Asset = { id: string; name: string; size: number; hash: string; probe: ProbeResult };

type Track = { id: string; type: "video" | "overlay" | "audio" | "captions"; clips: Clip[]; gain: number; muted: boolean };

type Clip = {
  id: string;
  assetId: string;
  start: number;      // seconds on the timeline
  in: number;         // seconds into the source
  out: number;        // seconds into the source
  speed: number;
  gain: number;       // linear, 1 = unity
  fadeIn: number;     // seconds
  fadeOut: number;    // seconds
  transform?: Transform;
  effects: Effect[];
  text?: TextContent;  // text clips on the overlay track, cues on a captions track
};
```

Saving a project downloads the JSON. Re-opening asks the user to re-supply the
files and matches them by `hash`. An optional "bundle" export (ZIP of JSON +
media) is available for moving a project between machines. Undo/redo is a
command stack over this model.

## 9. Technology

| Concern | Choice |
|---|---|
| Language | TypeScript, strict |
| Hosting | GitHub Pages, deployed by GitHub Actions |
| Build | Vite |
| UI | Svelte 5 (small runtime; fine-grained reactivity suits a timeline and long batch lists) |
| Styling | Tailwind CSS, Bits UI primitives, Lucide icons, self-hosted font |
| Video/audio container I/O | Mediabunny, plus its codec extensions |
| Codecs (fast path) | WebCodecs |
| Codecs (fallback) | Our own ffmpeg.wasm core build (or libav.js, decided in step 27) |
| Image engines | wasm-vips; magick-wasm for the long tail; own ICO/CUR/ICNS code |
| Audio | Own block DSP, Rubber Band or SoundTouch (WASM), libebur128 (WASM) |
| Metadata | ExifReader for reading; own per-container strippers |
| Worker RPC | Comlink |
| Zip | a streaming zip writer (e.g. client-zip), in a worker |
| Offline | Hand-written service worker: header injection and caching |
| Tests | Vitest (unit), Playwright (e2e on Chromium and Firefox; WebKit non-blocking) |

All WASM binaries are vendored into `public/` at build time from pinned
versions, or built from the scripts in `wasm/`; nothing is fetched from a CDN.
jSquash and ffmpeg.wasm are slow-moving upstreams: pin versions and expect to
fork. Avoid engines that have moved to commercial licence keys.

### 9.1 Browser support

- **Supported:** current Chromium (Chrome, Edge, Brave, Arc) and current
  Firefox. The native engine checks capabilities per codec at runtime; gaps
  fall back to FFmpeg rather than failing.
- **Best effort:** Safari. It gets the same capability checks and fallbacks,
  and its tests run, but Safari-only failures don't block a release.
- **WebGPU** is not yet everywhere (Firefox on Linux and Android lag). The
  compositor targets WebGL2; WebGPU is a later upgrade path.
- **Mobile** browsers are supported for converting, within the memory budgets
  of §4.3. The editors are desktop-first but must remain usable on a tablet.

### 9.2 Performance budgets

- App shell: < 200 KB gzipped JS, interactive in < 1 s on a mid-range laptop.
  First load downloads no engine; a test enforces the total.
- No engine is loaded until a job or preview needs it. The first use of a
  heavy engine (FFmpeg ~30 MB, wasm-vips ~12 MB, magick-wasm ~15 MB) shows the
  download size and progress.
- No main-thread task over 50 ms, including during a full-load batch (§4.7).
- A batch keeps CPU utilisation near the calibrated slot budget (§4.6).

## 10. Repository layout

```
src/
  app/              shell, routing, layout, theme
  converter/        batch converter UI
  editors/
    image/
    audio/
    video/          timeline, preview compositor
  engine/
    router.ts       engine selection (pure)
    capabilities/   capability tables, quality denylist
    scheduler/      thread slots, calibration, memory budget, worker pool
    probe/          unified probe result from Mediabunny / FFmpeg
    native/         WebCodecs + Mediabunny pipelines
    ffmpeg/         FFmpeg worker, EDL → filtergraph compiler
    image/          wasm-vips and magick-wasm workers, ICO/CUR/ICNS
    audio/          block DSP, loudness, streaming encoders
  project/          model, commands, undo, (de)serialisation
  metadata/         readers and per-container strippers
  io/               file input, type sniffing, downloads, share, zip
  sw/               service worker, COOP/COEP injection, engine caching
  workers/
wasm/
  ffmpeg/           custom core build scripts (Emscripten, pinned versions)
public/
  wasm/             vendored and built cores (build step, not committed)
tests/
  fixtures/         small media corpus, generated by a script
  unit/
  e2e/
THIRD_PARTY_NOTICES
```

## 11. Testing

- **Fixture corpus.** A script generates short sample files in every
  advertised input format (using native ffmpeg in CI) so the repo doesn't hold
  large binaries.
- **Conversion matrix.** Each advertised input → each advertised output is an
  e2e case. Assertions are on probe results (codec, dimensions, duration within
  tolerance, channel count), not byte equality.
- **No silent failures.** Every job in the matrix ends in a result or a
  user-visible error; a job that ends in neither fails the test.
- **Router tests.** Table-driven unit tests over capability tables and the
  denylist for each browser.
- **Metadata test.** Fixtures carrying data in every place listed in §7.6
  (GPS, thumbnails, MakerNotes, XMP, C2PA, trailing bytes, GPMF tracks, ID3
  frames); the default export must contain none of it.
- **Colour test.** Display-P3 and AdobeRGB fixtures keep their appearance
  through every output.
- **Alpha test.** Fixtures with semi-transparent edges round-trip through
  every alpha-capable output with colour intact and no fringes, and flatten
  correctly into every output without alpha.
- **Target-size test.** Every target-size job across the fixture corpus must
  come in at or under its target.
- **Responsiveness test.** Run a large batch at full load, then click through
  the interface; every interaction must respond within 100 ms and no
  main-thread task may exceed 50 ms.
- **Scheduler tests.** Unit tests over simulated core counts, memory budgets
  and job mixes.
- **First-load test.** The app shell stays within the §9.2 budget and loads no
  engine.
- **Offline test.** Load the app, warm the cache, set the context offline, run
  the conversion matrix; `crossOriginIsolated` must still be true.

## 12. Implementation plan

Eight phases, built in order. Steps are numbered once across the whole plan so
any step can be referred to by number alone. Each phase ends deployable.

### Phase 1 — Foundation

1. **Repository.** Vite + Svelte 5 + TypeScript (strict), Vitest, Playwright,
   lint and format. `LICENSE` (AGPL-3.0-or-later), a `THIRD_PARTY_NOTICES`
   skeleton, README.
2. **Deploy.** GitHub Actions workflow that tests, builds and publishes to
   GitHub Pages; Vite `base` set to the project path. The dev server sends
   COOP, COEP and the CSP natively. (§4.4)
3. **Service worker.** Header injection on every response, first-visit reload,
   app-shell precache, runtime cache for engines, `storage.persist()`. (§4.4,
   §4.8)
4. **CSP.** Policy as `<meta>` and as injected header; the e2e suite runs under
   it. (§4.5)
5. **Design system.** Tailwind, Bits UI, self-hosted font and icons, light and
   dark themes, motion with reduced-motion support. (§6.3)
6. **App shell and intake.** Whole-window drop target, file picker, folder
   drops, paste; file cards in a virtualised list. (§6.1, §6.4, §7.1)
7. **Type sniffing.** Signature detection, the plain-type line on each card,
   and the "unsupported" path. (§5)
8. **Worker RPC.** Comlink with transfer by default, one progress channel per
   worker, rAF-batched updates. (§4.7)
9. **Scheduler.** Thread slots, calibration, `PressureObserver`, platform
   memory budgets, worker pool and recycling, cancel, 30 s stall detection.
   (§4.3, §4.6)
10. **Job queue UI.** Progress, time remaining, cancel, plain-language errors,
    Wake Lock and `freeze`/`resume` handling. (§4.8, §7.1)
11. **Output.** Single download, ZIP built in a worker, `navigator.share` on
    mobile. (§6.4)
12. **Baseline tests.** First-load budget, offline with `crossOriginIsolated`
    still true, responsiveness harness. (§11)

*Done when* the deployed site is cross-origin isolated, works offline, and a
dropped file of any type shows a card with its detected type.

### Phase 2 — Image conversion

13. **Engine loader.** Lazy loading with size and progress shown,
    `compileStreaming` with fallback, compiled-module caching. (§4.6, §9.2)
14. **wasm-vips worker.** Decode and encode the common formats, ICC/CICP
    carried through, 16-bit kept. (§5.1)
15. **magick-wasm worker.** Long-tail formats, camera RAW, HEIC; Safari's
    native HEIC first. (§5.1)
16. **Pixel correctness.** Orientation normalised once per decoder;
    premultiplied resampling; flattening onto a background colour; GIF alpha
    threshold. (§5.1, §5.6)
17. **Router, images.** Engine choice for image jobs, unit-tested. (§4.2)
18. **Output picker.** Suggestions per input, grouped searchable list, presets
    data file. (§5.7, §6.1)
19. **Options and Advanced.** Disclosure levels, reset controls, collapsed
    summaries. (§6.2)
20. **Size, images.** Exact estimates, target size by quality search then
    downscale. (§7.7)
21. **Metadata reading.** ExifReader, the "Location data found" line, the full
    details panel. (§7.6)
22. **Metadata stripping, images.** JPEG, PNG, WebP, TIFF, HEIC/AVIF:
    thumbnails, MakerNotes, XMP, C2PA, trailing bytes. (§7.6)
23. **HDR.** Gain-map detection, "Keep HDR" for JPEG → JPEG. (§5.1)
24. **Icons.** ICO, CUR and ICNS readers and writers; favicon pack, app icons,
    cursor tool. (§5.4)
25. **Animated images.** GIF, APNG and animated WebP converted between each
    other, to frames, and from a set of images. (§5.5)
26. **Fixtures and image tests.** Corpus generator; image conversion matrix,
    colour, alpha and metadata tests. (§11)

*Done when* every advertised image input converts to every advertised image
output in Chromium and Firefox, with colour, alpha and metadata tests green.

### Phase 3 — Audio and video conversion

27. **Spike.** Custom ffmpeg.wasm core vs libav.js, on the same test files;
    choose one and record why in the README.
28. **Core build.** Build scripts in `wasm/` (current FFmpeg, dav1d, SVT-AV1,
    libspeex, pool size, memory cap), built in CI. (§4.2)
29. **Probe.** One `ProbeResult` from Mediabunny or FFmpeg. (§4.2)
30. **Capabilities.** Per-browser capability tables, quality denylist, router
    for audio and video. (§4.2)
31. **Native engine.** Mediabunny + WebCodecs transcode with bounded stages and
    frame hygiene; Mediabunny codec extensions. (§4.2, §4.6)
32. **Remux.** Container changes and keyframe trims by packet copy. (§4.2)
33. **FFmpeg engine.** Pool worker, fresh instance per job, `WORKERFS` input,
    `-threads` from the slot budget, metadata flags. (§4.2, §7.6)
34. **Audio outputs.** Every output in §5.2, including M4R and M4B with
    chapters. (§5.2)
35. **Alpha video.** Native via Mediabunny, FFmpeg otherwise; alpha-preserving
    decode. (§5.6)
36. **Cross-type conversions.** Video → GIF (palette, dithering), APNG,
    animated WebP, frames, contact sheet, audio; images → slideshow; audio +
    image → video; Motion and Live Photo extraction. (§5.5)
37. **gifski.** WASM build as the "best quality" GIF encoder; FFmpeg palettes
    stay the fast default. (§5.5)
38. **Size, audio and video.** Sample-encode estimates, target size with
    two-pass or aim-low-and-retry, levers, quality indicator. (§7.7)
39. **Limits.** Per-platform warnings, memory-failure catch and re-queue. (§4.3)
40. **Metadata stripping, audio and video.** MP4 atoms, data tracks, ID3 and
    Vorbis comments. (§7.6)
41. **Conversion matrix.** Full matrix on Chromium and Firefox; WebKit run
    reported, not blocking. (§11)

*Done when* the full conversion matrix is green on Chromium and Firefox and no
job in it can end without a result or an error.

### Phase 4 — Image editor

42. **Edit model and undo.** Non-destructive operation stack on the project
    schema, command-based undo/redo shared by every later editor. (§8)
43. **Editor shell.** Proxy preview with tiles, checkerboard, before/after,
    live updates. (§7.2)
44. **Geometry.** Crop, rotate, free rotate with auto-crop, flip, resize, pad.
    (§7.2)
45. **Adjustments.** Brightness, contrast, saturation, exposure, white
    balance. (§7.2)
46. **Redact and Obscure.** Solid fill; cosmetic blur and pixelate; thumbnails
    dropped, layers flattened. (§7.2)
47. **Batch apply.** One edit stack across many images. (§7.2)

*Done when* an edited image exports identically to its preview and redaction
leaves nothing recoverable in the file.

### Phase 5 — Audio editor

48. **Audio engine.** Block decode, DSP (gain, fades, mix, crossfade, channels,
    resampling), streaming encode, all in a worker. (§7.3)
49. **Waveforms and playback.** Peak tables, timeline canvas in a worker,
    `AudioWorklet` playback from a shared ring buffer. (§4.7, §7.3)
50. **Editing.** Trim, cut, split, delete, insert silence, join, multi-track
    with offsets. (§7.3)
51. **Loudness.** libebur128 measurement, normalise, silence trimming. (§7.3)
52. **Time-stretch.** Speed change with pitch kept. (§7.3)
53. **Export.** Export dialog with size estimate and target size. (§7.7)

*Done when* an hour-long multi-track edit exports within the desktop memory
budget.

### Phase 6 — Video editor

54. **Timeline.** Media bin, tracks and clips on the project schema. (§7.4, §8)
55. **Preview compositor.** WebGL2 in a worker, frame-accurate seeking, A/V
    sync. (§7.4)
56. **Proxies.** Background proxy generation for FFmpeg-only clips. (§7.4)
57. **Editing.** Trim, split, reorder, join with normalisation, transforms,
    aspect presets. (§7.4)
58. **Audio in video.** Per-clip volume, detach and replace audio, music bed
    with ducking. (§7.4)
59. **Transitions and speed.** Fades, crossfade, speed change. (§7.4)
60. **Redact and Obscure over time.** (§7.4)
61. **Export.** Native render and FFmpeg filtergraph compiled from the same
    edit list. (§7.4)
62. **Smart rendering.** Re-encode only the GOPs around cuts. (§7.4)

*Done when* preview and export match frame for frame on both export paths.

### Phase 7 — Text and captions

63. **Text rendering.** 2D text drawn in the compositor worker; bundled fonts
    and user `FontFace` loading. (§7.5)
64. **Text clips.** Overlay-track clips with style, position presets and
    fades; FFmpeg path overlays our rendered frames. (§7.5)
65. **Caption track.** SRT, WebVTT and ASS import; cue list editor. (§7.5)
66. **Burn-in.** Captions rendered through the text path. (§7.5)
67. **Soft subtitles.** Mux as a track per container; extract and add
    subtitles in the converter. (§7.5)

*Done when* burned-in text matches the preview on both export paths, and a
subtitle file round-trips through MP4, WebM and MKV.

### Phase 8 — Projects and polish

68. **Projects.** Save and load JSON, re-link files by hash, project bundles
    including user fonts. (§8)
69. **Keyboard shortcuts** across the converter and all editors.
70. **Accessibility pass.** Keyboard, focus, screen-reader labels, contrast in
    both themes. (§6.3)
71. **Chromium extras.** "Open with" via File Handling, Android Share Target.
    (§6.4)
72. **Documentation.** Self-hosting guide, patent note, complete
    `THIRD_PARTY_NOTICES` with source for every WASM binary. (§13)

*Done when* a saved project reopens on another machine from its bundle.

## 13. Licensing

A permissive licence is not possible with the dependencies we need: FFmpeg
built with x264/x265 is GPL-2.0-or-later. Every other dependency is compatible
with GPL-3.0-or-later or AGPL-3.0-or-later: magick-wasm and jSquash (Apache-2.0),
Mediabunny and ExifReader (MPL-2.0), libheif and LAME (LGPL), wasm-vips (MIT),
mozjpeg, libavif and libjxl (BSD-style).

The project is **AGPL-3.0-or-later**. Anyone who hosts a modified copy — one
that adds tracking, say — must publish their source, which backs "the code is
the evidence" for every public instance, not just ours. It also permits gifski
for better GIFs.

Ship a `THIRD_PARTY_NOTICES` file, and make the corresponding
source available for every WASM binary we distribute (build scripts in
`wasm/`, pinned upstream versions).

**Patents.** H.264, HEVC and AAC are patent-encumbered, and this applies to
WASM *decoders* (FFmpeg's H.264/HEVC decoders, libde265 for HEIC) as well as
encoders. AV1 has had patent claims asserted too. Enforcement has targeted
device and platform makers, not open-source converters, and MP3's patents have
expired. Policy: prefer the browser's own codecs (WebCodecs, Safari's native
HEIC) wherever available, fall back to WASM only when needed, and note this in
the README.
