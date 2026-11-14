# Retro Collection Room — Asset List

> **Historical — this approach was abandoned.** The AI-generated PNG assets
> this document planned were generated, wired in, then scrapped in favor of
> pure CSS/SVG (see `LOG.md`'s 2026-11-12 pivot entry and `CLAUDE.md`). The
> actual files were deleted from `assets/` once nothing referenced them.
> Kept here only as a record of what was tried and why it didn't work.

Decorative art assets needed for the `feature/retro-collection-room` redesign,
derived from the two ChatGPT mockup images Adrian supplied. Generate these
with an image AI (ask for **one asset per image, transparent background,
no scene composition** — a flattened illustration can't be cleanly reused).

Rule of thumb used throughout: if it's real collection data (titles, counts,
search text, your actual cover art) it's a DOM element, not an image, and
isn't listed here. Everything below is purely decorative — the frame the
real UI sits inside.

**Format for each asset:** what it is → transparency? → rough size/aspect →
tiling? → a ready-to-paste generation prompt.

---

## STATUS (2026-11-12): two assets need a redo

10 assets were generated and wired in — see `LOG.md`'s 2026-11-12 entry for
what's live. Everything worked *except* two, which came back with specific
content baked into the illustration rather than an empty frame:

- **Comics long-box** — the generated image has 5 specific comics already
  drawn into it. Can't hold Adrian's real, variable-count comic collection as
  a fixed image. Saved as `assets/reference-comicbox-baked.png` — reference
  only, not wired into the live page.
- **Figures cabinet** — same problem: 6 generic anime figures baked in.
  Saved as `assets/reference-figures-cabinet-baked.png` — reference only.

**Regenerate both as empty frames**, same style, same prompt family as the
rest of the set:

> *"Illustrated open cardboard comic-book storage long-box, weathered kraft
> cardboard texture, viewed at a slight angle from above, warm painterly
> illustrated retro Japanese shop style, flat lighting, soft shadows — the
> box interior is completely EMPTY, no comics, no contents, just the box
> itself with a label area on the front edge. Transparent background outside
> the box. Do not include any comic books, people, or other objects."*

> *"Illustrated wooden display cabinet with a glass front panel, warm
> spotlight glow from above, subtle glass reflection streaks, warm painterly
> illustrated retro Japanese shop style, flat lighting, soft shadows — the
> shelves inside are completely EMPTY, no figures, no objects on them, just
> the cabinet structure itself. Transparent background outside the cabinet.
> Do not include any figures, characters, or other objects."*

Once those two exist, Comics gets the real long-box hover/browse interaction
and Figures gets real photos of Adrian's own collection on individual bases
inside the cabinet (the recommended approach over generic placeholders —
see `LOG.md`).

---

## 1. Global chrome

- **`bg-texture.png`** — warm cream paper/canvas grain + halftone texture for
  the page background. No transparency (full-bleed). Seamlessly tileable,
  square, ~512×512. *Prompt: "seamless tileable texture, warm cream paper
  grain with subtle halftone dot pattern, vintage Japanese print aesthetic,
  no text, no objects, flat lighting, 512x512"*
- **`header-banner-bg.png`** — the top red marquee banner background (stars +
  diagonal hazard stripes at the edges), transparent center where real text
  ("YOUR COLLECTION, ORGANIZED" etc.) will sit. Wide aspect (~1536×80), edges
  only need art, horizontally tileable in the middle. *Prompt: "vintage
  Japanese retro store banner strip, deep red background, white stars,
  diagonal red-and-white hazard stripe pattern at both ends, transparent
  flat center area for text overlay, no text, wide banner 1536x80"*
- **`wood-shelf-bg.png`** — the dark wood-grain panel backing every shelf
  section. No transparency needed (sits behind everything). Tileable
  vertically, ~800×1200. *Prompt: "dark warm wood plank wall texture,
  vertical boards, subtle grain, warm brown tones, seamless tileable
  vertically, no objects, flat even lighting, 800x1200"*
- **`ivy-corner-topleft.png`** / **`ivy-corner-topright.png`** — the hanging
  ivy vine decoration framing the top corners. Transparent background,
  ~400×500 each, positioned absolutely via CSS, one mirrored or two
  generated separately. *Prompt: "hand-painted illustration of hanging ivy
  vine with small leaves, draping downward from top corner, transparent
  background, no shadow baked in, soft painterly style, 400x500"*
- **`paper-lantern.png`** — the red hanging lantern (収集館). Transparent
  background, tall aspect ~300×500. *Prompt: "illustrated Japanese paper
  lantern (chochin), deep red, hanging from a cord at top, Japanese kanji
  calligraphy on front, transparent background, soft shadow underneath only,
  300x500"*
- **`fuji-skyline-corner.png`** — the small Mt. Fuji + city skyline + red sun
  illustration used as a corner decoration (bottom-left in mockup 2, sidebar
  card in mockup 1). Transparent or flat card background, ~500×350.
  *Prompt: "retro Japanese travel-poster illustration, Mt Fuji silhouette
  behind a small city skyline, large red sun, warm orange gradient sky, flat
  illustrated style, 500x350"*
- **`maneki-neko.png`** — the lucky cat figurine prop (small, sits on a
  shelf/counter). Transparent background, ~200×250. *Prompt: "small
  illustrated Japanese lucky cat figurine (maneki-neko), white with gold
  accents, one paw raised, transparent background, soft drop shadow only,
  200x250"*
- **`crt-tv.png`** — the retro CRT television prop with a static scene on its
  screen (Fuji or a night cityscape). Transparent background outside the TV
  body, ~350×350. Screen area should be a flat color/gradient if you want to
  later overlay a real looping GIF; otherwise bake in the scene. *Prompt:
  "illustrated retro CRT television, cream plastic shell, on screen a small
  pixel-art scene of Mt Fuji at sunset, transparent background, soft shadow
  only, 350x350"*
- **`potted-plant.png`** (×1–2 variants) — small desk/shelf plant prop.
  Transparent, ~150×200. *Prompt: "small illustrated potted plant, simple
  green leaves, terracotta pot, transparent background, 150x200"*

## 2. Mascot

- **`cat-mascot-idle.png`** — the calico shopkeeper cat in overalls (full
  body, standing pose). Transparent background, ~300×400. *Prompt:
  "illustrated calico cat mascot character wearing blue overalls, standing,
  friendly welcoming pose, one paw raised, flat illustrated retro style,
  transparent background, 300x400"*
- **`cat-mascot-wave.png`** (optional second pose for a hover/idle swap,
  same treatment as Upkeep's coach avatars) — same character, waving. Same
  spec as above.
- **`speech-bubble-frame.png`** — empty speech-bubble shape (the text itself
  stays real HTML so it's editable/localizable). Transparent, ~250×150.
  *Prompt: "empty rounded speech bubble shape, cream paper color, thin brown
  outline, small tail pointing down-left, transparent background, no text
  inside, 250x150"*

## 3. Section signage (one per category, same style family)

Each is a hanging sign/banner naming the section — real text can overlay a
transparent nameplate area, or these can be fully baked if the label never
needs to be dynamic (it won't — 5 fixed categories).

- **`sign-collection-room.png`** — "コレクションの部屋 / THE COLLECTION ROOM"
  hanging banner sign, ~700×150.
- **`sign-manga-books.png`** — "漫画・書籍 / MANGA & BOOKS", ~500×120.
- **`sign-movies-tv.png`** — "映画・TV / MOVIES & TV", ~500×120.
- **`sign-comics.png`** — "コミック / COMICS", ~500×120.
- **`sign-games.png`** — "ゲーム / GAMES", ~500×120.
- **`sign-figures.png`** — "フィギュア / FIGURES", ~500×120.

*Shared prompt template: "illustrated hanging wooden sign plaque with a thin
hanging chain at top corners, navy background, cream Japanese and English
text reading '[TEXT]', vintage Japanese shop signage style, transparent
background around the plaque shape, [WIDTH]x[HEIGHT]"* — generate each with
its own baked-in text since these are fixed labels.

## 4. Collection yellow ribbon banner

- **`ribbon-banner.png`** — the diagonal-striped yellow "COLLECTION /
  所蔵コレクション" ribbon seen above the item grid. Transparent ends, text
  area can be real HTML on top if you want it reusable for other section
  titles, or baked in since it's also fixed. ~900×80. *Prompt: "diagonal
  yellow and white striped ribbon banner, flat corners, vintage warning-tape
  style but cheerful, transparent background, empty center band for text
  overlay, 900x80"*

## 5. UI chrome — "plate" textures (NOT full buttons)

These are the metal/embossed *background* textures for real `<button>` /
`<input>` elements — generate as a 9-slice-friendly flat plate texture, not
a button with baked-in label, since the label text is dynamic.

- **`plate-red-embossed.png`** — the red riveted metal plate look (used for
  Scan Barcode). Transparent corners if rounded, flat tileable-enough center,
  ~400×100. *Prompt: "embossed red metal plate texture with visible rivets
  at the four corners, rounded rectangle, subtle brushed-metal highlight,
  flat empty center for text/icon overlay, transparent background outside
  the plate shape, 400x100"*
- **`plate-cream-embossed.png`** — the cream/white plate look (Enter
  Manually, search bar, sort dropdown, stat capsules). Same spec, cream
  color family, ~400×100 (make a couple size variants: wide for search bar,
  square-ish for stat capsules).
- **`stat-capsule-icon-book.png`**, **`-shelf.png`**, **`-calendar.png`** —
  small icon glyphs for the 3 stat capsules (items/shelves/last added),
  transparent, ~64×64 each, consistent line-icon style.

## 6. Comics long-box

- **`comic-box-frame.png`** — the cardboard long-box shell (front + side
  panels, open top), with the real comic issues rendered as actual DOM
  elements *inside* it. Transparent interior cutout where comics sit, ~900×
  500. *Prompt: "illustrated open cardboard comic-book storage long-box,
  weathered kraft cardboard texture, visible box label area on the front
  edge, viewed at a slight angle from above, interior empty/transparent for
  content to be placed inside, transparent background outside the box,
  900x500"*
- **`comic-box-label.png`** — the label card slotted into the box's front
  edge (text overlays on top, real HTML). Transparent, ~250×100.
- **`comic-sleeve-overlay.png`** — a subtle plastic-bag-and-backing-board
  sheen overlay to lay on top of each real comic cover image (low-opacity,
  tileable per-item size), ~400×600, mostly transparent with faint
  highlight streaks. *Prompt: "subtle plastic bag glossy highlight overlay
  texture, mostly transparent, faint diagonal light streaks in the
  upper-left, very low opacity, 400x600"*

## 7. Movies/TV shelf

- **`vhs-case-blank.png`** — blank VHS spine/case shape for items with no
  real cover art yet (fallback only — real covers render as real images).
  Transparent, ~120×300.
- **`dvd-case-blank.png`** / **`bluray-case-blank.png`** — same idea per
  format, ~110×280 and ~110×280.

## 8. Games shelf

- **`cartridge-blank.png`** — blank Famicom-style cartridge shape fallback,
  transparent, ~150×200.
- **`game-case-blank.png`** — blank standard game-case fallback, transparent,
  ~150×200.
- **`console-prop.png`** — small decorative retro console + controller prop
  for shelf dressing (non-interactive), transparent, ~300×200.

## 9. Figures cabinet

- **`cabinet-frame.png`** — the glass-front wooden display cabinet shell
  (frame + glass panel sheen + warm spotlight glow), transparent interior
  where real figure images sit on individually-rendered bases, ~900×600.
  *Prompt: "illustrated wooden display cabinet with glass front panel, warm
  spotlight glow from above, subtle glass reflection streaks, empty shelves
  inside, transparent interior area for content, transparent background
  outside the cabinet shape, 900x600"*
- **`figure-base.png`** — small circular/square display base/pedestal prop
  that sits under each real figure image, transparent, ~150×40.

---

## Notes for whoever generates these (Adrian, with an image AI)

1. **Always ask for a transparent background explicitly**, and for anything
   that's a "frame" (cabinet, box, sign), ask for the **interior to be empty
   or transparent too** — that's the part real content goes into.
2. **One asset per request.** A single combined scene (like the two mockups)
   looks great as a reference but can't be cut apart cleanly — generating
   each piece separately is slower but actually usable.
3. Keep every asset's **style prompt consistent** (same words: "warm
   painterly illustrated retro Japanese shop style, flat lighting, soft
   shadows") across all requests, or the pieces will look like they came
   from different artists when assembled together.
4. Dimensions above are starting points, not exact requirements — what
   matters is the aspect ratio and that interiors/edges are transparent
   where noted. Exact pixel sizes can be adjusted once we're wiring them in.
5. Skip anything marked "fallback"/"blank" for v1 if you want — those only
   matter for items missing real cover art, and can be plain CSS placeholders
   until this list's assets exist.
