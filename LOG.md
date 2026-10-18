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
