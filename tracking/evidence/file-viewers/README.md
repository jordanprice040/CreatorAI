# File viewers walk (ADR-0106)

`make-samples.py` writes the samples (Word, Excel, PowerPoint, two PDFs, ZIP, Python, HTML,
SVG, UTF-16 text, invalid JSON). Some carry content a viewer must not run or fetch: a PDF
OpenAction script, a Word hyperlink and linked picture pointing outside, HTML and SVG with
scripts, event handlers and outside images. Outside addresses are `127.0.0.1:9` (nothing
listens there).

`walk.mjs` starts a throwaway studio (its own database, ports 5183/4330/4340), uploads the
samples through Sources › Files › Add files, opens each one and records what it shows in
`walk.json`, with screenshots in `screens/`. It fails if the page makes any request outside
the studio or opens a dialog.

```
pnpm build
python3 tracking/evidence/file-viewers/make-samples.py /tmp/fv-samples
CREATOR_TEST_DATABASE_URL=postgres://... node tracking/evidence/file-viewers/walk.mjs /tmp/fv-samples
```

The walk runs the production build, where React does not log duplicate-key warnings, so the
live check's follow-up 5 is fixed from its cause (two identical "Invalid UUID" lines in the
autopilot and automation panels of a workspace with no model or budget), not shown by this walk.
