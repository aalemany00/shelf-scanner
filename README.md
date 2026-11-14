# Shelf Scanner

TCSS 490 Artifact 2. Scan a barcode with your phone, look up the item, and
file it into your collection (games, figures, comics, movies, manga).

## Run locally

No build step. Serve the folder over HTTP (camera access requires a secure
context, so `file://` won't work for scanning, though the grid/manual entry
still will):

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy

Push to a GitHub repo and enable GitHub Pages (Settings → Pages → deploy
from `main`, root). GitHub Pages serves over HTTPS, so camera scanning works
there even though it won't over plain `http://` on your phone.

## Status

Shipped and live. Scan/lookup/manual-entry, Firebase sync across devices,
category-specific lookups (OMDb/RAWG/ComicVine/Open Library via the
Cloudflare Worker in `worker/`), Have/Want/Read shelves with sorting, and
the Japanese retro collection-room redesign (shop-front chrome, a rotating
figures display case, a comic long-box, real spine art) are all merged to
`master` and live.

See `LOG.md` for the plans/changes log, `CLAUDE.md` for how this project is
set up to work with Claude Code, and `ASSET_LIST.md` for the (abandoned)
baked-art approach tried early in the redesign.
