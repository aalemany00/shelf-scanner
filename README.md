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

Layer 1 in progress: scan/lookup/manual-entry/local grid all work per
category. Not yet done: Firebase sync across devices, ComicVine lookup for
comics/manga, the visual bookshelf and comic-box UI (Layer 2).

See `LOG.md` for the plans/changes log.
