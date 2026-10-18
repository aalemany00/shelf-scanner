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
//   GET /search?kind=comic&title=...          -> ComicVine + Jikan combined
//     (manga isn't a separate category client-side — it's just another
//     series within the same comic model). A trailing issue number finds
//     that exact ComicVine issue; otherwise returns distinct series/eras
//     from ComicVine plus manga titles from Jikan to pick from — see
//     comic-issues for drilling into a ComicVine series' issue list.
//   GET /search?kind=comic-issues&volumeId=... -> that series' issue list
//   GET /search?kind=isbn&isbn=...            -> Open Library, by ISBN
//     (printed manga/graphic-novel volumes carry a real ISBN-13 barcode on
//     the back cover — neither ComicVine nor Jikan search by ISBN, so this
//     is a separate lookup, not a mode of the ComicVine/Jikan title search.
//     Google Books was tried first but its keyless/anonymous quota is
//     exhausted globally — not something fixable from our side.)

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
  comic: "ComicVine/Jikan",
  isbn: "Open Library"
};

async function handleSearch(url, env) {
  const kind = url.searchParams.get("kind") || "";

  // A single try/catch around every upstream call: any of these free-tier
  // APIs can be slow, rate-limited, or just down (Jikan hit a sustained
  // outage during development), and a raw timeout/network error here would
  // otherwise surface as an opaque Cloudflare error page with no CORS
  // headers, which the app can't show a useful message for.
  try {
    if (kind === "comic-issues") {
      const volumeId = url.searchParams.get("volumeId") || "";
      if (!volumeId) return json({ error: "Missing volumeId parameter." }, 400);
      return await listComicVineIssues(volumeId, env);
    }

    if (kind === "isbn") {
      const isbn = (url.searchParams.get("isbn") || "").replace(/[^0-9Xx]/g, "");
      if (!isbn) return json({ error: "Missing isbn parameter." }, 400);
      return await searchByIsbn(isbn);
    }

    const title = (url.searchParams.get("title") || "").trim();
    if (!title) {
      return json({ error: "Missing title parameter." }, 400);
    }

    var handler = { movie: searchOmdb, game: searchRawg, comic: searchComicVine }[kind];
    if (!handler) {
      return json({ error: "Unsupported kind: " + kind }, 400);
    }
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

var CV_HEADERS = { headers: { "User-Agent": "ShelfScanner/1.0 (personal hobby project)" } };

function cvItem(c) {
  var volumeName = c.volume && c.volume.name ? c.volume.name : c.name || "Untitled";
  var issueNum = c.issue_number ? " #" + c.issue_number : "";
  return {
    title: volumeName + issueNum,
    seriesName: volumeName,
    image: (c.image && (c.image.small_url || c.image.thumb_url)) || "",
    meta: "Comic" + (c.cover_date ? " · " + c.cover_date : "")
  };
}

async function searchComicVineVolumes(seriesTitle, env) {
  var volUpstream = await fetchWithTimeout(
    "https://comicvine.gamespot.com/api/search/?api_key=" + env.COMICVINE_API_KEY +
      "&format=json&resources=volume&query=" + encodeURIComponent(seriesTitle) +
      "&field_list=id,name,start_year,count_of_issues,image",
    CV_HEADERS
  );
  var volData = await volUpstream.json();
  if (volData.error && volData.error !== "OK") return [];
  return (volData.results || []).sort(function (a, b) {
    return (b.count_of_issues || 0) - (a.count_of_issues || 0);
  });
}

async function searchComicVine(title, env) {
  // "The Amazing Spider-Man #363" as plain text search matches on issue
  // titles/descriptions, not issue number, so it mostly returns whatever
  // issues happen to mention "363" in their blurb — not issue #363. If the
  // input ends in a number, find the series (volume) first, then ask for
  // that exact issue number within it, which actually works.
  var issueMatch = title.match(/^(.*?)[\s#]+(\d+)\s*$/);
  if (issueMatch && env.COMICVINE_API_KEY) {
    var exact = await searchComicVineByIssueNumber(issueMatch[1].trim(), issueMatch[2], env);
    if (exact.length) return json({ items: exact }, 200);
    // Fall through to the series/manga picker if nothing matched that exact issue.
  }

  // No issue number (or no exact match): a plain issue-text search mostly
  // returns whichever single volume has the most/newest issues, repeated —
  // not useful for "what Green Lantern comics exist." Show distinct series
  // (eras/reboots) instead, plus manga titles from Jikan (manga isn't a
  // separate category — just another series in the same model). Picking a
  // ComicVine series drills into its issue list (kind=comic-issues); picking
  // a manga title adds it directly, since Jikan doesn't expose per-volume
  // records the way ComicVine does.
  var seriesTitle = issueMatch ? issueMatch[1].trim() : title;
  var comicItems = [];
  if (env.COMICVINE_API_KEY) {
    var volumes = await searchComicVineVolumes(seriesTitle, env);
    comicItems = volumes.slice(0, 6).map(function (v) {
      return {
        title: v.name + (v.start_year ? " (" + v.start_year + ")" : ""),
        seriesName: v.name,
        image: (v.image && (v.image.small_url || v.image.thumb_url)) || "",
        meta: "Comic series" + (v.count_of_issues ? " · " + v.count_of_issues + " issues" : ""),
        volumeId: v.id
      };
    });
  }

  var mangaItems = await searchJikanItems(seriesTitle).catch(function () { return []; });

  return json({ items: comicItems.concat(mangaItems) }, 200);
}

async function searchComicVineByIssueNumber(seriesTitle, issueNumber, env) {
  // Multiple volumes often share a series name (reboots/relaunches). The
  // one with the most issues is almost always the "main" ongoing series
  // readers mean when they just say a title and a number — not a perfect
  // heuristic, but far better than plain text search. Check the top few in
  // case the biggest one doesn't happen to have that specific issue.
  var candidates = (await searchComicVineVolumes(seriesTitle, env)).slice(0, 3);

  var results = await Promise.all(
    candidates.map(function (vol) {
      return fetchWithTimeout(
        "https://comicvine.gamespot.com/api/issues/?api_key=" + env.COMICVINE_API_KEY +
          "&format=json&filter=volume:" + vol.id + ",issue_number:" + encodeURIComponent(issueNumber) +
          "&field_list=name,image,volume,issue_number,cover_date",
        CV_HEADERS
      )
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.results || []; })
        .catch(function () { return []; });
    })
  );

  return results.flat().map(cvItem);
}

var CV_ISSUES_FIELDS = "name,image,volume,issue_number,cover_date";
var CV_ISSUES_PAGE_CAP = 500; // long-running volumes (Batman 1940: 700+) stop here

function cvIssuesPageUrl(volumeId, env, offset) {
  return "https://comicvine.gamespot.com/api/issues/?api_key=" + env.COMICVINE_API_KEY +
    "&format=json&filter=volume:" + encodeURIComponent(volumeId) +
    "&limit=100&offset=" + offset +
    "&field_list=" + CV_ISSUES_FIELDS;
}

async function listComicVineIssues(volumeId, env) {
  if (!env.COMICVINE_API_KEY) {
    return json({ error: "ComicVine key not configured yet." }, 501);
  }

  const first = await (await fetchWithTimeout(cvIssuesPageUrl(volumeId, env, 0))).json();
  if (first.error && first.error !== "OK") {
    return json({ error: "ComicVine: " + first.error }, 502);
  }

  var all = (first.results || []).slice();
  var total = Math.min(first.number_of_total_results || all.length, CV_ISSUES_PAGE_CAP);

  // A volume's issues come 100 at a time; fetch the rest in parallel so a
  // long-running series (Batman 1940: 700+ issues) isn't silently cut off
  // at the first page.
  var extraOffsets = [];
  for (var offset = 100; offset < total; offset += 100) extraOffsets.push(offset);

  if (extraOffsets.length) {
    var pages = await Promise.all(
      extraOffsets.map(function (offset) {
        return fetchWithTimeout(cvIssuesPageUrl(volumeId, env, offset))
          .then(function (r) { return r.json(); })
          .then(function (d) { return d.results || []; })
          .catch(function () { return []; });
      })
    );
    pages.forEach(function (page) { all = all.concat(page); });
  }

  // ComicVine's own sort treats issue_number as text ("1, 10, 11, 12, 2..."),
  // not a number. Parse it ourselves; non-numeric issue numbers (annuals,
  // specials) sort after the regular run instead of scattering randomly.
  const results = all.sort(function (a, b) {
    var an = parseFloat(a.issue_number);
    var bn = parseFloat(b.issue_number);
    var aValid = !isNaN(an);
    var bValid = !isNaN(bn);
    if (aValid && bValid) return an - bn;
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  });

  return json({ items: results.map(cvItem) }, 200);
}

// Open Library is free, keyless, and indexes by ISBN — the barcode actually
// printed on a manga/graphic-novel volume. (Google Books also does this but
// its keyless/anonymous quota is exhausted globally as of this writing.)
// Cover images come from Open Library's separate covers.openlibrary.org
// endpoint, which takes an ISBN directly with no lookup step of its own.
async function searchByIsbn(isbn) {
  const upstream = await fetchWithTimeout(
    "https://openlibrary.org/api/books?bibkeys=ISBN:" + encodeURIComponent(isbn) + "&format=json&jscmd=data"
  );
  const data = await upstream.json();
  const book = data["ISBN:" + isbn];
  if (!book) return json({ items: [] }, 200);

  const item = {
    title: book.title + (book.subtitle ? ": " + book.subtitle : ""),
    seriesName: book.title,
    image: "https://covers.openlibrary.org/b/isbn/" + encodeURIComponent(isbn) + "-M.jpg",
    meta: "Comic/Manga" + (book.publish_date ? " · " + book.publish_date : "")
  };
  return json({ items: [item] }, 200);
}

async function searchJikanItems(title) {
  const upstream = await fetchWithTimeout(
    "https://api.jikan.moe/v4/manga?q=" + encodeURIComponent(title) + "&limit=6"
  );
  const data = await upstream.json();

  return (data.data || []).map(function (m) {
    return {
      title: m.title + (m.published && m.published.string ? " (" + m.published.string + ")" : ""),
      seriesName: m.title,
      image: (m.images && m.images.jpg && m.images.jpg.image_url) || "",
      meta: "Manga"
    };
  });
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
  });
}
