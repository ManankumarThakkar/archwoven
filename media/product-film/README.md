# Product film source

Original SVG motion composition for the 32-second landing film. Models in
`recordings.json` are saved provider outputs from the checked-in evaluation
runs named in its `recordings` field. Rendering never requests inference.
Colours are read from `apps/web/app/globals.css`.

The site ships only the H.264 video and JPEG poster in `apps/web/public/media`.
These authoring tools are not imported by the application.
Generated frames, encoders and review captures stay outside the repository.

To regenerate on macOS, supply a directory containing `playwright-core` with a
Chromium installation. From the repository root, start the loopback authoring
server in one terminal:

```sh
node media/product-film/serve.mjs
```

In another terminal:

```sh
node media/product-film/render.mjs /path/to/browser-tools
swiftc media/product-film/encode.swift -o /tmp/archwoven-film-encoder
/tmp/archwoven-film-encoder /private/tmp/archwoven-landing-film-output 960
node media/product-film/check-preview.mjs /path/to/browser-tools
```

Review the result before replacing public assets, and bump their version in
`ProductFilm.tsx` and `next.config.ts` when changing the film or poster. This
avoids stale copies with the year-long immutable cache policy. Production
playback, fallbacks and accessibility are checked by `apps/web/e2e/landing.mjs`
against a production Next.js server.
