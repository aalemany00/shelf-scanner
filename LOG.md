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
