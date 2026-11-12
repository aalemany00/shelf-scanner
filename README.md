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
Cloudflare Worker in `worker/`), and Have/Want/Read shelves with sorting all
work.

Now in progress: a full visual redesign into an illustrated Japanese retro
collection-room look, on branch `feature/retro-collection-room` — see
`CLAUDE.md` and `ASSET_LIST.md`.

See `LOG.md` for the plans/changes log.
