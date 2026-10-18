(function () {
  "use strict";

  var STORAGE_KEY = "shelfScanner.items";
  // UPCitemdb blocks browser-side calls via CORS, so this Worker proxies the
  // lookup server-side. See worker/src/index.js.
  var LOOKUP_PROXY_URL = "https://shelf-scanner-upc.adrian-alemany2-ae1.workers.dev";

  // Manga lives in Books (combined with regular books), not Comics — a
  // single-issue comic has no ISBN and isn't a "book" the way a manga
  // volume or a trade paperback is. No barcode lookup applies to loose
  // comic issues either way, so that category hides the Scan button.
  var CATEGORIES = ["game", "figure", "comic", "book", "movie"];
  var CATEGORY_LABELS = { game: "Games", figure: "Figures", comic: "Comics", book: "Books & Manga", movie: "Movies" };
  var NO_SCAN = { comic: true };
  // Printed books/manga carry a real ISBN-13 barcode on the back cover —
  // scanning it goes straight through the ISBN lookup (see onScanSuccess),
  // and it's also offered as a typed search since not every copy scans
  // cleanly. Trade-paperback comics have one too, so Comics gets it as well.
  var SHOW_ISBN = { comic: true, book: true };
  // Categories with a title-search API wired up in the Worker (worker/src/index.js).
  var SEARCH_KIND = { movie: "movie", game: "game", comic: "comic" };
  var STATUS_KEYS = ["have", "want", "read"];
  // Categories tracked as a collection with Have/Want/Read shelves and a
  // series-grouped grid, rather than a flat one-tile-per-item list.
  var WITH_SHELVES = { comic: true, book: true };
  // Lets an existing item be reassigned between the two shelved categories
  // from its overlay — there's no stored signal distinguishing an old manga
  // entry from a western comic, so moving one over is a manual action.
  var SHELF_SWAP = { comic: "book", book: "comic" };

  var state = {
    category: "game",
    items: loadItems(),
    pendingMatch: null, // the item waiting in the confirm panel
    pendingStatus: null, // {have, want, read} being edited in the confirm panel
    pendingSubKind: null, // "book" or "manga" being edited in the confirm panel
    seriesOverlaySeries: null, // the series currently open in the drill-down overlay
    comicStatusFilter: "have", // which shelf (Have/Want/Read) is showing, for any WITH_SHELVES category
    collectionSearch: "", // filters the currently-displayed grid, lowercased
    editingId: null // set while the manual form is editing an already-saved item, see editItemBtn
  };

  // Tracks Firestore writes still in flight: id -> "add" or "delete".
  // addItem/delete update state.items and render immediately, then kick off
  // the Firestore write asynchronously — a sync snapshot that lands before
  // that write is reflected in it would otherwise silently wipe a just-added
  // item (or resurrect a just-deleted one). See reconcileWithPending.
  var pendingWrites = {};

  var el = {};

  document.addEventListener("DOMContentLoaded", init);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  function init() {
    cacheEls();
    bindEvents();
    renderTabs();
    renderGrid();
    initSync();
  }

  // ---------- sync (Firebase, see sync.js) ----------

  function initSync() {
    if (window.ShelfSync) {
      attachSync(window.ShelfSync);
    } else {
      window.addEventListener("shelfsync:loaded", function () {
        attachSync(window.ShelfSync);
      });
    }
    window.addEventListener("shelfsync:error", function () {
      setSyncStatus("sync error — working offline");
    });
  }

  function attachSync(sync) {
    setSyncStatus("connecting...");
    sync.authReady
      .then(function () {
        sync.subscribe(function (remoteItems) {
          setSyncStatus("synced");
          state.items = reconcileWithPending(remoteItems);
          saveItems(); // keep the local cache warm for instant load next time
          renderGrid();
        });
      })
      .catch(function () {
        setSyncStatus("sync error — working offline");
      });
  }

  // A snapshot is the server's view as of whenever it was fetched — it won't
  // yet include a write still in flight from this same session. Keep any
  // item whose add hasn't confirmed yet (it isn't in `remoteItems` because
  // the write hasn't landed, not because it was deleted elsewhere), and drop
  // any item whose delete hasn't confirmed yet (it's still in `remoteItems`
  // only because the delete hasn't landed).
  function reconcileWithPending(remoteItems) {
    var byId = {};
    remoteItems.forEach(function (it) { byId[it.id] = it; });

    Object.keys(pendingWrites).forEach(function (id) {
      if (pendingWrites[id] === "add" && !byId[id]) {
        var local = findItemById(id);
        if (local) byId[id] = local;
      } else if (pendingWrites[id] === "delete") {
        delete byId[id];
      }
    });

    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function setSyncStatus(text) {
    if (el.syncStatus) el.syncStatus.textContent = text;
  }

  function cacheEls() {
    el.tabs = document.getElementById("categoryTabs");
    el.scanBtn = document.getElementById("scanBtn");
    el.typeBtn = document.getElementById("typeBtn");
    el.isbnBtn = document.getElementById("isbnBtn");
    el.scanHint = document.querySelector(".scan-hint");
    el.scanInput = document.getElementById("scanInput");
    el.scanPreviewWrap = document.getElementById("scanPreviewWrap");
    el.scanPreview = document.getElementById("scanPreview");
    el.searchForm = document.getElementById("searchForm");
    el.searchTitleInput = document.getElementById("searchTitleInput");
    el.cancelSearchBtn = document.getElementById("cancelSearchBtn");
    el.searchToManualBtn = document.getElementById("searchToManualBtn");
    el.searchResults = document.getElementById("searchResults");
    el.isbnForm = document.getElementById("isbnForm");
    el.isbnInput = document.getElementById("isbnInput");
    el.cancelIsbnBtn = document.getElementById("cancelIsbnBtn");
    el.isbnToManualBtn = document.getElementById("isbnToManualBtn");
    el.manualForm = document.getElementById("manualForm");
    el.titleInput = document.getElementById("titleInput");
    el.imageInput = document.getElementById("imageInput");
    el.notesInput = document.getElementById("notesInput");
    el.manualDuplicateWarning = document.getElementById("manualDuplicateWarning");
    el.manualSubKindRow = document.getElementById("manualSubKindRow");
    el.manualSubmitBtn = document.getElementById("manualSubmitBtn");
    el.cancelManualBtn = document.getElementById("cancelManualBtn");
    el.confirmPanel = document.getElementById("confirmPanel");
    el.confirmImage = document.getElementById("confirmImage");
    el.confirmTitle = document.getElementById("confirmTitle");
    el.confirmMeta = document.getElementById("confirmMeta");
    el.confirmDuplicateWarning = document.getElementById("confirmDuplicateWarning");
    el.confirmSubKindRow = document.getElementById("confirmSubKindRow");
    el.confirmStatusRow = document.getElementById("confirmStatusRow");
    el.confirmAddBtn = document.getElementById("confirmAddBtn");
    el.confirmEditBtn = document.getElementById("confirmEditBtn");
    el.confirmCancelBtn = document.getElementById("confirmCancelBtn");
    el.statusMsg = document.getElementById("statusMsg");
    el.collectionTitle = document.getElementById("collectionTitle");
    el.comicStatusTabs = document.getElementById("comicStatusTabs");
    el.collectionSearchInput = document.getElementById("collectionSearchInput");
    el.grid = document.getElementById("grid");
    el.emptyMsg = document.getElementById("emptyMsg");
    el.noMatchMsg = document.getElementById("noMatchMsg");
    el.itemOverlay = document.getElementById("itemOverlay");
    el.itemImage = document.getElementById("itemImage");
    el.itemTitle = document.getElementById("itemTitle");
    el.itemMeta = document.getElementById("itemMeta");
    el.itemStatusRow = document.getElementById("itemStatusRow");
    el.itemNotes = document.getElementById("itemNotes");
    el.deleteItemBtn = document.getElementById("deleteItemBtn");
    el.editItemBtn = document.getElementById("editItemBtn");
    el.moveItemBtn = document.getElementById("moveItemBtn");
    el.closeItemBtn = document.getElementById("closeItemBtn");
    el.seriesOverlay = document.getElementById("seriesOverlay");
    el.seriesOverlayTitle = document.getElementById("seriesOverlayTitle");
    el.seriesOverlayGrid = document.getElementById("seriesOverlayGrid");
    el.closeSeriesBtn = document.getElementById("closeSeriesBtn");
    el.attribution = document.getElementById("attribution");
    el.syncStatus = document.getElementById("syncStatus");
  }

  function bindEvents() {
    el.tabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".cat-tab");
      if (!btn) return;
      setCategory(btn.dataset.cat);
    });

    el.scanBtn.addEventListener("click", startScan);
    el.scanInput.addEventListener("change", onPhotoSelected);

    el.typeBtn.addEventListener("click", function () {
      if (SEARCH_KIND[state.category]) {
        showSearchForm();
      } else {
        showManualForm();
        if (state.category === "book") renderSubKindRow(el.manualSubKindRow, "book");
      }
    });
    el.cancelSearchBtn.addEventListener("click", hideSearchForm);
    el.searchToManualBtn.addEventListener("click", function () {
      var typed = el.searchTitleInput.value.trim();
      hideSearchForm();
      showManualForm();
      el.titleInput.value = typed;
    });
    el.searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = el.searchTitleInput.value.trim();
      if (!title) return;
      runSearch(title);
    });

    el.isbnBtn.addEventListener("click", showIsbnForm);
    el.cancelIsbnBtn.addEventListener("click", hideIsbnForm);
    el.isbnToManualBtn.addEventListener("click", function () {
      var typed = el.isbnInput.value.trim();
      hideIsbnForm();
      showManualForm();
      el.notesInput.value = typed ? "ISBN " + typed : "";
      if (state.category === "book") renderSubKindRow(el.manualSubKindRow, "book");
    });
    el.isbnForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var isbn = el.isbnInput.value.trim();
      if (!isbn) return;
      runIsbnSearch(isbn);
    });

    el.titleInput.addEventListener("input", function () {
      var dup = findDuplicate(state.category, el.titleInput.value, "", state.editingId);
      el.manualDuplicateWarning.classList.toggle("hidden", !dup);
    });
    bindSubKindRow(el.manualSubKindRow);
    el.cancelManualBtn.addEventListener("click", hideManualForm);
    el.manualForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = el.titleInput.value.trim();
      if (!title) return;
      var subKind = state.category === "book" ? getActiveSubKind(el.manualSubKindRow) : undefined;

      if (state.editingId) {
        updateItem(state.editingId, title, el.imageInput.value.trim(), el.notesInput.value.trim(), subKind);
      } else {
        addItem({
          category: state.category,
          title: title,
          seriesName: title,
          image: el.imageInput.value.trim(),
          notes: el.notesInput.value.trim(),
          subKind: subKind,
          source: "manual"
        });
      }
      hideManualForm();
    });

    bindStatusRow(el.confirmStatusRow, function () { return state.pendingStatus; });
    bindSubKindRow(el.confirmSubKindRow, function (value) { state.pendingSubKind = value; });

    el.confirmAddBtn.addEventListener("click", function () {
      if (!state.pendingMatch) return;
      var data = Object.assign({}, state.pendingMatch, { status: state.pendingStatus });
      if (state.pendingMatch.category === "book") data.subKind = state.pendingSubKind;
      addItem(data);
      hideConfirmPanel();
    });
    el.confirmEditBtn.addEventListener("click", function () {
      if (!state.pendingMatch) return;
      var subKind = state.pendingMatch.category === "book" ? (state.pendingSubKind || "book") : "book";
      el.titleInput.value = state.pendingMatch.title || "";
      el.imageInput.value = state.pendingMatch.image || "";
      el.notesInput.value = state.pendingMatch.notes || "";
      hideConfirmPanel();
      showManualForm();
      renderSubKindRow(el.manualSubKindRow, subKind);
    });
    el.confirmCancelBtn.addEventListener("click", hideConfirmPanel);

    bindStatusRow(el.itemStatusRow, function () {
      var item = findItemById(el.itemOverlay.dataset.id);
      return item && item.status;
    }, function () {
      var item = findItemById(el.itemOverlay.dataset.id);
      if (!item) return;
      saveItems();
      renderGrid();
      if (window.ShelfSync) window.ShelfSync.setItem(item).catch(function () {});
    });

    el.closeItemBtn.addEventListener("click", hideItemOverlay);
    el.editItemBtn.addEventListener("click", function () {
      var item = findItemById(el.itemOverlay.dataset.id);
      if (!item) return;
      state.editingId = item.id;
      el.titleInput.value = item.title || "";
      el.imageInput.value = item.image || "";
      el.notesInput.value = item.notes || "";
      el.manualSubmitBtn.textContent = "Save Changes";
      hideItemOverlay();
      showManualForm();
      if (item.category === "book") renderSubKindRow(el.manualSubKindRow, item.subKind || "book");
    });
    el.moveItemBtn.addEventListener("click", function () {
      var item = findItemById(el.itemOverlay.dataset.id);
      var swapTo = item && SHELF_SWAP[item.category];
      if (!swapTo) return;
      item.category = swapTo;
      if (swapTo === "book") {
        // The whole point of this button is relocating old manga entries
        // that were miscategorized as comics before Books & Manga split off.
        if (!item.subKind) item.subKind = "manga";
        if (typeof item.sortIndex !== "number") item.sortIndex = nextSortIndex("book", item.subKind);
      }
      saveItems();
      hideItemOverlay();
      renderGrid();
      if (window.ShelfSync) window.ShelfSync.setItem(item).catch(function () {});
    });
    el.deleteItemBtn.addEventListener("click", function () {
      var id = el.itemOverlay.dataset.id;
      state.items = state.items.filter(function (it) { return it.id !== id; });
      saveItems();
      hideItemOverlay();
      renderGrid();

      if (window.ShelfSync) {
        // On failure the delete never happened, so stop suppressing it —
        // otherwise the next sync snapshot (which still has it) would get
        // reconciled as if it were mid-deletion and hide it forever.
        pendingWrites[id] = "delete";
        window.ShelfSync.deleteItem(id)
          .then(function () { delete pendingWrites[id]; })
          .catch(function () { delete pendingWrites[id]; });
      }
    });

    el.closeSeriesBtn.addEventListener("click", hideSeriesOverlay);

    el.comicStatusTabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".status-tab");
      if (!btn) return;
      state.comicStatusFilter = btn.dataset.status;
      Array.prototype.forEach.call(el.comicStatusTabs.children, function (tab) {
        tab.classList.toggle("active", tab === btn);
      });
      renderGrid();
    });

    el.collectionSearchInput.addEventListener("input", function () {
      state.collectionSearch = el.collectionSearchInput.value.trim().toLowerCase();
      renderGrid();
    });
  }

  // A status row is used in two places (the confirm panel, before an item
  // exists, and the item overlay, after) with the same chip-toggle behavior;
  // getStatus/onChange let each caller supply its own backing object.
  function bindStatusRow(row, getStatus, onChange) {
    row.addEventListener("click", function (e) {
      var chip = e.target.closest(".status-chip");
      if (!chip) return;
      var status = getStatus();
      if (!status) return;
      var key = chip.dataset.status;
      status[key] = !status[key];
      renderStatusRow(row, status);
      if (onChange) onChange();
    });
  }

  function renderStatusRow(row, status) {
    Array.prototype.forEach.call(row.children, function (chip) {
      chip.classList.toggle("active", !!(status && status[chip.dataset.status]));
    });
  }

  function defaultStatus() {
    return { have: true, want: false, read: false };
  }

  // Book vs. manga is a single-select toggle (unlike the multi-select status
  // row above) — used in both the confirm panel and the manual form so Books
  // & Manga's shelf can separate the two. renderSubKindRow sets which chip is
  // active; bindSubKindRow wires the click.
  function renderSubKindRow(row, value) {
    Array.prototype.forEach.call(row.children, function (chip) {
      chip.classList.toggle("active", chip.dataset.subkind === value);
    });
  }

  function bindSubKindRow(row, onChange) {
    row.addEventListener("click", function (e) {
      var chip = e.target.closest(".subkind-chip");
      if (!chip) return;
      renderSubKindRow(row, chip.dataset.subkind);
      if (onChange) onChange(chip.dataset.subkind);
    });
  }

  function getActiveSubKind(row) {
    var active = row.querySelector(".subkind-chip.active");
    return active ? active.dataset.subkind : "book";
  }

  // ---------- categories ----------

  function renderTabs() {
    Array.prototype.forEach.call(el.tabs.children, function (btn) {
      btn.classList.toggle("active", btn.dataset.cat === state.category);
    });
    // RAWG's free tier requires a visible backlink wherever its data is shown.
    el.attribution.classList.toggle("hidden", state.category !== "game");
    el.scanBtn.classList.toggle("hidden", !!NO_SCAN[state.category]);
    el.scanHint.classList.toggle("hidden", !!NO_SCAN[state.category]);
    el.isbnBtn.classList.toggle("hidden", !SHOW_ISBN[state.category]);
  }

  function setCategory(cat) {
    if (CATEGORIES.indexOf(cat) === -1) return;
    state.category = cat;
    state.collectionSearch = "";
    el.collectionSearchInput.value = "";
    renderTabs();
    renderGrid();
    hideManualForm();
    hideSearchForm();
    hideIsbnForm();
    hideConfirmPanel();
  }

  // ---------- storage ----------

  function loadItems() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var items = raw ? JSON.parse(raw) : [];
      // Manga used to be its own category, then got folded into comics; it
      // now lives in Books instead. Nothing about a saved item records
      // whether it's manga or a western comic, so this can't be done
      // automatically — existing comic entries stay put, and the item
      // overlay's "Move to Books & Manga" / "Move to Comics" button lets
      // you reassign the manga ones by hand.
      items.forEach(function (it) {
        if (it.category === "manga") it.category = "comic";
      });
      return items;
    } catch (e) {
      return [];
    }
  }

  function saveItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    } catch (e) {
      setStatus("Could not save — storage may be full or blocked.");
    }
  }

  function findItemById(id) {
    return state.items.filter(function (it) { return it.id === id; })[0];
  }

  // A likely duplicate: same category and either a matching barcode/ISBN (the
  // strongest signal, when both have one) or the same title, case- and
  // whitespace-insensitive. Checked on title rather than seriesName so two
  // different issues/volumes of the same series don't flag each other.
  // excludeId lets the item being edited skip matching against itself.
  function findDuplicate(category, title, upc, excludeId) {
    var t = (title || "").trim().toLowerCase();
    if (!t) return null;
    return state.items.filter(function (it) {
      if (it.id === excludeId) return false;
      if (it.category !== category) return false;
      if (upc && it.upc && it.upc === upc) return true;
      return (it.title || "").trim().toLowerCase() === t;
    })[0] || null;
  }

  function addItem(data) {
    var category = data.category || state.category;
    var item = {
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      category: category,
      title: data.title || "Untitled",
      image: data.image || "",
      upc: data.upc || "",
      notes: data.notes || "",
      source: data.source || "manual",
      addedAt: new Date().toISOString()
    };
    if (WITH_SHELVES[category]) {
      item.seriesName = data.seriesName || data.title || "Untitled";
      item.status = data.status || defaultStatus();
    }
    if (category === "book") {
      item.subKind = data.subKind || "book";
      item.sortIndex = nextSortIndex(category, item.subKind);
    }
    state.items.push(item);
    saveItems();
    renderGrid();
    setStatus("Added to your collection.");

    if (window.ShelfSync) {
      // Stays marked "add"-pending (not cleared) on failure: with no copy of
      // this item in Firestore yet, clearing it here would let the very next
      // sync snapshot wipe it right back out, contradicting the status
      // message below.
      pendingWrites[item.id] = "add";
      window.ShelfSync.setItem(item)
        .then(function () { delete pendingWrites[item.id]; })
        .catch(function () {
          setStatus("Added locally, but sync failed — will stay on this device for now.");
        });
    }
  }

  // Shelf position within a (category, subKind) group — new items go to the
  // end, and reorderShelfItem (see the shelf renderer) reassigns these when
  // the user drags something to a new spot.
  function nextSortIndex(category, subKind) {
    var max = -1;
    state.items.forEach(function (it) {
      if (it.category === category && (it.subKind || "book") === subKind && typeof it.sortIndex === "number") {
        if (it.sortIndex > max) max = it.sortIndex;
      }
    });
    return max + 1;
  }

  // Edits an already-saved item's title/image/notes in place (see
  // editItemBtn) — addItem is only ever for something not yet in the
  // collection, this is for fixing up something that already is.
  function updateItem(id, title, image, notes, subKind) {
    var item = findItemById(id);
    if (!item) return;
    item.title = title;
    item.image = image;
    item.notes = notes;
    if (subKind) item.subKind = subKind;
    saveItems();
    renderGrid();
    setStatus("Updated.");

    if (window.ShelfSync) {
      // Same protection an add gets: don't let a stale snapshot undo this
      // edit before the write confirms.
      pendingWrites[item.id] = "add";
      window.ShelfSync.setItem(item)
        .then(function () { delete pendingWrites[item.id]; })
        .catch(function () {
          setStatus("Updated locally, but sync failed — will stay on this device for now.");
        });
    }
  }

  // ---------- grid ----------

  function renderGrid() {
    el.collectionTitle.textContent = CATEGORY_LABELS[state.category];
    var withShelves = WITH_SHELVES[state.category];
    el.comicStatusTabs.classList.toggle("hidden", !withShelves);

    var items = state.items.filter(function (it) { return it.category === state.category; });

    // Comics/Books & Manga: which shelf (Have/Want/Read) is showing. An item
    // can be on more than one shelf at once (e.g. Have + Read), so this
    // isn't an exclusive filter so much as "which of the three lists to
    // look at."
    if (withShelves) {
      items = items.filter(function (it) { return it.status && it.status[state.comicStatusFilter]; });
    }

    var search = state.collectionSearch;
    if (search) {
      items = items.filter(function (it) {
        return (it.seriesName || it.title || "").toLowerCase().indexOf(search) !== -1;
      });
    }

    el.grid.innerHTML = "";
    el.grid.className = state.category === "book" ? "shelf-grid" : "grid";
    var empty = items.length === 0;
    el.emptyMsg.classList.toggle("hidden", !(empty && !search));
    el.noMatchMsg.classList.toggle("hidden", !(empty && search));

    if (state.category === "book") {
      renderBookShelf(el.grid, items);
    } else if (withShelves) {
      renderSeriesGroupedGrid(el.grid, items);
    } else {
      renderFlatGrid(el.grid, items, showItemOverlay);
    }
  }

  function renderFlatGrid(container, items, onClick) {
    items.slice().reverse().forEach(function (item) {
      container.appendChild(buildGridTile(item.image, item.title, statusDotsHtml(item), function () {
        onClick(item);
      }));
    });
  }

  // Comics/manga: one tile per series (grouping by seriesName, falling back
  // to the item's own title for manually-entered items with no series of
  // their own), with a count badge — not a flat dump of every issue, which
  // is unreadable once a series has more than a couple of owned issues.
  function renderSeriesGroupedGrid(container, items) {
    var bySeries = {};
    var order = [];
    items.forEach(function (item) {
      var key = item.seriesName || item.title;
      if (!bySeries[key]) {
        bySeries[key] = [];
        order.push(key);
      }
      bySeries[key].push(item);
    });

    order.forEach(function (seriesName) {
      var group = bySeries[seriesName];
      var cover = group[group.length - 1];
      var badge = group.length > 1 ? '<span class="badge">' + group.length + "</span>" : "";
      container.appendChild(buildGridTile(cover.image, seriesName, badge, function () {
        showSeriesOverlay(seriesName, group);
      }));
    });
  }

  // Books & Manga: a packed shelf instead of a grid. Books and manga are
  // split into their own sections (item.subKind, see the add/edit forms'
  // Book/Manga toggle) and shown flat, one tile per item — unlike comics,
  // there's rarely more than a copy or two of the same book, so there's no
  // need to collapse into series tiles. Order within a section is a plain
  // user-set sequence (item.sortIndex), draggable via bindShelfDrag.
  var SHELF_ITEM_WIDTH = 92; // keep in sync with .shelf-item's width in style.css

  function renderBookShelf(container, items) {
    var sections = [
      { key: "book", label: "Books", items: [] },
      { key: "manga", label: "Manga", items: [] }
    ];
    items.forEach(function (it) {
      var key = it.subKind === "manga" ? "manga" : "book";
      sections[key === "manga" ? 1 : 0].items.push(it);
    });

    var containerWidth = container.clientWidth || 320;
    var perRow = Math.max(1, Math.floor(containerWidth / SHELF_ITEM_WIDTH));

    sections.forEach(function (section) {
      if (!section.items.length) return;

      section.items.sort(function (a, b) {
        var ai = typeof a.sortIndex === "number" ? a.sortIndex : 0;
        var bi = typeof b.sortIndex === "number" ? b.sortIndex : 0;
        return ai - bi;
      });

      var sectionEl = document.createElement("div");
      sectionEl.className = "shelf-section";

      var label = document.createElement("div");
      label.className = "shelf-section-label";
      label.textContent = section.label;
      sectionEl.appendChild(label);

      for (var i = 0; i < section.items.length; i += perRow) {
        var row = document.createElement("div");
        row.className = "shelf-row";
        section.items.slice(i, i + perRow).forEach(function (item) {
          row.appendChild(buildShelfTile(item, section.key));
        });
        sectionEl.appendChild(row);
      }

      container.appendChild(sectionEl);
    });
  }

  function buildShelfTile(item, groupKey) {
    var tile = document.createElement("div");
    tile.className = "shelf-item";
    tile.dataset.id = item.id;
    tile.dataset.group = groupKey;
    tile.innerHTML =
      '<div class="shelf-cover"><img src="' + (item.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
      statusDotsHtml(item) +
      "</div>" +
      '<div class="shelf-plank"></div>';
    tile.addEventListener("click", function () {
      // Suppress the click a drag leaves behind — see bindShelfDrag.
      if (tile.dataset.dragged === "1") {
        tile.dataset.dragged = "";
        return;
      }
      showItemOverlay(item);
    });
    bindShelfDrag(tile, item, groupKey);
    return tile;
  }

  // Press-and-hold (not a plain tap, which should still open the item) to
  // pick up a shelf tile, drag it over another tile in the same section, and
  // drop it there. Uses Pointer Events so it works with touch, not just a
  // mouse — HTML5 drag-and-drop doesn't fire on phones, and this is a
  // phone-first app.
  function bindShelfDrag(tile, item, groupKey) {
    var HOLD_MS = 350;
    var MOVE_THRESHOLD = 8;
    var pointerId = null;
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var holdTimer = null;
    var ghost = null;
    var dropTargetId = null;
    var dropBefore = true;

    function moveGhost(x, y) {
      if (!ghost) return;
      ghost.style.left = (x - ghost.offsetWidth / 2) + "px";
      ghost.style.top = (y - 40) + "px";
    }

    function startDrag(x, y) {
      dragging = true;
      tile.dataset.dragged = "1";
      tile.classList.add("dragging");
      var rect = tile.getBoundingClientRect();
      ghost = tile.cloneNode(true);
      ghost.className = "shelf-item shelf-drag-ghost";
      ghost.style.width = rect.width + "px";
      document.body.appendChild(ghost);
      moveGhost(x, y);
      try { tile.setPointerCapture(pointerId); } catch (err) {}
    }

    function updateDropTarget(x, y) {
      if (ghost) ghost.style.display = "none";
      var under = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = "";
      var target = under && under.closest(".shelf-item");
      if (!target || target.dataset.group !== groupKey || target === tile) {
        dropTargetId = null;
        return;
      }
      var rect = target.getBoundingClientRect();
      dropBefore = x < rect.left + rect.width / 2;
      dropTargetId = target.dataset.id;
    }

    function endDrag() {
      clearTimeout(holdTimer);
      if (dragging) {
        if (dropTargetId) reorderShelfItem(item, dropTargetId, dropBefore, groupKey);
        if (ghost) { ghost.remove(); ghost = null; }
        tile.classList.remove("dragging");
      }
      dragging = false;
      pointerId = null;
    }

    tile.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      holdTimer = setTimeout(function () { startDrag(e.clientX, e.clientY); }, HOLD_MS);
    });

    tile.addEventListener("pointermove", function (e) {
      if (e.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD) {
          clearTimeout(holdTimer);
        }
        return;
      }
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
      updateDropTarget(e.clientX, e.clientY);
    });

    tile.addEventListener("pointerup", endDrag);
    tile.addEventListener("pointercancel", endDrag);
  }

  // Splices movedItem next to the dropped-on item within their shared
  // (category=book, subKind) group, then renumbers sortIndex for the whole
  // group so order is unambiguous — simpler and more robust than trying to
  // patch individual values.
  function reorderShelfItem(movedItem, targetId, before, groupKey) {
    var group = state.items
      .filter(function (it) { return it.category === "book" && (it.subKind || "book") === groupKey; })
      .sort(function (a, b) { return (a.sortIndex || 0) - (b.sortIndex || 0); })
      .filter(function (it) { return it.id !== movedItem.id; });

    var targetIndex = -1;
    group.forEach(function (it, i) { if (it.id === targetId) targetIndex = i; });
    if (targetIndex === -1) return;

    group.splice(before ? targetIndex : targetIndex + 1, 0, movedItem);
    group.forEach(function (it, i) { it.sortIndex = i; });

    saveItems();
    renderGrid();

    if (window.ShelfSync) {
      group.forEach(function (it) { window.ShelfSync.setItem(it).catch(function () {}); });
    }
  }

  function buildGridTile(image, label, overlayHtml, onClick) {
    var card = document.createElement("button");
    card.className = "grid-item";
    card.innerHTML =
      '<img src="' + (image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
      (overlayHtml || "") +
      '<div class="label">' + escapeHtml(label) + "</div>";
    card.addEventListener("click", onClick);
    return card;
  }

  function statusDotsHtml(item) {
    if (!item.status) return "";
    var dots = STATUS_KEYS.filter(function (k) { return item.status[k]; })
      .map(function (k) { return '<span class="' + k + '"></span>'; })
      .join("");
    return dots ? '<div class="status-dot">' + dots + "</div>" : "";
  }

  function showSeriesOverlay(seriesName, items) {
    state.seriesOverlaySeries = seriesName;
    el.seriesOverlayTitle.textContent = seriesName;
    el.seriesOverlayGrid.innerHTML = "";
    renderFlatGrid(el.seriesOverlayGrid, items, function (item) {
      hideSeriesOverlay();
      showItemOverlay(item);
    });
    el.seriesOverlay.classList.remove("hidden");
  }

  function hideSeriesOverlay() {
    el.seriesOverlay.classList.add("hidden");
  }

  function showItemOverlay(item) {
    el.itemOverlay.dataset.id = item.id;
    el.itemImage.src = item.image || "";
    el.itemTitle.textContent = item.title;
    el.itemMeta.textContent = CATEGORY_LABELS[item.category] + (item.upc ? " · " + item.upc : "");
    el.itemNotes.textContent = item.notes || "";
    el.itemStatusRow.classList.toggle("hidden", !WITH_SHELVES[item.category]);
    if (WITH_SHELVES[item.category]) renderStatusRow(el.itemStatusRow, item.status);

    var swapTo = SHELF_SWAP[item.category];
    el.moveItemBtn.classList.toggle("hidden", !swapTo);
    if (swapTo) el.moveItemBtn.textContent = "Move to " + CATEGORY_LABELS[swapTo];

    el.itemOverlay.classList.remove("hidden");
  }

  function hideItemOverlay() {
    el.itemOverlay.classList.add("hidden");
    renderGrid();
  }

  // ---------- manual entry ----------

  function showManualForm() {
    hideConfirmPanel();
    hideSearchForm();
    hideIsbnForm();
    el.manualForm.classList.remove("hidden");
    el.manualSubKindRow.classList.toggle("hidden", state.category !== "book");
    el.titleInput.focus();
  }

  function hideManualForm() {
    el.manualForm.classList.add("hidden");
    el.manualForm.reset();
    el.manualDuplicateWarning.classList.add("hidden");
    el.manualSubmitBtn.textContent = "Add to Collection";
    state.editingId = null;
  }

  // ---------- title search ----------

  function showSearchForm() {
    hideManualForm();
    hideIsbnForm();
    hideConfirmPanel();
    el.searchForm.classList.remove("hidden");
    el.searchTitleInput.focus();
  }

  function hideSearchForm() {
    el.searchForm.classList.add("hidden");
    el.searchForm.reset();
    el.searchResults.classList.add("hidden");
    el.searchResults.innerHTML = "";
  }

  function runSearch(title) {
    var kind = SEARCH_KIND[state.category];
    if (!kind) return;
    runSearchUrl(
      LOOKUP_PROXY_URL + "/search?kind=" + kind + "&title=" + encodeURIComponent(title),
      "No matches for \"" + title + "\" — try a different search or add it manually."
    );
  }

  // ---------- ISBN search ----------
  //
  // Separate from the title search above: printed manga/graphic-novel
  // volumes carry a real ISBN-13 barcode on the back cover, which neither
  // ComicVine nor Jikan search by. Resolved via Google Books instead.

  function showIsbnForm() {
    hideManualForm();
    hideSearchForm();
    hideConfirmPanel();
    el.isbnForm.classList.remove("hidden");
    el.isbnInput.focus();
  }

  function hideIsbnForm() {
    el.isbnForm.classList.add("hidden");
    el.isbnForm.reset();
    el.searchResults.classList.add("hidden");
    el.searchResults.innerHTML = "";
  }

  function runIsbnSearch(isbn) {
    runSearchUrl(
      LOOKUP_PROXY_URL + "/search?kind=isbn&isbn=" + encodeURIComponent(isbn),
      "No matches for ISBN " + isbn + " — try a different number or add it manually."
    );
  }

  // Drills into one comic series: picking a series from the general search
  // (see the worker's searchComicVine) doesn't add it directly, since a
  // series isn't a single item — it lists that series' issues to pick from.
  function runComicIssueSearch(volumeId, seriesLabel) {
    runSearchUrl(
      LOOKUP_PROXY_URL + "/search?kind=comic-issues&volumeId=" + encodeURIComponent(volumeId),
      "No issues found for " + seriesLabel + " — enter it manually instead."
    );
  }

  function runSearchUrl(url, emptyMessage) {
    setStatus("Searching...");

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setStatus(data.error + " — you can still add it manually.");
          renderSearchResults([]);
          return;
        }
        var items = data.items || [];
        setStatus(items.length ? "" : emptyMessage);
        renderSearchResults(items);
      })
      .catch(function () {
        setStatus("Search failed (offline?) — you can still add it manually.");
        renderSearchResults([]);
      });
  }

  function renderSearchResults(items) {
    el.searchResults.innerHTML = "";
    el.searchResults.classList.toggle("hidden", items.length === 0);

    items.forEach(function (item) {
      var btn = document.createElement("button");
      btn.className = "search-result";
      btn.innerHTML =
        '<img src="' + (item.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
        "<span>" + escapeHtml(item.title) + "</span>";
      btn.addEventListener("click", function () {
        if (item.volumeId) {
          runComicIssueSearch(item.volumeId, item.title);
          return;
        }
        hideSearchForm();
        showConfirmPanel({
          category: state.category,
          title: item.title,
          seriesName: item.seriesName || item.title,
          image: item.image || "",
          meta: item.meta || "",
          likelyManga: item.likelyManga,
          notes: "",
          source: SEARCH_KIND[state.category]
        });
      });
      el.searchResults.appendChild(btn);
    });
  }

  // ---------- confirm panel ----------

  function showConfirmPanel(match) {
    state.pendingMatch = match;
    state.pendingStatus = WITH_SHELVES[match.category] ? (match.status || defaultStatus()) : null;
    el.confirmImage.src = match.image || "";
    el.confirmTitle.textContent = match.title;
    el.confirmMeta.textContent = match.meta || match.upc || "";
    el.confirmStatusRow.classList.toggle("hidden", !WITH_SHELVES[match.category]);
    if (WITH_SHELVES[match.category]) renderStatusRow(el.confirmStatusRow, state.pendingStatus);

    var dup = findDuplicate(match.category, match.title, match.upc);
    el.confirmDuplicateWarning.classList.toggle("hidden", !dup);

    el.confirmSubKindRow.classList.toggle("hidden", match.category !== "book");
    if (match.category === "book") {
      state.pendingSubKind = match.subKind || (match.likelyManga ? "manga" : "book");
      renderSubKindRow(el.confirmSubKindRow, state.pendingSubKind);
    }

    el.confirmPanel.classList.remove("hidden");
  }

  function hideConfirmPanel() {
    state.pendingMatch = null;
    state.pendingStatus = null;
    el.confirmPanel.classList.add("hidden");
  }

  // ---------- scanning ----------
  //
  // Takes a single photo via the phone's native camera (capture="environment")
  // and decodes it client-side with ZXing, rather than running a live video
  // decode loop in-page. html5-qrcode's live loop hits an unresolved WebKit
  // bug on iOS Safari (camera preview renders, decode callback never fires —
  // see github.com/mebjas/html5-qrcode issues #915, #1036, #820, #484).
  // Decoding one still photo sidesteps that whole class of bug.

  function startScan() {
    hideManualForm();
    hideSearchForm();
    hideConfirmPanel();

    if (typeof ZXing === "undefined") {
      setStatus("Scanner library failed to load. Check your connection and reload.");
      return;
    }

    el.scanInput.value = ""; // let re-selecting the same photo re-fire change
    el.scanInput.click();
  }

  function onPhotoSelected() {
    var file = el.scanInput.files && el.scanInput.files[0];
    if (!file) return;

    var rawUrl = URL.createObjectURL(file);
    el.scanPreview.src = rawUrl;
    el.scanPreviewWrap.classList.remove("hidden");
    setStatus("Reading barcode...");

    // Phone photos can be 3000-4000px wide, which tends to hurt ZXing's
    // decode reliability more than help it. Downscale first, and use
    // TRY_HARDER since a single still photo gets one shot (no retry across
    // frames the way live video scanning would get).
    resizeImage(rawUrl, 1400)
      .then(function (resizedUrl) {
        var hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8,
          ZXing.BarcodeFormat.UPC_A,
          ZXing.BarcodeFormat.UPC_E,
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.QR_CODE
        ]);
        var reader = new ZXing.BrowserMultiFormatReader(hints);
        return reader.decodeFromImageUrl(resizedUrl).finally(function () {
          URL.revokeObjectURL(resizedUrl);
        });
      })
      .then(function (result) {
        onScanSuccess(result.getText());
      })
      .catch(function () {
        setStatus("Couldn't read a barcode in that photo — try zooming in closer, or enter the title instead.");
      })
      .finally(function () {
        el.scanPreviewWrap.classList.add("hidden");
        URL.revokeObjectURL(rawUrl);
      });
  }

  // Draws `url` onto a canvas scaled so its longest side is `maxSize`,
  // returning an object URL for the resized JPEG.
  function resizeImage(url, maxSize) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          function (blob) {
            if (blob) resolve(URL.createObjectURL(blob));
            else reject(new Error("resize failed"));
          },
          "image/jpeg",
          0.92
        );
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function onScanSuccess(decodedText) {
    setStatus("Found code " + decodedText + " — looking it up...");
    if (state.category === "book") {
      lookupIsbn(decodedText);
    } else {
      lookupUpc(decodedText);
    }
  }

  // ---------- lookup ----------

  function lookupUpc(upc) {
    var url = LOOKUP_PROXY_URL + "?upc=" + encodeURIComponent(upc);
    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var item = data && data.items && data.items[0];
        if (!item) {
          barcodeNotResolved(upc, "No match found for " + upc + ".", "UPC");
          return;
        }
        showConfirmPanel({
          category: state.category,
          title: item.title || "Untitled",
          image: (item.images && item.images[0]) || "",
          meta: item.brand || item.category || "",
          upc: upc,
          notes: "",
          source: "upcitemdb"
        });
        setStatus("");
      })
      .catch(function () {
        barcodeNotResolved(upc, "Lookup failed (offline or rate-limited).", "UPC");
      });
  }

  // Books carry their own ISBN-13 barcode, which UPCitemdb (a general retail
  // database, not a book one) resolves poorly — send a scanned book barcode
  // through the same Open Library lookup as the typed ISBN search instead
  // (see runIsbnSearch).
  function lookupIsbn(isbn) {
    var url = LOOKUP_PROXY_URL + "/search?kind=isbn&isbn=" + encodeURIComponent(isbn);
    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var item = data && data.items && data.items[0];
        if (!item) {
          barcodeNotResolved(isbn, "No match found for ISBN " + isbn + ".", "ISBN");
          return;
        }
        showConfirmPanel({
          category: state.category,
          title: item.title,
          seriesName: item.seriesName || item.title,
          image: item.image || "",
          meta: item.meta || "",
          likelyManga: item.likelyManga,
          upc: isbn,
          notes: "",
          source: "isbn"
        });
        setStatus("");
      })
      .catch(function () {
        barcodeNotResolved(isbn, "Lookup failed (offline or rate-limited).", "ISBN");
      });
  }

  // When the barcode can't be resolved: fall back to a title search for
  // categories that have one wired up, otherwise plain manual entry.
  function barcodeNotResolved(code, reason, codeLabel) {
    if (SEARCH_KIND[state.category]) {
      setStatus(reason + " Type the title to search instead.");
      showSearchForm();
    } else {
      setStatus(reason + " Enter it manually.");
      el.titleInput.value = "";
      el.imageInput.value = "";
      el.notesInput.value = codeLabel + " " + code;
      showManualForm();
      if (state.category === "book") renderSubKindRow(el.manualSubKindRow, "book");
    }
  }

  // ---------- helpers ----------

  function setStatus(msg) {
    el.statusMsg.textContent = msg || "";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
