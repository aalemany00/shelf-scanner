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

  const upstream = await fetch(
    "https://api.upcitemdb.com/prod/trial/lookup?upc=" + encodeURIComponent(upc)
  );
  const data = await upstream.json();
  return json(data, upstream.status);
}

async function handleSearch(url, env) {
  const kind = url.searchParams.get("kind") || "";
  const title = (url.searchParams.get("title") || "").trim();

  if (!title) {
    return json({ error: "Missing title parameter." }, 400);
  }

  if (kind === "movie") return searchOmdb(title, env);
  if (kind === "game") return searchRawg(title, env);

  return json({ error: "Unsupported kind: " + kind }, 400);
}

async function searchOmdb(title, env) {
  if (!env.OMDB_API_KEY) {
    return json({ error: "OMDb key not configured yet." }, 501);
  }

  const upstream = await fetch(
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

  const upstream = await fetch(
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

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
  });
}
