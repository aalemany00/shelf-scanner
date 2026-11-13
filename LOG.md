# Plans and Changes Log

## 2026-10-16

**Planned:** Artifact 2, "Shelf Scanner" — scan a barcode on a phone, look up
the item automatically, and file it into a category (games, figures, comics,
movies, manga) on a personal collection site, synced between phone and
laptop.

**Decided:**
- Own standalone repo/GitHub Pages site (not inside the portfolio repo),
  linked from the portfolio's Artifact 2 card once shipped.
- Build in layers: Layer 1 this week is a working scan → lookup → confirm →
  save → grid view loop for all 5 categories, synced across devices. The
  visual bookshelf / comic-box interaction is Layer 2, after the core loop
  works.
- PWA (installable web app) over a native app, so one codebase covers phone
  and laptop.
- `html5-qrcode` for camera barcode scanning; UPCitemdb's keyless trial
  endpoint for games/figures/movies lookups.
- Comics/manga barcodes don't reliably resolve in general UPC databases, so
  those categories fall back to typing the title and picking the right match
  (ComicVine lookup planned, not yet wired up).
- Sync will use Firebase (Firestore + anonymous auth) once set up — free
  tier, no server to run.

**Open / not yet built:** Firebase sync, ComicVine/Jikan lookup for
comics/manga, PWA install/offline behavior, the visual shelf and comic-box UI
(Layer 2).

## 2026-10-17

**Built:** repo scaffold (PWA shell, manifest, service worker), the scan →
confirm → save → grid loop, manual entry, and a Cloudflare Worker
(`worker/`) that proxies the UPC lookup.

**Where the plan broke:** UPCitemdb's keyless "trial" endpoint blocks
browser-side requests via CORS, and — found only after building the Worker
proxy around it — it's a single quota shared by everyone on the internet
using it without an account, not per-user. It's explicitly documented as an
evaluation-only tier; a real account needs a $99/month plan, which the
course rules out. Confirmed by checking UPCitemdb's own pricing page and by
testing the deployed Worker, which hit "rate limit exceeded" immediately.

**Decided:** keep the UPC trial call as a best-effort first try (it does
sometimes work, costs nothing extra), but make the reliable path a
per-category title search instead of a barcode-to-item database: OMDb for
movies, RAWG for games, run server-side through the same Worker so API keys
never reach the browser or the repo. Figures have no good free database and
stay manual-entry only. Comics/manga still need ComicVine/Jikan, not yet
wired up.

**Open:** ComicVine/Jikan for comics/manga; deploy to GitHub Pages; Layer 2
visual polish.

## 2026-10-17 (scanner rework)

**Where the plan broke:** deployed to GitHub Pages and tested on Adrian's
actual iPhone — the camera opened and showed a live preview, but it never
detected any barcode held up to it. Turned out to be an unresolved,
long-standing WebKit bug in html5-qrcode's live-video decode loop on iOS
Safari (multiple open GitHub issues on the library going back to 2022,
still unresolved as of 2026). Config tuning (format list, scan box size)
made no difference, as expected for a bug at that level.

**Decided:** replace live in-page video scanning with "take a photo, then
decode the photo" — `<input type="file" capture="environment">` opens the
phone's native camera for a single still shot, decoded client-side with
`@zxing/library`. This sidesteps the WebKit live-decode bug entirely since
it's a one-shot image decode, not a running video pipeline. Verified the
decode path itself works (generated a barcode locally and decoded it
through the same code path the app uses) without a real camera available
to the agent; real-world camera-photo quality (focus, lighting, angle) is
Adrian's to verify on his phone.

**Resolved:** real iPhone testing showed the photo-decode failing even
with good lighting/focus/distance, until Adrian zoomed the camera in all
the way — then it worked. The barcode needs to fill most of the frame so
the bar widths are large enough to resolve; "pointed at it from a normal
distance" wasn't enough. Added a visible hint under the scan button and
updated the failure message to say so, instead of leaving this as
tribal knowledge.

## 2026-10-17 (later)

**Built:** got OMDb and RAWG keys, set as Worker secrets — movie/game title
search is fully live. Set up Firebase (Firestore + Anonymous auth) for
phone-laptop sync, with a `sync.js` module that mirrors `state.items`
to/from a shared `items` collection. Verified real cross-device sync by
adding an item in one browser session and watching it appear in a second,
independent one without a page reload.

**Decided:** one shared Firestore collection, not scoped per Firebase Auth
user ID. This is deliberately not multi-tenant-secure — anonymous auth here
just proves "a client of this app," not "a specific person," and two
devices signed in anonymously get two different auth UIDs anyway, which
would break sync if the data were scoped per-UID. For a single-user hobby
project this is an acceptable tradeoff, written down here so it's a chosen
boundary, not an accident. Firestore rules (deployed via `firebase deploy
--only firestore:rules`, see `firestore.rules`) require sign-in and a sane
document shape, replacing the default wide-open 30-day test mode.

## 2026-10-17 (comic/manga lookup)

**Built:** ComicVine title search for comics, Jikan (MyAnimeList) title
search for manga, both proxied through the Worker (neither sends CORS
headers, so a direct browser call would've failed the same way UPCitemdb
did). ComicVine needs its own free API key (account required, non-commercial
use only); Jikan needs none.

**Where the plan broke:** Jikan hit a sustained outage while testing (every
request timed out, both from my sandbox and from the Worker itself — a
genuine problem on their end, not something fixable here). It was also
surfacing as a raw, CORS-less Cloudflare error page in the app instead of a
usable message.

**Decided:** wrapped every upstream API call (UPC, OMDb, RAWG, ComicVine,
Jikan) in a shared timeout + try/catch in the Worker, so any future outage
on any of these free services degrades to a clean "unreachable, try later or
enter manually" message instead of an opaque error with broken CORS. Manga
lookup itself is unverified live (Jikan was down for the whole session) —
retest once their service is back up.

**Where the plan broke (again):** Adrian tested comic search for "The
Amazing Spider-Man #363" and got ~10 unrelated Spider-Man issues, none
actually #363. ComicVine's plain-text issue search matches words in issue
titles/blurbs, not the issue_number field — searching "363" as text doesn't
mean "find issue 363."

