# Shelf Scanner

TCSS 490 Artifact 2 ("Something You Will Use"). A PWA that scans a barcode with
a phone camera, looks up the item, and files it into a personal collection
(video games, action figures, comics, movies, manga), synced between phone and
laptop.

## Stack

- Plain HTML/CSS/JS, no build step, deployed as a static site to GitHub Pages.
- Installable as a PWA (manifest + service worker) for full-screen/camera use
  on a phone home screen.
- Barcode scanning: takes a single photo via the native camera
  (`<input type="file" capture="environment">`) and decodes it client-side
  with `@zxing/library`. Not a live video decode loop — html5-qrcode's live
  loop hit an unresolved WebKit bug on iOS Safari (camera preview renders,
  decode callback never fires).
- Lookup: UPCitemdb trial endpoint (keyless) for games/figures/movies.
  Comics/manga fall back to manual title entry (barcode lookup for these is
  unreliable) — a ComicVine-backed search is a planned upgrade, not yet wired
  up.
- Sync: planned via Firebase Firestore (not yet wired up). Until then, data is
  local only (`localStorage`).

## Layering plan

Layer 1 (this week, in progress): scan or type → confirm match → save →
show in a plain grid grouped by category. Must work end to end, even if
rough-looking.

Layer 2 (later): the visual bookshelf (books/movies), the comic-box
open/float-out interaction, polish on figures display.

## Working with Adrian

- Adrian reviews and decides; I write the code. Explain changes in plain
  language rather than expecting him to read every line.
- Never ghost-write his course reflections, plans/changes log entries, or
  "where the AI misread me" notes — those are his words. I can help with
  wording he's stuck on.
- Batch changes rather than many tiny round trips.
- Keep a running log of what was asked, what changed, and what was abandoned
  in `LOG.md` as we go (course requirement for every artifact).
- No paid services. Account creation for any third-party service (Firebase,
  ComicVine, etc.) is Adrian's own action, not something I do for him.
