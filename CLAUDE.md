# Shelf Scanner

TCSS 490 Artifact 2 ("Something You Will Use"), **shipped and live** at
https://aalemany00.github.io/shelf-scanner/. A PWA that scans a barcode (or
searches by title) to catalog a personal collection across 5 categories
(Games, Figures, Comics, Books & Manga, Movies), synced between phone and
laptop via Firebase.

**Current focus: a visual redesign**, not new functionality — see
"Redesign in progress" below. Read `ASSET_LIST.md` before working on it.

## Stack

- Plain HTML/CSS/JS, no build step, deployed as a static site to GitHub Pages.
- Installable as a PWA (manifest + service worker) for full-screen/camera use
  on a phone home screen.
- **Barcode scanning**: a single photo via the native camera
  (`<input type="file" capture="environment">`), decoded client-side with
  `@zxing/library`. Not a live video decode loop — html5-qrcode's live loop
  hit an unresolved WebKit bug on iOS Safari (preview renders, decode
  callback never fires).
- **Lookup/search**, proxied through a Cloudflare Worker (`worker/`, deployed
  separately from the static site — see `worker/wrangler.toml`) so API keys
  never reach the browser or the repo:
  - UPCitemdb trial endpoint (keyless, best-effort first try on any barcode).
  - Title search: OMDb (movies), RAWG (games), ComicVine (western comics —
    handles the "series name + issue number" case specially, since ComicVine's
    own text search doesn't match on issue number).
  - ISBN lookup: Open Library (books/manga — tags manga editions via a
    `form:manga` subject, used to default the Book/Manga toggle).
- **Sync**: Firebase Firestore, anonymous auth, one shared `items` collection
  (single-user app — Adrian only, across his own devices — so no per-user
  scoping; see `sync.js` and the security-rule note in `LOG.md`).
- **Categories** (`CATEGORIES` in `app.js`): game, figure, comic, book, movie.
  Comics and Books & Manga are "shelved" categories (`WITH_SHELVES`) with a
  Have/Want/Read status filter and manual drag-reorder plus
  alphabetical/date-added/author sort (view preference only, in
  `localStorage`, not synced). An item can be swapped between the comic/book
  shelves (`SHELF_SWAP`) if it was miscategorized. Items carry a condition
  grade (e.g. "A", "B+") and a dedupe check on category + barcode/ISBN or
  title.

## Redesign in progress — "Japanese retro collection room"

Adrian wants the whole UI reskinned into a Japanese retro-collector's-room
aesthetic (wood shelves, a comic long-box you browse by hovering, a lit
figures cabinet, a cat mascot) instead of the old plain grid.

- **Branch:** `feature/retro-collection-room` — don't touch `main` for this.
- **Pure CSS + inline SVG, no AI-generated art.** An earlier pass tried
  AI-generated PNG assets for the shelf/chrome art (see `ASSET_LIST.md`,
  now historical) — Adrian said it didn't look right, and a second,
  independent CSS-only prototype he had made looked closer despite not
  being asset-based at all. Root cause, documented in `LOG.md`'s
  2026-11-12 pivot entry: generated PNGs were inconsistent to art-direct
  (decode failures, huge invisible padding, baked-in content that can't
  hold a variable-size collection) in a way pure CSS/SVG just doesn't have.
  The old generated PNGs still sit in `assets/` but nothing references them.
- **Everything that's real data stays real DOM**: item covers, titles,
  counts, search, sort — never baked into an image or fixed markup.
- Comics (the long-box, `renderComicBox` in `app.js`) and Figures (the glass
  case, `renderFiguresCase`) both use real data now — no longer blocked.
- Must not break: scanning, manual entry, existing Firestore data, search,
  category switching, edit/delete, the Worker-backed lookups.

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