**Decided:** when the typed title ends in a number, search for the series
(volume) by name first, then query that volume's issues filtered by the
exact issue_number — confirmed this returns the precise issue (tested
"Amazing Spider-Man 363" → the real 1992 issue, cover and all). Multiple
volumes often share a series name across reboots; picks the volume with the
most issues as the likely "main" series, checking the top 3 in case the
single exact issue isn't in the biggest one. This is a heuristic, not a
guarantee — an obscure reboot's issue 363 could still be missed. Falls back
to the old plain-text search if no number is found or no exact match comes
back.

## 2026-10-17 (comic browsing + dead-end fix)

**Where the plan broke:** two reports from real use. (1) Searching a bare
series name like "Green Lantern" or "Batman" returned ~10 near-duplicate
issues, almost all from whichever single volume happens to dominate
ComicVine's issue search — not useful for seeing what eras/runs exist. (2)
When Jikan was down, the manga search showed "...or enter manually," but
there was no actual way to reach plain manual entry from there — comics and
manga route "Enter Manually" to the search form now, so a failed/empty
search was a dead end.

**Decided:**
- A bare series search (no trailing issue number) now searches ComicVine
  volumes instead of issues, returning distinct series/eras to pick from
  (e.g. "Green Lantern (1960)," "(1990)," "(2005)," "(2011)"...). Picking
  one drills into that specific series' issue list (`kind=comic-issues`) to
  pick the actual issue — a three-step flow (series → issues → confirm)
  instead of one flat dump.
- Added a persistent "Can't find it? Enter it manually instead" link on the
  search form itself, so a bad/failed/empty search always has an escape
  hatch to plain manual entry, pre-filled with whatever was typed.

## 2026-10-17 (Layer 2 pulled forward: League of Comic Geeks tour)

