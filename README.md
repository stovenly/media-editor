# Media Editor

Convert and edit images, audio and video entirely in your browser. Files are
processed on your device with WebCodecs and WebAssembly and are never uploaded.

- **Converter.** Drop in any mix of images, audio, video and subtitle files and
  pick an output for each kind. Size estimates appear before you convert, and a
  target size ("fit to 2 MB") can be set. Transparency is kept where the output
  supports it.
- **Image editor.** Crop, rotate, straighten, flip, adjust, resize, pad and
  redact.
- **Audio editor.** Multitrack cutting, joining, fades, crossfades, speed,
  loudness normalisation and ducking.
- **Video editor.** Join, trim, split, reorder, overlays, music, text, captions,
  speed, fades, crossfades and redaction.
- **Captions.** Import SRT, WebVTT and ASS, edit the cues, burn them into the
  picture or add them as a subtitle track. The converter also extracts subtitle
  tracks and adds subtitle files to videos without re-encoding.
- **Projects.** Save a project file, which finds your files again by their
  contents even if they've been renamed, or a ZIP bundle with the media and
  fonts for another computer.

Press <kbd>?</kbd> on any screen for its keyboard shortcuts. The design and
implementation plan are in [SPEC.md](SPEC.md).

## Development

```sh
npm install
npm run dev        # dev server with cross-origin isolation headers
npm run check      # type-check
npm run lint
npm test           # generate fixtures, then unit tests
npm run test:e2e   # build, then end-to-end tests in Chromium, Firefox and WebKit
```

The first `test:e2e` run needs the browsers: `npx playwright install`. The
audio and video fixtures are generated with a native `ffmpeg` on the `PATH`;
without one those tests are skipped. Test browsers are muted.

`npm run dev` and `npm run build` first copy the WebAssembly engines from
`node_modules` into `public/wasm/` (`npm run vendor`).

## Engines

| Job                                | Engine                                    |
| ---------------------------------- | ----------------------------------------- |
| Common images                      | wasm-vips                                 |
| Long-tail images, camera RAW, HEIC | magick-wasm                               |
| ICO, CUR, ICNS, APNG               | our own code                              |
| Audio and video, fast path         | Mediabunny + WebCodecs                    |
| Audio and video, everything else   | FFmpeg (ffmpeg.wasm single-threaded core) |
| Subtitle tracks                    | our own code, FFmpeg for muxing           |
| Best-quality GIF                   | gifski                                    |
| Video editor preview and export    | our 2D compositor + WebCodecs             |

**FFmpeg core.** The stock single-threaded `@ffmpeg/core` is used. The
multithreaded core fixes its heap at 1 GB and starts 32 threads per instance,
which the shared renderer process can't afford with a fresh instance per job.
Its VP9 encoder crashes ("memory access out of bounds"), so WebM output that
has to go through FFmpeg uses VP8; WebM through WebCodecs uses VP9. A custom
core (current FFmpeg, dav1d, SVT-AV1) is SPEC step 28 and not yet built.

## Codecs and patents

Some formats this app writes are covered by patents in some countries:
H.264, HEVC and AAC most notably. When the browser can encode a format itself
(WebCodecs), the app uses the browser's encoder, which the browser vendor has
licensed or chosen to ship. Formats the browser can't encode go through FFmpeg,
which is compiled into the app and includes x264, x265 and other encoders.
Distributing or using those encoders may need a patent licence where such
patents are enforced. If you host a copy of this app, that question is yours to
answer for your jurisdiction; this is not legal advice.

VP8, VP9, AV1, Opus, Vorbis, FLAC and WebP are royalty-free, and the MP3
patents have expired.

## Hosting

The build in `dist/` is a static site that needs no server-side code and no
response headers: the service worker adds the cross-origin isolation and
Content-Security-Policy headers itself, so it works on GitHub Pages. See
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Licence

[AGPL-3.0-or-later](LICENSE). Third-party components, their licences and where
to get the source of every WebAssembly binary are listed in
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
