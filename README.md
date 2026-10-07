# Media Editor

Convert and edit images, audio and video entirely in your browser. Files are
processed on your device with WebCodecs and WebAssembly and are never uploaded.

The design and implementation plan are in [SPEC.md](SPEC.md).

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
without one those tests are skipped.

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
| Best-quality GIF                   | gifski                                    |

**FFmpeg core (SPEC step 27).** The stock single-threaded `@ffmpeg/core` is
used for now. The multithreaded core fixes its heap at 1 GB and starts 32
threads per instance, which the shared renderer process can't afford with a
fresh instance per job. Its VP9 encoder crashes ("memory access out of
bounds"), so WebM output that has to go through FFmpeg uses VP8; WebM through
WebCodecs uses VP9. A custom core (current FFmpeg, dav1d, SVT-AV1) is SPEC
step 28 and not yet built.

## Hosting

The build in `dist/` is a static site. It needs no server-side code and no
response headers: the service worker adds the cross-origin isolation and
Content-Security-Policy headers itself, so it works on GitHub Pages. Set
`BASE_PATH` when building for a sub-path, e.g. `BASE_PATH=/media-editor/`.

## Licence

[AGPL-3.0-or-later](LICENSE). Third-party components and their licences are
listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