**Planned:** Adrian looked at League of Comic Geeks (an established comic
collection tracker) and asked to adopt several of its ideas before the
deadline: group the collection grid by series instead of a flat list of
issues, drop the separate Manga tab (a real comics site doesn't treat manga
as a different thing — it's just another series), and track Have/Want/Read
status instead of a single "added" state. Explicitly skipped: market
pricing, key-issue flags, star ratings, reviews — real scope creep for a
personal cataloging app.

**Decided (confirmed with Adrian before building, since redoing this later
would be expensive):**
- Manga merges into the Comics category entirely — one tab, one data model.
  `loadItems()` migrates any old `category: "manga"` test data to `"comic"`.
- Have/Want/Read status only applies to comics (figures/games/movies keep
  the simple "add it, you have it" model — "Read" doesn't mean anything for
  a game).
- The series-grouped grid (one tile per series, count badge, click to see
  owned issues) is comics-only too, not applied to the other categories.
- The Scan Barcode button and zoom hint are now hidden entirely for
  Comics (not just redirected to search) — a barcode was never going to
  resolve to a specific comic issue anyway.

**Built:**
- Worker: the unified `comic` search kind now runs ComicVine (series/issues)
  and Jikan (manga titles) together for a general/series-level search,
  returning both in one list. ComicVine already carries real coverage for
  well-known manga (e.g. "Naruto" returned 6 real volumes with covers
  directly from ComicVine), so this works even while Jikan remains down.
  `cvItem()` and the Jikan mapping now emit `seriesName` as its own field
  (not just baked into the display title), so the client can group by it.
- `app.js`: `status: {have, want, read}` on comic items, toggleable as chips
  in both the confirm panel (before adding) and the item overlay (after,
  e.g. marking something Read later). The comics grid groups by
  `seriesName` into one tile per series with a count badge and small
  have/want/read dots on individual issues; a new series drill-down overlay
  lists the owned issues in one series.

**Not done / explicitly out of scope:** market pricing, key-issue flags,
star ratings, reviews, variant-edition tracking — all real features on
League of Comic Geeks, left out as scope creep beyond a personal cataloging
tool.

**Verified (hadn't been tested specifically until asked):** movie barcode
scanning uses the same UPC lookup path as games, and a real Blu-ray UPC
(Source Code, 2011) correctly returned its title, cover art, and category
through the Worker.

## 2026-10-17 (visual theme)

**Planned:** Adrian wanted the dark/neon look replaced. Previewed several
directions as design-canvas mockups before touching real CSS (same
"preview before committing" habit as Project World): a comic-pop palette, an
indie-webcomic palette, a Y2K/scrapbook-sticker look, and a retro Japanese
arcade/Famicom-box-art look pulled from his own Pinterest references.

**Decided:** retro Japanese Famicom box-art theme — cream background,
Famicom-red header banner with a sunburst accent, "Dela Gothic One" (a real
Japanese-gothic display typeface) for headings, white cards with thick black
borders and offset "sticker" drop shadows, chunky 3D-bevel buttons, and
game-cartridge-style grid tiles (color block + black label strip).
Deliberately kept Japanese text out of the functional UI itself (the mockup
had a couple of decorative Japanese words) so the app stays plainly
readable English — the aesthetic comes from type/color/shape, not
untranslated flavor text.

**Built:** rewrote `style.css` token-by-token onto the new palette, updated
the manifest's theme colors and the favicon to match. Verified the real app
(header, tabs, buttons, search results, confirm panel with Have/Want/Read
chips, comic grid with cartridge tiles) end to end against the mockup.

## 2026-10-17 (convenience pass, 300+ comics)

**Planned:** with a 300+ comic collection, Adrian needs to quickly check
"do I already have this?" rather than scroll a wall of items. Also: the
category tabs sat flush-left instead of centered, and issues within a
picked era showed in a seemingly random order.

**Built:**
- Category tabs centered; "Comics" relabeled "Comics & Manga" (see above).
- Comics & Manga now has three shelves — Have It / Want It / Read It —
  instead of one mixed grid. An item can be on more than one shelf at once
  (e.g. Have + Read); these are "which shelf to look at," not mutually
  exclusive filters.
- Added a search box above every category's grid (not just comics) that
  filters the already-added collection by title, so a large list is
  actually navigable.
- Fixed two real ordering bugs in the Worker found while testing this:
  ComicVine sorts `issue_number` as text ("1, 10, 11, 12, 2..."), so a
  28-issue-and-up series was never in reading order — now sorted
  numerically ourselves. Separately, the issue list was silently
  truncated to the first 100 issues fetched (discovered testing a
  205-issue Green Lantern run); added pagination up to 500 issues per
  volume, fetched in parallel.

## 2026-10-18 (ISBN search for manga/comics)

**Planned:** Adrian noticed manga/graphic-novel volumes carry a real
ISBN-13 barcode on the back cover (separate from the UPC path comics
already skip) and asked for a way to search by that number directly.

**Built:** a "Search by ISBN" button next to "Enter Manually," shown only
in Comics & Manga. First tried Google Books (free, keyless) for the
ISBN-to-title lookup, but its anonymous API quota turned out to be
exhausted globally — not something fixable from our side, confirmed by
hitting the raw Google Books endpoint directly and getting a 429 with a
`quota_limit_value` of 0. Switched to Open Library's ISBN API instead,
which is also free and keyless and is built specifically for ISBN
lookups; its `covers.openlibrary.org` endpoint supplies the cover image
directly from the ISBN with no extra lookup step. Verified end to end in
the browser: searched a real ISBN (One Piece Vol. 1), got back the title,
cover art, and year, added it to the collection, and confirmed it showed
up correctly on the Have It shelf before removing the test entry.

## 2026-10-18 (split Books & Manga out of Comics)

**Planned:** Adrian realized he also has a plain book collection, and
asked to split manga out of Comics into a new Books section combined with
regular books — searchable by scan, manual entry, or ISBN.

**Built:**
- New "Books & Manga" category, alongside Comics rather than inside it.
  Comics goes back to being western comics only (ComicVine title search,
  no manga results mixed in); the old Jikan-based manga search is gone
  entirely since manga's new home is ISBN-driven, not title-search-driven.
- Books & Manga supports all three ways Adrian asked for: Scan Barcode
  (a book's barcode *is* its ISBN, so a scan goes straight through the
  same Open Library lookup as the typed ISBN search — UPCitemdb, a
  general retail database, resolves books poorly), Enter Manually, and
  Search by ISBN. Comics keeps ISBN search too, since trade paperbacks
  carry one.
- Both categories keep the Have/Want/Read shelves and series-grouped grid
  from the comics work — generalized that logic (previously hardcoded to
  "comic") to run off a small config list instead of adding a second copy.
- There's no stored field on an existing item distinguishing "this was
  manga" from "this was a western comic" (both went through the same code
  path before today), so existing comic entries couldn't be auto-migrated.
  Added a "Move to Books & Manga" / "Move to Comics" button in the item
  detail overlay instead, so Adrian can reassign the manga ones by hand.
- Found a pre-existing bug while testing, not caused by this change: an
  item added right before a Firestore sync snapshot arrives can get wiped
  by that snapshot if the write hasn't landed yet — reproduced by adding
  a test book and watching it disappear on reload. Confirmed via the real
  synced collection that nothing was actually left behind by testing.
  Flagged to Adrian; not fixed as part of this change since it's a
  separate, pre-existing issue across every category, not specific to
  Books & Manga.

## 2026-10-18 (fixed the add-item sync bug)

**Planned:** Adrian asked to fix the sync bug found above.

**Built:** two separate issues, not one — chasing the first exposed the
second.

- `app.js`'s sync listener replaced the entire local item list with
  whatever Firestore last sent, with no regard for a write still in
  flight from this same session — an add or delete that hadn't been
  confirmed yet could get silently wiped or resurrected by a snapshot
  that didn't reflect it. Added `pendingWrites`, a small in-memory map of
  ids with adds/deletes still in flight, and a `reconcileWithPending`
  step that merges each incoming snapshot against it: a pending add not
  yet in the snapshot is kept, a pending delete still in the snapshot is
  dropped. Clears once the write confirms either way, except a *failed*
  add stays protected (there's no server copy to fall back on) while a
  *failed* delete gets un-protected (the item still exists remotely).
- Testing that fix immediately surfaced the real reason items were
  disappearing: it wasn't actually a timing race at all. `firestore.rules`
  only allowed documents with `category` in `["game", "figure", "comic",
  "movie", "manga"]` — "book" wasn't on that list, so every write from
  the new category was being rejected outright by the security rules,
  every single time, not occasionally. Added "book" to the allowed list
  (and dropped "manga," which the client hasn't written as a literal
  category value since manga got folded into comics months ago) and
  redeployed with `firebase deploy --only firestore:rules`.
- Verified for real this time: added a book via ISBN search, confirmed
  the status message no longer said "sync failed," reloaded the page
  fully, and confirmed the item was still there — meaning it actually
  reached Firestore, not just local storage. Also exercised the "Move to
  Comics" button on it and then deleted it through the UI, reloading
  again afterward to confirm the delete reached Firestore too and the
  real collection was left clean.

## 2026-10-18 (duplicate warning + editing an existing item)

**Planned:** two convenience features, picked from a short list of
suggestions: a warning before adding something already in the
collection (relevant now that it's 300+ comics, easy to double-scan),
and a way to fix a title/cover/notes after an item is already saved —
previously the only options were Remove, Move, or toggling status.

**Built:**
- A shared duplicate check (same category, plus a matching barcode/ISBN
  when both have one, else a case-insensitive exact title match —
  checked against the full title, not the series name, so two different
  issues of the same series don't flag each other). Shows "You already
  have this in your collection" as a non-blocking warning: on the
  confirm panel for scan/search/ISBN results, and live as you type in
  the plain manual-entry form. Doesn't stop the add — sometimes a second
  copy is intentional — it's a heads-up, not a gate.
- An Edit button on every item's detail overlay, reusing the existing
  manual-entry form (title/cover/notes) instead of a new one. Updates
  the item in place rather than creating a duplicate; the duplicate
  check correctly excludes the item being edited from matching itself.
  The form's submit button relabels to "Save Changes" while editing so
  it's clear this isn't adding a new item.
- Verified both against the real synced collection: triggered the
  duplicate warning against a real figure already owned, edited that
  figure's notes and confirmed the change survived a full reload (really
  reached Firestore, not just local storage), then reverted the test
  edit; separately added a real-ISBN test book, confirmed the duplicate
  warning fired on a second ISBN search for it, and removed the test
  entry afterward.

## 2026-10-18 (visual bookshelf for Books & Manga)

**Planned:** the first real Layer 2 piece — moving Books & Manga off the
grid everything else uses and onto something that actually looks like a
shelf. Explored directions as Design-canvas mockups first (same process
as the Famicom restyle) rather than guessing in code: a classic wood
shelf with loosely leaning covers, a cartridge-rack take continuing the
Famicom theme, a tight "library ledge," and a hybrid. Adrian also pointed
me at Shelfy, a real book-tracking app, for reference — picked up its
tightly-packed, no-gap covers and wood-plank shelf rows, but skipped its
decorative mixed-in photos/props per Adrian's explicit "no random images"
note. Also asked for: reorganizing the shelf (drag and drop, not
simplified arrows — Adrian's call), and keeping books and manga visually
separate on the shelf rather than mixed in one row.

**Built:**
- Books & Manga now renders as a packed shelf instead of a grid: covers
  sit edge to edge on a wood-plank row (same cream/red/ink Famicom
  palette as the rest of the app), wrapping to a new row once one fills
  up. No decorative filler — every tile is a real owned item.
- Books and manga are split into their own "Books" and "Manga" sections
  on the shelf. Since there's nothing on a saved item recording which it
  is, added a Book/Manga toggle to the confirm panel and the manual
  entry/edit form, defaulting from a signal Open Library actually
  exposes — it tags manga editions with a "form:manga" subject, which the
  Worker now checks (`likelyManga`) — always changeable either way.
- Shelf order is a real drag-and-drop: press and hold a cover to pick it
  up, drag it over another cover in the same section, drop it there.
  Built by hand with Pointer Events rather than HTML5 drag-and-drop,
  which doesn't fire on touchscreens at all — this is a phone-first app,
  so that wasn't an option. A plain tap still opens the item as before;
  only a held drag is treated as a reorder.
- Comics keeps its existing series-grouped grid untouched — this shelf
  treatment is Books & Manga only, since comics' "many issues of the same
  series" shape doesn't fit a flat packed shelf the way a handful of
  book/manga copies does.
- Verified end to end against the real collection: searched a real manga
  ISBN and confirmed the Manga toggle defaulted correctly, added a real
  book and confirmed Book defaulted instead, added a second manual book,
  dragged it in front of the first and confirmed the new order survived a
  full reload (reached Firestore, not just local storage), then removed
  all three test entries and confirmed the real collection was left
  clean. Also re-checked Comics, Figures, and Games to confirm their
  grids were untouched by the change.

**Follow-up (same day):** Adrian had already started using the shelf for
real (Demon Slayer volumes, Wizard's First Rule) and said the covers read
too small. Scaled them up from 64x100px (14px plank) to 92x142px (18px
plank), same proportions, verified against his real shelf without
touching his real entries.

**Follow-up (same day):** a section wrapping to a second row put the next
row's covers flush against the previous row's plank — no breathing room.
Added a 14px gap above every row after the first in a section.

## 2026-10-19 (sort the Books & Manga shelf)

**Planned:** Adrian wanted multiple ways to order each shelf — alphabetical,
date added, by author — each flippable top-to-bottom or bottom-to-top, on
top of the drag-and-drop order already there.

**Built:**
- A sort control (a method dropdown + a direction toggle button) above the
  Books & Manga shelf: Custom order (the existing drag order), Alphabetical,
  Date added, or Author, each ascending or descending. Persisted per device
  in localStorage — it's a view preference, not collection data, so it
  doesn't sync or touch Firestore.
- Author didn't exist as a field before today. Added an Author input to the
  manual-entry/edit form (Books & Manga only), and the Worker now pulls it
  from Open Library's `authors` array on an ISBN lookup, shown in the
  confirm panel and item detail alongside the existing title/meta.
- Dragging a cover while sorted some other way (say, Alphabetical) adopts
  whatever order is currently on screen as the new baseline, applies the
  drag on top of it, and switches the control back to Custom — so the drop
  is exactly what you see next, rather than being a no-op or snapping back
  to a stale manual order.
- Verified against the real collection: alphabetical sort correctly put
  "It" before "Wizard's First Rule," descending reversed it, author sort
  grouped by the (currently mostly blank) author field correctly, date
  added matched real timestamps, and dragging while sorted by Date Added
  correctly re-baselined to Custom and persisted through a full reload.
  Removed the one test entry (with a test author) afterward and confirmed
  the real shelf was untouched.

## 2026-11-12 (retro collection-room redesign — Phase 1: layout/chrome)

**Planned:** Adrian wasn't happy with Shelf Scanner's plain-grid look and had
ChatGPT generate two mockups of an illustrated Japanese retro collector's-room
redesign (wood shelves, a comic long-box, a lit figures cabinet, a cat
mascot). Agreed on branch-and-phase discipline rather than one big rewrite.

**Decided:**
- New branch, `feature/retro-collection-room` — `main` stays untouched until
  this is actually ready.
- Decorative art (the illustrated textures/frames/mascot) has to come from an
  image AI Adrian runs himself — I can't generate illustration. Wrote
  `ASSET_LIST.md`: every decorative asset the mockups imply, broken into
  individual transparent-PNG requests with ready-to-paste prompts, so
  generating them doesn't turn into "screenshot the mockup and crop it."
- Build in the mockup's own suggested phases, verifying each before the next:
  Phase 1 (layout/chrome) first, real physical shelves/comic-box/cabinet
  interactions later.

**Built (Phase 1 — foundation, no real art assets yet):**
- Restructured the page into a `.room` shell: a decorative marquee banner, a
  header with a brand mark + mascot placeholder, a wood-textured sidebar
  (category nav + Scan/Manual/ISBN buttons + a signage placeholder), and a
  main content area with a yellow "ribbon" treatment on the collection title.
- Every decorative piece is a CSS placeholder (`data-asset="name"` divs with
  gradients/colors approximating the mockup's palette) — real PNGs from
  `ASSET_LIST.md` can drop in later as `background-image` without touching
  the HTML structure again.
- New design tokens in `style.css` (`--wood`, `--wood-dark`, `--navy`,
  `--cream-plate`) alongside the existing palette, plus a Noto Sans JP font
  import for the Japanese text labels.
- Deliberately did **not** move the scan/search/manual forms themselves —
  only the three trigger buttons moved into the sidebar; the forms, preview,
  and confirm panel stay in the main content area, since relocating them had
  more regression risk than it was worth for a layout-only pass.

**Verified:** confirmed every element app.js looks up is by `id`
(`document.getElementById`), not DOM position, before moving anything — so
reorganizing the containers couldn't break the JS. Ran it locally (desktop
and mobile-width screenshots): category switching, Firestore sync pill,
Have/Want/Read tabs, and the mobile nav reflow all still work; the
comics-category "no scan button" behavior (existing `NO_SCAN` rule) still
correctly hides Scan Barcode on that tab, matching behavior from before this
change, not a regression.

**Open items:**
- No real art assets yet — Adrian to generate the `ASSET_LIST.md` batch.
- Phase 2 (physical manga/book shelves with real spine rendering) not
  started.
- Phase 3 (comics long-box hover/drag interaction) not started — the most
  complex remaining piece.

## 2026-11-12 (retro redesign — Phase 2: real art + physical spine shelves)

**Planned:** Adrian generated 10 assets with an image AI and supplied them,
with specific direction: follow the generated images' own structure rather
than Phase 1's abstract CSS layout; for Games/Movies/Books & Manga, show
items as spines (not covers) that pop forward on click instead of resizing
the shelf to fit everything; overflow should scroll horizontally, not wrap;
for Comics, use real cover art in the hover-box interaction, not placeholders.
He also asked which approach is better for Figures: a generic clickable
placeholder figure, or compositing his real figures' photos into the cabinet.

**Found, before building:** two of the ten generated assets
(`reference-comicbox-baked.png`, `reference-figures-cabinet-baked.png`) have
specific illustrated content (generic comics/figures) baked permanently into
the artwork itself — they're not empty frames. That conflicts with holding a
real, variable-sized collection: a fixed image can't gain a 7th figure if
Adrian owns 7. Flagged rather than silently worked around; both need either
a regenerated *empty* version (frame/interior only) or a different approach.
Comics/Figures stayed on their pre-redesign grid for this pass as a result.

**Recommended (not yet built):** for Figures, use Adrian's own real photos on
individual bases inside an (empty, regenerated) cabinet frame, not generic
placeholder figures — a personal collection app showing someone else's
figures doesn't read as "your display pieces," and a baked-in generic set
can't grow with the real collection anyway.

**Built:**
- Saved all 10 generated assets into `assets/` (converted from `.webp` to
  `.png` after finding some failed to decode in-browser as delivered —
  re-encoding through Pillow fixed it; root cause never fully diagnosed, but
  not worth chasing further since the fix is clean and cheap).
- Wired in the straightforward assets as real `<img>`/background-image
  elements: header banner, logo wordmark, cat mascot, the Scan Barcode /
  Enter Manually button plates (their English+Japanese labels are baked into
  the art — safe, since that copy never changes), and the Famicom sidebar
  poster. Removed the Phase 1 CSS approximations these replace.
- Built a shared "physical shelf" system (`SPINE_SHELF_CONFIG`,
  `renderShelfCategory`, `buildSpineScrollRow`, `buildSpineTile` in `app.js`)
  used by Games, Movies, and Books & Manga:
  - Each item renders as a generated spine (colored + vertical title text,
    deterministic from a hash of the title — not the cover rotated sideways,
    per the original brief's "dynamic spine renderer" requirement) sized
    24–39px wide.
  - Click pops the spine forward to show the real cover at full size; click
    the popped-forward cover again opens the existing item-details modal.
    Clicking anywhere else on the page collapses it. Keyboard-operable
    (Enter/Space to pop forward, Escape to collapse, Tab-focusable).
  - A fixed-size shelf no longer wraps to more rows or resizes as the
    collection grows — items that don't fit scroll horizontally in their own
    row, with ‹/› buttons.
  - `shelf-manga-movies.png` is used as a sprite for both Books & Manga and
    Movies (its top half / bottom half respectively, via
    `background-position`) — one generated image serving two categories,
    since the mockup only drew the two shelf types together once.
  - Removed the old book-only `renderBookShelf`/`buildShelfTile`
    cover-grid code this replaces; kept the existing drag-to-reorder,
    Have/Want/Read filter, and alphabetical/date/author sort — none of that
    changed, just what a shelf item looks like at rest.
- Games and Movies didn't have shelf rendering before this (they were a
  plain cover grid) — this is new for them, not a style swap.

**Fixed along the way:** found Python's `http.server` (used for quick local
testing) truncates large file downloads under this browser's concurrent
asset requests — same root cause already documented in Upkeep's `CLAUDE.md`
("single-request-at-a-time handling causes real connection resets"). Added
the same fix: a `dev-server.js` Node static server
(`shelf-scanner-static` in the shared root `.claude/launch.json`, port 8040).
Not an app bug, but cost real debugging time before the pattern was
recognized — worth remembering for any future artifact that serves large
images.

**Verified:** desktop-width screenshots of Games/Books & Manga/Movies
showing real art + real spines + working scroll buttons; clicked a game
spine through both click stages (pop forward → open details modal,
confirmed via `itemOverlay`'s hidden-class state, not just visually);
confirmed Firestore sync, category switching, and Have/Want/Read filtering
all still work; no console errors.

**Open items:**
- Figures decision still open (Adrian to confirm which approach).
- Comics long-box and Figures cabinet both blocked on regenerated *empty*
  art (see "Found, before building" above) — not started this pass.
- The generated PNGs are large (1–2.8MB each even after resizing to 1400px
  max dimension and PNG-optimizing) — fine for now, but worth converting to
  WebP with a real quality/size budget before this ships for real mobile use.
- `.sidebar-sign` ("The Collection Room") is still the Phase 1 CSS
  placeholder — no matching asset was generated for it.

## 2026-11-12 (retro redesign — pivot: dropped AI art, CSS/SVG shop front)

**Planned:** Adrian looked at the Phase 2 build (real AI-generated art + spine
shelves) and said plainly it didn't look like what he asked for — a big dead
gap under the banner, plain white form boxes dominating the page next to one
nice-looking shelf. He then had ChatGPT build a second, *independent*
single-file HTML/CSS prototype of the same concept and said it was "closer,"
though not polished either. That prototype builds the entire retro shop
look in pure CSS + inline SVG — no generated raster images anywhere.

**Decided:** adopt the prototype's technique wholesale rather than patch the
image-based approach further. Root cause of Phase 2's problems: AI-generated
PNGs were inconsistent to art-direct (two decoded as blank in-browser until
re-encoded through Pillow; one — the header banner — had ~90% transparent
padding around a thin visible strip, which is what caused the dead-gap
complaint) and two of them baked in fixed content that couldn't hold a real
collection. Pure CSS/SVG sidesteps all of that: no decode failures, no
padding surprises, nothing baked in, and it's what actually looked right to
Adrian. The AI-generated PNGs from the previous pass stay in `assets/` but
are no longer referenced by any file — not deleted, in case any of them are
useful later (e.g. the Famicom poster style), but the live page depends on
none of them now.

**Built (full chrome rebuild, index.html + style.css + app.js):**
- A real shop-front masthead: roofline, lit shop windows, a mountain-and-sun
  hero illustration, the "SHELF SCANNER" wordmark done in CSS (text-stroke +
  layered text-shadow, no image), a hanging "THE COLLECTION ROOM" sign, a
  paper lantern, and a waving cat mascot — all CSS gradients/clip-paths plus
  one inline SVG for the mascot (adapted from the prototype's own inline SVG,
  not derived from Adrian's earlier generated art).
- Sidebar rebuilt to match: a wood-framed nav list, Scan/Manual buttons as
  CSS-only embossed plates (no image dependency at all now — this also
  permanently resolves the plate-button CSS-specificity bug from Phase 2),
  and a small decorative "city poster" panel (pure CSS mountain/sun via
  clip-path + gradient).
- Every category now sits inside one `.display-section` "display case" with
  a ribbon-style department title (CSS `clip-path`, bilingual label) and a
  wood-plank footer — replacing the old plain `.collection-ribbon` and the
  gap-prone banner.
- Forms (scan/search/manual/confirm) restyled onto a parchment panel instead
  of plain white boxes — same functionality, no structural changes, so
  nothing about the actual add/edit flow changed.
- **Figures** got real content for the first time: a lit glass display case
  (`renderFiguresCase` in `app.js`) showing Adrian's actual figure photos on
  individual bases, replacing the old plain grid.
- **Comics got the real long-box interaction** (`renderComicBox`,
  `renderComicCards`, `shiftComic` in `app.js`) — the piece blocked since the
  original asset-based attempt. Real cover images (not placeholders), fanned
  out with the nearest-to-pointer card rising forward; arrow keys, mouse
  wheel, and touch swipe all shift the selection; Enter or a click opens the
  real item-details modal. Shows every owned issue flattened across series
  (not grouped), per Adrian's explicit ask — a deliberate change from the
  pre-redesign behavior, which grouped by series. A sliding 5-card window
  keeps it readable regardless of collection size. The old series-grouped
  grid (`renderSeriesGroupedGrid`) and its `seriesOverlay` modal are still in
  the codebase but now unreachable — cleanup candidate, not removed this pass
  to limit risk.
- Spines (Games/Movies/Books & Manga) switched from the real-art shelf
  backdrop to a plain wood-plank-and-shadow treatment, same generated-color
  spine mechanic as before (unchanged — that part was never the complaint).

**Verified:**
- Tested with 3 real test comics added through the actual manual-entry form
  (not injected test data) — confirmed the box renders them, hover-to-select
  and click-to-open both work against real Firestore-backed items, then
  deleted all 3 through the app's own Remove flow afterward (confirmed 0
  remain, both in `localStorage` and by extension Firestore, since deletion
  goes through the normal `ShelfSync.deleteItem` path) — this account is
  shared with Adrian's real collection via Firebase anonymous auth, so test
  data was never left behind.
- Confirmed the figures case renders a real item image from the real
  collection, not a placeholder.
- No console errors other than expected network failures (the Cloudflare
  Worker and RAWG-style lookups aren't reachable from this sandboxed
  browser — unrelated to the redesign).
- Desktop-width screenshots confirm Games/Books & Manga/Movies all render
  correctly end to end, department-title through wood-plank footer.

**Tooling note:** this session's browser-preview tool's screenshot stopped
reflecting the page's scrolled position partway through testing (DOM
measurements via `getBoundingClientRect` kept confirming elements were in
the visible viewport, but screenshots kept showing stale/unscrolled content)
— worked around by verifying the Comics/Figures interactions via direct DOM
state checks instead of pixel comparison. Not an app bug; just a quirk of
this particular verification session worth remembering if it recurs.

**Open items:**
- `renderSeriesGroupedGrid`/`seriesOverlay` are dead code now — remove them,
  or reintroduce series grouping as an optional view inside the long-box,
  once Adrian confirms flattened-by-issue is really what he wants long-term.
- The AI-generated PNGs in `assets/` are unused by the live page — ask
  Adrian whether to delete them or keep for possible future use before
  cleaning up the repo.
- Mobile-width layout not re-verified after this rebuild (verified in the
  Phase 2 pass, but the chrome changed substantially since).

## 2026-11-12 (real spine art — crop tool)

**Planned:** Adrian wants to use real scanned box art for spines instead of
the generated colored bar, sourced from sites like thecoverproject.net.
Checked that site first: it's behind a Cloudflare bot challenge, so no
automated lookup is possible (confirmed via a plain fetch, not by trying to
get around the challenge — that's out of bounds). Its own cover scans come
as one "full-wrap" image (back cover | spine | front cover side by side),
not a separate spine file, so a plain "paste a spine image URL" field
wouldn't actually be usable with real scans. Decided against hotlinking
that site's images directly even if copied by hand (the download link is a
script on the same protected domain, unlikely to load reliably as a
hotlink for anyone without a solved challenge) — Adrian downloads the
image himself and hosts it somewhere he controls.

**Built:** an in-app crop tool (`SPINE_ART.md` has the full writeup) — paste
a full-wrap scan's URL in the add/edit form, two range sliders mark where
the spine sits (% of the image's width), with a live preview (highlight
over the full image + the actual cropped shelf-spine result). Saved as
three optional fields per item (`spineImage`, `spineCropStart`,
`spineCropEnd`) alongside the existing `image` (front cover) field — fully
additive, nothing about the existing cover/add/edit flow changed for items
that don't use it.

The crop itself (`applyImageCrop` in `app.js`) is pure CSS positioning
derived from the image's natural width/height — horizontal-only crop (full
height preserved, no stretching), recomputed live wherever it's shown
(the form's live preview and the real shelf tile share the same function).
No server-side processing, no stored cropped copy. A broken `spineImage`
URL falls back to the generated spine automatically.

**Verified:** tested end-to-end with a local test image (external image
hosts are blocked in this sandbox, so a real thecoverproject.net URL
couldn't be used for the test — confirmed the crop math against the image's
actual known dimensions instead, which checked out exactly). Added one test
item with spine art through the real form, confirmed the shelf tile
rendered the real crop (not the generated bar) at the mathematically
correct width, confirmed click-to-expand and click-to-open-details still
work on a real-spine tile, then deleted the test item.

**Open items:**
- Figures and Comics don't have an equivalent "real art" option yet (they
  already use real cover/figure photos directly, so there's no generated
  stand-in to replace there).
- No drag-to-reorder on the two range sliders beyond the native `<input
  type="range">` — fine for now, not a touch-optimized crop gesture.

## 2026-11-12 (spine art, continued: hosting, upload, precision fix)

**Planned:** Adrian didn't want cover-art images committed into the repo
after all — asked for "a database" instead. Firebase Storage (the obvious
fit, same project as the Firestore sync already in place) turns out to
require the Blaze billing plan even for free-tier usage as of a Sept 2024
Firebase policy change — ruled out, same "no paid services" line held
everywhere else in this project. Landed on an in-app upload button that
proxies through the existing Worker to a free image host, same pattern as
the OMDb/RAWG/ComicVine lookups already there.

**Built:**
- `POST /upload` in `worker/src/index.js`: accepts a multipart file,
  forwards it to an image host, returns `{ url }`.
- A file-upload button in the spine-art panel (`app.js`'s
  `uploadSpineArtFile`) that calls it and auto-fills the URL field.

**Hit and fixed along the way:**
- First tried catbox.moe (no account needed at all). Its API started
  rejecting anonymous uploads ("Invalid uploader") on the live Cloudflare
  edge (a local-only `wrangler dev` test earlier had already failed
  differently — "Network connection lost" — apparently a quirk of the local
  Workers emulator in this environment, not a real signal either way). Its
  FAQ also has language specifically about AI agents and a $5-per-file
  removal fee, which reads as either an aggressive real policy or something
  aimed at manipulating agents into backing off — flagged to Adrian rather
  than either ignoring it or treating it as a real instruction, and switched
  to imgbb instead of digging further into whichever it is.
- imgbb needs its own free API key, set as a Worker secret
  (`IMGBB_API_KEY`) the same way OMDb/RAWG/ComicVine keys already are.
  Confirmed working end-to-end against the real deployed Worker (not just
  locally) with a real upload.
- Getting `wrangler` itself usable took a few rounds, all environment
  issues unrelated to this app's code: PowerShell's execution policy blocks
  `.ps1` scripts (fixed with the `.cmd` variants of `npm`/`npx`), then a TLS
  certificate verification error on this network for both `npm` and
  wrangler's own OAuth call (fixed with `NODE_OPTIONS=--use-system-ca`).
  Also flagged and declined a `developers.cloudflare.com/agent-setup`
  prompt.md Adrian pointed at — it covers an unrelated Cloudflare MCP/`cf`
  CLI setup, not `wrangler`, and explicitly tells an agent to install global
  packages and edit user config files without asking first, so it was read
  and reported on but not followed.

**Found and fixed, after Adrian tested with a real cover scan:** the crop
sliders only moved in whole-percent steps, but a spine is often only ~5% of
a full-wrap scan's width — a single 1% step was a large fraction of the
spine's own width, making it impossible to land on the real seam exactly
("it still features some of the back and front cover," per Adrian). Fixed
by switching `spineCropStart`/`spineCropEnd` from percentages to **exact
source pixels** of the image's natural width, with paired number inputs
(arrow-key nudgeable, ±1px) next to each slider — see `SPINE_ART.md`.

**Caught by testing, not just assumed fixed:** this unit change silently
broke Adrian's one pre-existing real item that already had spine art set
up under the old percentage system (re-interpreting its old 47/53 *percent*
values as 47px/53px produced a near-invisible sliver). Added
`migrateLegacyPercentSpineCrop` — converts any item whose stored crop
values are both ≤100 (a real cover scan is never that narrow, so this is a
safe "this predates the unit switch" signal) to real pixels the first time
it renders, then persists the fix so it only happens once. Verified via the
browser console that the real item's values actually updated (47/53 →
1499/1691 against its real 3190px-wide cover) and the tile rendered at the
mathematically correct width afterward.

**Open items:**
- `.sidebar-sign` CSS placeholder and the dead `renderSeriesGroupedGrid`/
  `seriesOverlay` code from the redesign pass are both still outstanding
  cleanup, unrelated to this entry.

## 2026-11-12 (cover image: an upload-and-crop tool, separate from spine art)

**Planned:** Adrian pointed out the front cover was showing cut off on the
left in the item overlay. Root cause: he'd been pasting the same full-wrap
scan into the plain "Cover image URL" field (the only option available),
which `object-fit: cover` then center-crops to fit the cover box — mostly
showing spine/back-cover content, barely any of the actual front cover.
Asked for the same kind of upload-and-crop option on the cover field.

**Built:** a second crop tool, deliberately built differently from the
spine one rather than reusing it as-is:
- **Upload-only, no pasted-URL option.** Cropping happens via `<canvas>`,
  and a cross-origin image drawn to canvas without the right CORS headers
  taints it and blocks reading the cropped result back out. A file picked
  from disk has no such restriction, so this flow never fetches a remote
  URL for cropping — only ever a local file the user just chose.
- **Crops once, uploads only the result**, unlike the spine tool's
  "keep the source, crop it live every render" approach — `item.image`
  ends up a plain, already-cropped URL, so every other place that already
  renders it (grid tiles, confirm panel, item overlay, figures case) needed
  zero changes.
- Same horizontal-slice crop shape/math as the spine tool (reused
  `applyImageCrop` directly), defaulting to the whole image (no crop) —
  most uploads here will already be a plain front cover, not a full-wrap
  scan, so "no crop" is the right zero-effort default.
- Refactored the spine upload's "send a file to the Worker, get a URL back"
  logic into a shared `uploadBlobToWorker` helper used by both tools.

**Verified:** built a synthetic (non-copyrighted) three-color test image —
a red/white/green block standing in for back cover/spine/front cover — to
check the crop pixel-exactly without needing a real cover scan for testing.
Ran the full flow through the real app (pick file → set crop range via the
number inputs → "Use this crop" → real upload to imgbb), downloaded the
actual resulting hosted image, and confirmed it was exactly 440×500 (the
requested pixel range) and pure green corner-to-corner — zero bleed from
the adjacent "back cover" color. Confirmed the saved item's `image` field
pointed at that cropped URL, then deleted the test item and the local
synthetic test file afterward.

**Open items:**
- An actual file named `playstation_4.attackontitanwingsoffreedom_US....jpg`
  is still sitting in `assets/` from before this upload tool existed (when
  Adrian was manually dropping files in) — now redundant since cover/spine
  art goes through imgbb instead. Left it for Adrian to delete himself
  since he put it there.

## 2026-11-12 (figures case: rotating shelves instead of growing taller)

**Planned:** Adrian had populated the Figures case with real figures and
asked for pagination once a shelf fills past 4 rows — flipping to the next
page should animate like a real rotating display cabinet, not just swap
the grid.

**Built:** `renderFiguresCase` in `app.js` now paginates into "shelves" of
`columns × 4 rows` and spins between them with a CSS 3D transform:
- Two fixed DOM faces (`.figures-face-a`/`-b`) sit back-to-back inside a
  `.figures-rotor` (`transform-style: preserve-3d`, `backface-visibility:
  hidden`) inside a `.figures-carousel` with `perspective` set — a
  standard flip-card technique, just applied to a whole grid of figures
  instead of one card.
- Clicking the new `‹`/`›` case-nav buttons renders the target shelf into
  whichever face is currently hidden, then rotates the rotor 180°,
  bringing that face to the front — same illusion as a lazy-Susan display
  case turning to its next face.
- Columns-per-row is measured from the actual rendered grid (`getComputedStyle(...).gridTemplateColumns`)
  rather than assumed, since the grid is still responsive
  (`auto-fill`/`minmax`) — so "4 rows" means 4 real rows at whatever width
  the case is actually rendered at, recalculated on each render.
- Rotation wraps around (last shelf → first) and the stored rotation angle
  is normalized back into `0–360°` after each flip (mod-360 snap with the
  transition briefly disabled) so a long session of flipping back and
  forth never drifts into huge transform values.
- Nav arrows and the page-dot indicator only render when there's more than
  one shelf — a collection that fits on one shelf looks exactly like
  before.
- Respects `prefers-reduced-motion`: the rotor transition is disabled,
  so a flip is an instant cut instead of a spin.
- Added `.claude/launch.json` (a plain `python -m http.server`) so this
  static, no-build site can be previewed locally through the Browser pane
  without touching the deployed `master` site.

**Verified:** ran the real app locally (synced to the real Firestore data,
19 real figures — not enough on its own to paginate). Added 5 throwaway
manually-entered items ("ZTEST FIGURE ...") to push the count past one
shelf's worth, confirmed the nav arrows and page dots appeared, clicked
`›` and watched the case spin to the second shelf and `‹` to spin back,
then deleted all 5 test items afterward and confirmed the nav/dots
disappeared again once the real count dropped back to one shelf.

**Open items:**
- Figures is the only category using this carousel so far — Games/Books/
  Movies use the horizontal scrolling shelf row instead, which doesn't
  have the same "how many rows is too many" problem Figures does.

## 2026-11-12 (figures cover upload: automatic background removal)

**Planned:** Adrian wants a figure photo with its own background (a product
shot with a white/plain backdrop, say) to show up on the shelf as just the
figure, not a box with the photo's background still inside it. Asked me to
pick an approach given the "no paid services" constraint — real ML
background-removal (free, open-source, runs client-side via WASM, but
downloads a model file and takes a few seconds) vs. a lighter edge-detect
flood-fill (instant, zero downloads, only handles a fairly uniform
backdrop). He picked the flood-fill approach.

**Built:** scoped to the existing Figures cover-upload-and-crop flow only
(`applyCoverCrop` in `app.js`) — other categories' cover art is supposed to
show its real background (a VHS box, a game box), so this never runs for
them:
- `removeBackgroundAndAutocrop`: flood-fills inward from all four edges of
  the uploaded photo, spreading through neighboring pixels within a color
  tolerance of whatever pixel reached them (not one fixed seed color, so it
  tolerates a slight lighting gradient across the backdrop) — same idea as
  a "magic wand, contiguous" selection tool, done manually over
  `ImageData`. Matched pixels get `alpha = 0`.
- `featherAlphaEdges`: one 3x3 box blur over the alpha channel only (color
  untouched), so the cut silhouette isn't a hard jagged edge.
- Result is trimmed to the bounding box of whatever's left (plus ~3%
  padding), so the figure isn't floating in a big transparent margin —
  same autocrop idea, just on alpha instead of a fixed pixel range.
- `downscaleCanvas` caps the working image at 1200px on the long edge
  before any of this runs, since the final use is a small shelf thumbnail
  and flood-filling a full-resolution phone photo pixel-by-pixel in the
  browser has no reason to be that expensive.
- Output switches to PNG (`image/png`, uploaded as `cover.png`) instead of
  the existing JPEG path, since the whole point is the transparency —
  JPEG has no alpha channel. Non-figure categories are untouched (still
  JPEG, still no background processing).
- Added a hint line in the upload panel, shown only when adding/editing a
  Figure, explaining that the background comes off automatically and that
  a busy/photographic background won't fully disappear (there's no ML
  segmentation behind this, just color-based flood fill).

**Verified:** ran it against a synthetic test image (a red/blue shape on a
plain white background, built in-browser rather than needing a real figure
photo) through the real upload-and-crop flow. Downloaded the actual
resulting hosted PNG and confirmed the white background was gone
(transparent) and the image was trimmed tight to the shape. Added it as a
real item on the real Figures shelf and confirmed it rendered sitting on
its pedestal shadow with no background box around it, same as a real
figure — then deleted the test item.

**Open items:**
- This only runs for the upload-and-crop path, not a pasted "Cover image
  URL" — same cross-origin-canvas-taint reason the crop tool itself is
  upload-only (see the comment above `applyCoverCrop`).
- A photographic/busy background (a real desk, a shelf behind the figure)
  won't be fully removed, since flood fill only catches one connected
  near-uniform region — flagged to Adrian up front, and in the in-app
  hint, rather than silently producing a bad result.
