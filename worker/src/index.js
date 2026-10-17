// Shelf Scanner lookup proxy.
//
// Barcode-to-item lookup (UPCitemdb) only allows requests from its own
// domain (CORS) and the free tier is a globally-shared trial, so it is a
// best-effort "try it first" step, not the primary path. The reliable path
// is a title search against a per-category API, run server-side here so the
// API keys never reach the browser or the repo.
//
// Routes:
//   GET /?upc=XXXXXXXXXXXXX           -> UPCitemdb trial lookup (best-effort)
//   GET /search?kind=movie&title=...  -> OMDb (by title)
//   GET /search?kind=game&title=...   -> RAWG (by title)
//   GET /search?kind=comic&title=...  -> ComicVine (by title)
//   GET /search?kind=manga&title=...  -> Jikan/MyAnimeList (by title, no key needed)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/search") {
      return handleSearch(url, env);
    }

    return handleUpcLookup(url);
  }
};

async function handleUpcLookup(url) {
  const upc = url.searchParams.get("upc") || "";
  if (!/^\d{6,14}$/.test(upc)) {
    return json({ error: "Missing or invalid upc parameter." }, 400);
  }

  try {
    const upstream = await fetchWithTimeout(
      "https://api.upcitemdb.com/prod/trial/lookup?upc=" + encodeURIComponent(upc)
    );
    const data = await upstream.json();
    return json(data, upstream.status);
  } catch (err) {
    return json({ error: "UPC lookup unreachable right now." }, 503);
  }
}

var SEARCH_SOURCE_NAME = {
  movie: "OMDb",
  game: "RAWG",
  comic: "ComicVine",
  manga: "Jikan"
};

async function handleSearch(url, env) {
  const kind = url.searchParams.get("kind") || "";
  const title = (url.searchParams.get("title") || "").trim();

  if (!title) {
    return json({ error: "Missing title parameter." }, 400);
  }

  var handler = { movie: searchOmdb, game: searchRawg, comic: searchComicVine, manga: searchJikan }[kind];
  if (!handler) {
    return json({ error: "Unsupported kind: " + kind }, 400);
  }

  // A single try/catch around every upstream call: any of these free-tier
  // APIs can be slow, rate-limited, or just down (Jikan hit a sustained
  // outage during development), and a raw timeout/network error here would
  // otherwise surface as an opaque Cloudflare error page with no CORS
  // headers, which the app can't show a useful message for.
  try {
    return await handler(title, env);
  } catch (err) {
    var name = SEARCH_SOURCE_NAME[kind] || kind;
    return json({ error: name + " is unreachable right now — try again later or enter manually." }, 503);
  }
}

function fetchWithTimeout(url, options) {
  return fetch(url, Object.assign({ signal: AbortSignal.timeout(8000) }, options));
}

async function searchOmdb(title, env) {
  if (!env.OMDB_API_KEY) {
    return json({ error: "OMDb key not configured yet." }, 501);
  }

  const upstream = await fetchWithTimeout(
    "https://www.omdbapi.com/?apikey=" + env.OMDB_API_KEY + "&type=movie&s=" + encodeURIComponent(title)
  );
  const data = await upstream.json();

  if (data.Response === "False") {
    return json({ items: [] }, 200);
  }

  const items = (data.Search || []).slice(0, 8).map(function (m) {
    return {
      title: m.Title + (m.Year ? " (" + m.Year + ")" : ""),
      image: m.Poster && m.Poster !== "N/A" ? m.Poster : "",
      meta: "Movie"
    };
  });
  return json({ items: items }, 200);
}

async function searchRawg(title, env) {
  if (!env.RAWG_API_KEY) {
    return json({ error: "RAWG key not configured yet." }, 501);
  }

  const upstream = await fetchWithTimeout(
    "https://api.rawg.io/api/games?key=" + env.RAWG_API_KEY + "&search=" + encodeURIComponent(title) + "&page_size=8"
  );
  const data = await upstream.json();

  const items = (data.results || []).map(function (g) {
    return {
      title: g.name + (g.released ? " (" + g.released.slice(0, 4) + ")" : ""),
      image: g.background_image || "",
      meta: "Game"
    };
  });
  return json({ items: items }, 200);
}

async function searchComicVine(title, env) {
  if (!env.COMICVINE_API_KEY) {
    return json({ error: "ComicVine key not configured yet." }, 501);
  }

  // ComicVine rejects requests with no User-Agent header.
  const upstream = await fetchWithTimeout(
    "https://comicvine.gamespot.com/api/search/?api_key=" + env.COMICVINE_API_KEY +
      "&format=json&resources=issue&query=" + encodeURIComponent(title) +
      "&field_list=name,image,volume,issue_number,cover_date",
    { headers: { "User-Agent": "ShelfScanner/1.0 (personal hobby project)" } }
  );
  const data = await upstream.json();

  if (data.error && data.error !== "OK") {
    return json({ error: "ComicVine: " + data.error }, 502);
  }

  const items = (data.results || []).slice(0, 8).map(function (c) {
    var volumeName = c.volume && c.volume.name ? c.volume.name : c.name || "Untitled";
    var issueNum = c.issue_number ? " #" + c.issue_number : "";
    return {
      title: volumeName + issueNum,
      image: (c.image && (c.image.small_url || c.image.thumb_url)) || "",
      meta: "Comic" + (c.cover_date ? " · " + c.cover_date : "")
    };
  });
  return json({ items: items }, 200);
}

async function searchJikan(title) {
  const upstream = await fetchWithTimeout(
    "https://api.jikan.moe/v4/manga?q=" + encodeURIComponent(title) + "&limit=8"
  );
  const data = await upstream.json();

  const items = (data.data || []).map(function (m) {
    return {
      title: m.title + (m.published && m.published.string ? " (" + m.published.string + ")" : ""),
      image: (m.images && m.images.jpg && m.images.jpg.image_url) || "",
      meta: "Manga"
    };
  });
  return json({ items: items }, 200);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
  });
}
