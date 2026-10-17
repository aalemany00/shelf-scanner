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
