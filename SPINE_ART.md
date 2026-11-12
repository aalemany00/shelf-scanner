# Real spine art, and the cover crop tool

By default, a game/movie/book spine on the shelf is generated — a colored
bar with the title in vertical text (deterministic per item, not real box
art). This is an optional way to replace that with a real spine, cropped
out of a scanned full-wrap cover. There's a second, separate crop tool for
the plain cover image field — see "Cropping the cover image" near the
bottom; it exists because pasting a whole full-wrap scan into "Cover image
URL" center-crops down to a narrow sliver that mostly shows the spine/back
cover, not the front cover.

## Where to find full-wrap scans

Sites like [thecoverproject.net](https://www.thecoverproject.net) publish
scanned covers in "full-wrap" layout: back cover, spine, and front cover as
one single image, left to right. That site sits behind a Cloudflare bot
challenge, so it can't be fetched automatically (no Worker/API integration
is possible) — browse it yourself in a real browser, use its own Download
button to save the image, then either:
- **Upload it in-app** (see below) — goes through the Worker to imgbb, free,
  no account of your own needed beyond the one-time API key setup; or
- Host it somewhere else you control (commit it into this repo, your own
  Firebase project, etc.) and paste that URL instead.

Don't paste a direct thecoverproject.net URL into the app — it likely won't
load reliably for anyone without their own solved challenge cookie.

## How the crop tool works

In the add/edit form, "+ Add real spine art":
1. Paste the full-wrap scan's URL, or use "Upload a file" to send it straight
   to imgbb through the Worker (`POST /upload` in `worker/src/index.js`) and
   auto-fill the URL.
2. Two sliders plus number inputs ("Spine starts at" / "Spine ends at", in
   **exact source pixels of the image**, not a percentage) mark where the
   spine strip sits. A live preview shows the crop both as a highlight over
   the full image and as the actual shelf-spine result. Type the exact pixel
   number for single-pixel precision — a spine is often only ~5% of the
   image's total width, so whole-percent steps were too coarse to land on
   the real seam (this is why it's pixels, not percent, as of 2026-11-12).
3. Saved as three fields on the item: `spineImage`, `spineCropStart`,
   `spineCropEnd` (pixel offsets into `spineImage`'s natural width). The
   existing `image` field (front cover, shown when you click the spine) is
   untouched — these are additive, optional fields, not a replacement for it.

The crop itself (`applyImageCrop` in `app.js`) is pure CSS positioning math
based on the image's natural width/height once it loads — it crops only
horizontally (full height preserved, no vertical distortion), matching how
a spine actually sits within a full-wrap scan. No server-side image
processing, no stored cropped copy — just the one full image plus two pixel
offsets, recropped live wherever it's shown.

If a `spineImage` URL ever breaks (404, deleted, etc.), the shelf falls
back to the generated colored-bar spine automatically rather than showing
a blank sliver.

## Why imgbb, not Firebase Storage or catbox.moe

- **Firebase Storage** would need the project's Blaze (pay-as-you-go) plan
  even for free-tier usage — this project avoids anything needing billing.
- **catbox.moe** (tried first, no account needed at all) started rejecting
  anonymous API uploads ("Invalid uploader") and its FAQ has odd language
  specifically about AI agents and a per-file removal fee — switched off it
  rather than dig further into either issue.
- **imgbb** is free, needs a one-time account + API key (same pattern as
  the OMDb/RAWG/ComicVine keys already stored as Worker secrets via
  `wrangler secret put IMGBB_API_KEY`), and actually works.

## Cropping the cover image

"+ Upload & crop a cover image" (under the plain "Cover image URL" field)
is a second, separate crop tool for the regular cover — not the spine.
It works differently from the spine tool on purpose:

1. **Upload only, no pasted URL.** You pick a local file; it's never
   fetched from a remote URL for this one. That's deliberate — cropping
   happens via `<canvas>`, and drawing a cross-origin image onto a canvas
   without the right CORS headers "taints" it and blocks reading the
   result back out. A file you just picked has no such restriction.
2. **Crops once, uploads only the result.** Unlike the spine tool (which
   keeps the full source image and crops it live, every time, via CSS),
   this crops the exact pixel range client-side into a new image, uploads
   *that*, and sets the plain `image` field to the resulting URL — nothing
   else about how `image` is used anywhere else in the app changes.
3. Same horizontal-slice crop shape as the spine tool (full height, pick a
   pixel range) — on a full-wrap scan, skip past the back cover and spine
   so the range only covers the front cover. Defaults to the whole image
   (no crop) for the common case of uploading an already-front-cover-only
   picture.

## A note on legacy data

Spine crop values were percentages (0-100) before 2026-11-12, then switched
to exact pixels for precision. `migrateLegacyPercentSpineCrop` in `app.js`
converts any item still holding old percent-style values the first time its
spine renders (detected by both values being ≤100 — no real cover scan is
ever that narrow), then saves the converted pixel values so it only needs to
happen once per item.
