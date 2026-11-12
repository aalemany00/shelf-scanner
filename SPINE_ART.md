# Real spine art

By default, a game/movie/book spine on the shelf is generated — a colored
bar with the title in vertical text (deterministic per item, not real box
art). This is an optional way to replace that with a real spine, cropped
out of a scanned full-wrap cover.

## Where to find full-wrap scans

Sites like [thecoverproject.net](https://www.thecoverproject.net) publish
scanned covers in "full-wrap" layout: back cover, spine, and front cover as
one single image, left to right. That site sits behind a Cloudflare bot
challenge, so it can't be fetched automatically (no Worker/API integration
is possible) — browse it yourself in a real browser, use its own Download
button to save the image, then host that file somewhere you control (e.g.
commit it into this repo, or your own Firebase project) and use that URL.
Don't paste a direct thecoverproject.net URL into the app — it likely won't
load reliably for anyone without their own solved challenge cookie.

## How the crop tool works

In the add/edit form, "+ Add real spine art":
1. Paste the full-wrap scan's URL.
2. Two sliders ("Spine starts at" / "Spine ends at", in % of the image's
   width) mark where the spine strip sits. A live preview shows the crop
   both as a highlight over the full image and as the actual shelf-spine
   result.
3. Saved as three fields on the item: `spineImage`, `spineCropStart`,
   `spineCropEnd` (percentages). The existing `image` field (front cover,
   shown when you click the spine) is untouched — these are additive,
   optional fields, not a replacement for it.

The crop itself (`applyImageCrop` in `app.js`) is pure CSS positioning math
based on the image's natural width/height once it loads — it crops only
horizontally (full height preserved, no vertical distortion), matching how
a spine actually sits within a full-wrap scan. No server-side image
processing, no stored cropped copy — just the one full image plus two
percentages, recropped live wherever it's shown.

If a `spineImage` URL ever breaks (404, deleted, etc.), the shelf falls
back to the generated colored-bar spine automatically rather than showing
a blank sliver.
