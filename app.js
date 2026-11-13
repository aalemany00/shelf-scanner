(function () {
  "use strict";

  var STORAGE_KEY = "shelfScanner.items";
  var BOOK_SORT_KEY = "shelfScanner.bookSort"; // a view preference, not collection data
  // UPCitemdb blocks browser-side calls via CORS, so this Worker proxies the
  // lookup server-side. See worker/src/index.js.
  var LOOKUP_PROXY_URL = "https://shelf-scanner-upc.adrian-alemany2-ae1.workers.dev";

  // Manga lives in Books (combined with regular books), not Comics — a
  // single-issue comic has no ISBN and isn't a "book" the way a manga
  // volume or a trade paperback is. No barcode lookup applies to loose
  // comic issues either way, so that category hides the Scan button.
  var CATEGORIES = ["game", "figure", "comic", "book", "movie"];
  var CATEGORY_LABELS = { game: "Games", figure: "Figures", comic: "Comics", book: "Books & Manga", movie: "Movies" };
  var CATEGORY_JP = { game: "ゲーム", figure: "フィギュア", comic: "コミック", book: "漫画・書籍", movie: "映画・TV" };
  var CATEGORY_ICON = { game: "✣", figure: "♙", comic: "▤", book: "♧", movie: "▣" };
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
    editingId: null, // set while the manual form is editing an already-saved item, see editItemBtn
    bookSort: loadBookSort() // how the Books & Manga shelf is ordered — {method, direction}
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
    el.authorInput = document.getElementById("authorInput");
    el.imageInput = document.getElementById("imageInput");
    el.spineArtToggle = document.getElementById("spineArtToggle");
    el.spineArtPanel = document.getElementById("spineArtPanel");
    el.spineImageInput = document.getElementById("spineImageInput");
    el.spineCropPreviewWrap = document.getElementById("spineCropPreviewWrap");
    el.spineCropPreviewImg = document.getElementById("spineCropPreviewImg");
    el.spineCropMaskLeft = document.getElementById("spineCropMaskLeft");
    el.spineCropMaskRight = document.getElementById("spineCropMaskRight");
    el.spineCropControls = document.getElementById("spineCropControls");
    el.spineCropStartInput = document.getElementById("spineCropStartInput");
    el.spineCropEndInput = document.getElementById("spineCropEndInput");
    el.spineCropStartNumber = document.getElementById("spineCropStartNumber");
    el.spineCropEndNumber = document.getElementById("spineCropEndNumber");
    el.spineLivePreviewRow = document.getElementById("spineLivePreviewRow");
    el.spineLivePreview = document.getElementById("spineLivePreview");
    el.spineArtClearBtn = document.getElementById("spineArtClearBtn");
    el.spineUploadInput = document.getElementById("spineUploadInput");
    el.spineUploadStatus = document.getElementById("spineUploadStatus");
    el.coverUploadToggle = document.getElementById("coverUploadToggle");
    el.coverCropPanel = document.getElementById("coverCropPanel");
    el.coverUploadInput = document.getElementById("coverUploadInput");
    el.coverUploadStatus = document.getElementById("coverUploadStatus");
    el.coverCropPreviewWrap = document.getElementById("coverCropPreviewWrap");
    el.coverCropPreviewImg = document.getElementById("coverCropPreviewImg");
    el.coverCropMaskLeft = document.getElementById("coverCropMaskLeft");
    el.coverCropMaskRight = document.getElementById("coverCropMaskRight");
    el.coverCropControls = document.getElementById("coverCropControls");
    el.coverCropStartInput = document.getElementById("coverCropStartInput");
    el.coverCropEndInput = document.getElementById("coverCropEndInput");
    el.coverCropStartNumber = document.getElementById("coverCropStartNumber");
    el.coverCropEndNumber = document.getElementById("coverCropEndNumber");
    el.coverLivePreviewRow = document.getElementById("coverLivePreviewRow");
    el.coverLivePreview = document.getElementById("coverLivePreview");
    el.coverCropApplyBtn = document.getElementById("coverCropApplyBtn");
    el.coverCropCancelBtn = document.getElementById("coverCropCancelBtn");
    el.coverBgRemoveHint = document.getElementById("coverBgRemoveHint");
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
    el.collectionTitleJp = document.getElementById("collectionTitleJp");
    el.deptIcon = document.getElementById("deptIcon");
    el.comicStatusTabs = document.getElementById("comicStatusTabs");
    el.bookSortRow = document.getElementById("bookSortRow");
    el.bookSortMethod = document.getElementById("bookSortMethod");
    el.bookSortDirectionBtn = document.getElementById("bookSortDirectionBtn");
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
    bindSpineArtPanel();
    bindCoverCropPanel();
    el.cancelManualBtn.addEventListener("click", hideManualForm);
    el.manualForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = el.titleInput.value.trim();
      if (!title) return;
      var subKind = state.category === "book" ? getActiveSubKind(el.manualSubKindRow) : undefined;
      var author = state.category === "book" ? el.authorInput.value.trim() : "";

      var spineArt = readSpineArtFromForm();

      if (state.editingId) {
        updateItem(state.editingId, title, el.imageInput.value.trim(), el.notesInput.value.trim(), subKind, author, spineArt);
      } else {
        addItem(Object.assign({
          category: state.category,
          title: title,
          seriesName: title,
          author: author,
          image: el.imageInput.value.trim(),
          notes: el.notesInput.value.trim(),
          subKind: subKind,
          source: "manual"
        }, spineArt || {}));
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
      el.authorInput.value = state.pendingMatch.author || "";
      populateSpineArtPanel(state.pendingMatch);
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
      el.authorInput.value = item.author || "";
      populateSpineArtPanel(item);
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

    el.bookSortMethod.addEventListener("change", function () {
      state.bookSort.method = el.bookSortMethod.value;
      saveBookSort();
      renderGrid();
    });
    el.bookSortDirectionBtn.addEventListener("click", function () {
      state.bookSort.direction = state.bookSort.direction === "desc" ? "asc" : "desc";
      saveBookSort();
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

  // How the Books & Manga shelf is sorted is a per-device view preference,
  // not collection data — kept out of state.items/Firestore on purpose.
  function loadBookSort() {
    try {
      var parsed = JSON.parse(localStorage.getItem(BOOK_SORT_KEY));
      if (parsed && parsed.method && parsed.direction) return parsed;
    } catch (e) {}
    return { method: "custom", direction: "asc" };
  }

  function saveBookSort() {
    try {
      localStorage.setItem(BOOK_SORT_KEY, JSON.stringify(state.bookSort));
    } catch (e) {}
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
      author: data.author || "",
      image: data.image || "",
      upc: data.upc || "",
      notes: data.notes || "",
      source: data.source || "manual",
      addedAt: new Date().toISOString()
    };
    if (data.spineImage && typeof data.spineCropStart === "number" && typeof data.spineCropEnd === "number") {
      item.spineImage = data.spineImage;
      item.spineCropStart = data.spineCropStart;
      item.spineCropEnd = data.spineCropEnd;
    }
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
  function updateItem(id, title, image, notes, subKind, author, spineArt) {
    var item = findItemById(id);
    if (!item) return;
    item.title = title;
    item.image = image;
    item.notes = notes;
    item.author = author || "";
    if (subKind) item.subKind = subKind;
    if (spineArt) {
      item.spineImage = spineArt.spineImage;
      item.spineCropStart = spineArt.spineCropStart;
      item.spineCropEnd = spineArt.spineCropEnd;
    } else {
      delete item.spineImage;
      delete item.spineCropStart;
      delete item.spineCropEnd;
    }
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
    el.collectionTitleJp.textContent = CATEGORY_JP[state.category];
    el.deptIcon.textContent = CATEGORY_ICON[state.category];
    var withShelves = WITH_SHELVES[state.category];
    el.comicStatusTabs.classList.toggle("hidden", !withShelves);
    el.bookSortRow.classList.toggle("hidden", state.category !== "book");
    if (state.category === "book") renderBookSortControls();

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
    var isSpineShelf = SPINE_SHELF_CONFIG[state.category];
    el.grid.className = "shelf-grid";
    var empty = items.length === 0;

    if (isSpineShelf) {
      el.emptyMsg.classList.toggle("hidden", !(empty && !search));
      el.noMatchMsg.classList.toggle("hidden", !(empty && search));
      renderShelfCategory(el.grid, items, isSpineShelf);
    } else if (state.category === "comic") {
      // The long-box shows its own "box is empty" state, so the generic
      // empty/no-match paragraphs would just be redundant clutter under it.
      el.emptyMsg.classList.add("hidden");
      el.noMatchMsg.classList.add("hidden");
      renderComicBox(el.grid, items);
    } else {
      el.emptyMsg.classList.toggle("hidden", !(empty && !search));
      el.noMatchMsg.classList.toggle("hidden", !(empty && search));
      renderFiguresCase(el.grid, items);
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

  // Retro collection-room redesign: Books & Manga, Movies, and Games all
  // render as a physical shelf — real art backdrop (shelf-manga-movies.webp
  // / shelf-games.webp, see ASSET_LIST.md), items shown as spines that pop
  // forward to their real cover on click, one scrollable row per shelf
  // instead of wrapping/resizing to fit every item. Comics (the long-box)
  // and Figures (the cabinet) aren't converted yet — see LOG.md: both
  // reference mockup assets have fixed content baked into the art itself,
  // which can't hold a real, variable-sized collection as-is.
  var SPINE_SHELF_CONFIG = {
    book: { bg: "manga-movies-top", sections: true, draggable: true },
    movie: { bg: "manga-movies-bottom", sections: false, draggable: false },
    game: { bg: "games", sections: false, draggable: false }
  };

  function renderShelfCategory(container, items, opts) {
    var frame = document.createElement("div");
    frame.className = "shelf-frame";
    frame.dataset.shelfBg = opts.bg;

    if (opts.sections) {
      // Books & Manga only: split into their own labeled rows (item.subKind,
      // see the add/edit forms' Book/Manga toggle). Order within a section
      // comes from state.bookSort (see sortBookItems) — custom drag order by
      // default, or alphabetical/date-added/author, each ascending or
      // descending.
      var sections = [
        { key: "book", label: "Books", items: [] },
        { key: "manga", label: "Manga", items: [] }
      ];
      items.forEach(function (it) {
        var key = it.subKind === "manga" ? "manga" : "book";
        sections[key === "manga" ? 1 : 0].items.push(it);
      });

      sections.forEach(function (section) {
        if (!section.items.length) return;
        section.items = sortBookItems(section.items);

        var sectionEl = document.createElement("div");
        sectionEl.className = "shelf-section";

        var label = document.createElement("div");
        label.className = "shelf-section-label";
        label.textContent = section.label;
        sectionEl.appendChild(label);
        sectionEl.appendChild(buildSpineScrollRow(section.items, {
          groupKey: section.key,
          draggable: opts.draggable
        }));
        frame.appendChild(sectionEl);
      });
    } else {
      frame.appendChild(buildSpineScrollRow(items, { draggable: opts.draggable }));
    }

    container.appendChild(frame);
  }

  // A fixed-height shelf that scrolls horizontally instead of wrapping or
  // resizing once it's full — keeps the real shelf-art backdrop at a
  // constant size no matter how large the collection gets.
  function buildSpineScrollRow(items, opts) {
    var wrap = document.createElement("div");
    wrap.className = "shelf-scroll-wrap";

    var row = document.createElement("div");
    row.className = "shelf-scroll-row";
    items.forEach(function (item) {
      row.appendChild(buildSpineTile(item, opts));
    });

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "shelf-scroll-btn prev";
    prevBtn.setAttribute("aria-label", "Scroll shelf left");
    prevBtn.textContent = "‹";
    prevBtn.addEventListener("click", function () {
      row.scrollBy({ left: -160, behavior: "smooth" });
    });

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "shelf-scroll-btn next";
    nextBtn.setAttribute("aria-label", "Scroll shelf right");
    nextBtn.textContent = "›";
    nextBtn.addEventListener("click", function () {
      row.scrollBy({ left: 160, behavior: "smooth" });
    });

    wrap.appendChild(prevBtn);
    wrap.appendChild(row);
    wrap.appendChild(nextBtn);
    return wrap;
  }

  // A plausible spine built from the item's own title/metadata — not the
  // front cover rotated sideways. Color and thickness are deterministic
  // (hashed from the title) so the same item always looks the same, and
  // vary enough that a shelf of real titles doesn't look uniform.
  var SPINE_PALETTE = ["#C8102E", "#2E6BE0", "#1F6E4A", "#FFD23B", "#6B4226", "#7A0A1D", "#19171A", "#8B5A2B"];

  function hashStr(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function spineColorFor(item) {
    return SPINE_PALETTE[hashStr(item.title || item.seriesName || "x") % SPINE_PALETTE.length];
  }

  function spineWidthFor(item) {
    return 24 + (hashStr((item.title || "") + "w") % 16); // 24-39px
  }

  // A real spine image is an optional crop out of a full-wrap cover scan
  // (back | spine | front, see SPINE_ART.md) — cropCrop percentages mark
  // where the spine strip sits in that image. Falls back to the generated
  // colored-bar spine when absent, same as every item before this existed.
  var SPINE_HEIGHT_PX = 142; // keep in sync with .spine's height in style.css

  function hasRealSpineArt(item) {
    return !!item.spineImage &&
      typeof item.spineCropStart === "number" &&
      typeof item.spineCropEnd === "number" &&
      item.spineCropEnd > item.spineCropStart;
  }

  // One-time migration: spineCropStart/End used to be percentages (0-100)
  // before this switched to exact source pixels (percent steps were too
  // coarse to land on a real spine's seam, see LOG.md). A real cover scan
  // is always far wider than 100px, so "both values ≤ 100" is a safe
  // signal that an item predates the switch — convert it in place, once,
  // and persist so this doesn't re-check every render.
  function migrateLegacyPercentSpineCrop(item, naturalWidth) {
    if (!naturalWidth || item.spineCropStart > 100 || item.spineCropEnd > 100) return;
    item.spineCropStart = Math.round(item.spineCropStart / 100 * naturalWidth);
    item.spineCropEnd = Math.round(item.spineCropEnd / 100 * naturalWidth);
    saveItems();
    if (window.ShelfSync) window.ShelfSync.setItem(item).catch(function () {});
  }

  // Crops imgEl to just the [startPx, endPx] horizontal slice of its own
  // natural width (exact source pixels, not a percentage — a spine is
  // often only ~5% of the full image's width, so whole-percent steps were
  // too coarse to land on the real seam; this gives single-pixel
  // precision instead), at full natural height scaled to targetHeightPx —
  // i.e. the real proportions of that slice, no stretching. containerEl
  // must be position:relative/overflow:hidden; imgEl must be
  // position:absolute (both set here). Needs the image already loaded
  // (naturalWidth/Height).
  function applyImageCrop(naturalWidth, naturalHeight, startPx, endPx, containerEl, imgEl, targetHeightPx) {
    if (endPx <= startPx || !naturalWidth || !naturalHeight) return;
    var scale = targetHeightPx / naturalHeight;
    var renderedFullWidth = naturalWidth * scale;
    var sliceWidthPx = (endPx - startPx) * scale;

    containerEl.style.position = "relative";
    containerEl.style.overflow = "hidden";
    containerEl.style.height = targetHeightPx + "px";
    containerEl.style.width = sliceWidthPx + "px";

    imgEl.style.position = "absolute";
    imgEl.style.top = "0";
    imgEl.style.height = targetHeightPx + "px";
    imgEl.style.width = renderedFullWidth + "px";
    imgEl.style.maxWidth = "none";
    imgEl.style.left = -(startPx * scale) + "px";

    return sliceWidthPx;
  }

  function buildSpineTile(item, opts) {
    opts = opts || {};
    var tile = document.createElement("div");
    tile.className = "spine";
    tile.dataset.id = item.id;
    if (opts.groupKey) tile.dataset.group = opts.groupKey;
    tile.style.width = spineWidthFor(item) + "px"; // provisional until real art (if any) loads
    tile.tabIndex = 0;
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", item.title || "Item");

    if (hasRealSpineArt(item)) {
      tile.classList.add("real-spine");
      var cropWrap = document.createElement("div");
      cropWrap.className = "spine-real-crop";
      var cropImg = document.createElement("img");
      cropImg.alt = "";
      cropImg.src = item.spineImage;
      cropWrap.appendChild(cropImg);
      tile.appendChild(cropWrap);
      cropImg.addEventListener("load", function () {
        migrateLegacyPercentSpineCrop(item, cropImg.naturalWidth);
        var w = applyImageCrop(cropImg.naturalWidth, cropImg.naturalHeight, item.spineCropStart, item.spineCropEnd, cropWrap, cropImg, SPINE_HEIGHT_PX);
        if (w) tile.style.width = w + "px";
      });
      cropImg.addEventListener("error", function () {
        // Broken spine-art URL: fall back to the generated spine rather than
        // showing an empty sliver.
        cropWrap.remove();
        tile.classList.remove("real-spine");
        tile.style.background = spineColorFor(item);
        var label = document.createElement("span");
        label.className = "spine-label";
        label.textContent = item.title || "";
        tile.insertBefore(label, tile.firstChild);
      });
    } else {
      tile.style.background = spineColorFor(item);
      var labelSpan = document.createElement("span");
      labelSpan.className = "spine-label";
      labelSpan.textContent = item.title || "";
      tile.appendChild(labelSpan);
    }

    var rest = document.createElement("div");
    rest.innerHTML =
      '<img class="spine-cover" src="' + (item.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
      statusDotsHtml(item);
    while (rest.firstChild) tile.appendChild(rest.firstChild);

    function activate() {
      if (tile.classList.contains("expanded")) {
        showItemOverlay(item);
        return;
      }
      collapseSiblingSpines(tile);
      tile.classList.add("expanded");
      tile.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }

    tile.addEventListener("click", function (e) {
      if (tile.dataset.dragged === "1") { tile.dataset.dragged = ""; return; }
      e.stopPropagation();
      activate();
    });
    tile.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      if (e.key === "Escape") tile.classList.remove("expanded");
    });

    if (opts.draggable) bindShelfDrag(tile, item, opts.groupKey);
    return tile;
  }

  function collapseSiblingSpines(tile) {
    var row = tile.closest(".shelf-scroll-row");
    if (!row) return;
    row.querySelectorAll(".spine.expanded").forEach(function (el) {
      if (el !== tile) el.classList.remove("expanded");
    });
  }

  // ---------- figures: a lit glass display case ----------
  // Once a shelf fills past FIGURE_ROWS_PER_PAGE rows, the rest become a
  // second (third, ...) "shelf" the case rotates to, like a real rotating
  // display cabinet, instead of growing the case taller forever. Two fixed
  // DOM faces (figures-face-a/b) sit back-to-back inside a 3D rotor; moving
  // to another shelf renders that page into whichever face is currently
  // hidden, then spins the rotor 180° to bring it to the front.

  var FIGURE_ROWS_PER_PAGE = 4;
  var figuresCaseState = {
    items: [], page: 0, columns: 1, rotation: 0,
    rotor: null, faces: [null, null], frontFace: 0, animating: false
  };

  function countGridColumns(gridEl) {
    var cols = getComputedStyle(gridEl).gridTemplateColumns.split(" ").filter(Boolean);
    return cols.length || 1;
  }

  function figuresPerPage() {
    return Math.max(1, figuresCaseState.columns) * FIGURE_ROWS_PER_PAGE;
  }

  function buildFigureItem(item) {
    var fig = document.createElement("button");
    fig.type = "button";
    fig.className = "figure-item";
    fig.setAttribute("aria-label", item.title || "Figure");
    fig.innerHTML = '<img src="' + (item.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">';
    fig.addEventListener("click", function () {
      openFigureHold(item, fig.querySelector("img"));
    });
    return fig;
  }

  // Clicking a figure "pulls it off the shelf" — it zooms toward the
  // viewer, like picking it up to look at it, instead of jumping straight
  // to the edit panel. Clicking it again (now that you're "holding" it)
  // opens the real edit overlay; clicking the dimmed backdrop (or Escape)
  // puts it back on the shelf instead. A FLIP-style animation: a cloned
  // <img> is given the clicked tile's exact on-screen rect, then animated
  // to a big centered one via a CSS transition on left/top/width/height.
  var figureHoldState = null;

  function figureHoldTargetRect(originRect) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var maxWidth = Math.min(vw * 0.6, 380);
    var maxHeight = vh * 0.62;
    var aspect = (originRect.width || 1) / (originRect.height || 1);
    var width = maxWidth, height = width / aspect;
    if (height > maxHeight) { height = maxHeight; width = height * aspect; }
    return { left: (vw - width) / 2, top: (vh - height) / 2, width: width, height: height };
  }

  function openFigureHold(item, triggerImgEl) {
    if (figureHoldState || !triggerImgEl) return;
    var originRect = triggerImgEl.getBoundingClientRect();

    var backdrop = document.createElement("div");
    backdrop.className = "figure-hold-backdrop";
    backdrop.addEventListener("click", function () { closeFigureHold(false); });

    var img = document.createElement("img");
    img.className = "figure-hold-img";
    img.alt = item.title || "Figure";
    img.src = item.image || "";
    img.style.left = originRect.left + "px";
    img.style.top = originRect.top + "px";
    img.style.width = originRect.width + "px";
    img.style.height = originRect.height + "px";
    img.addEventListener("click", function (e) {
      e.stopPropagation();
      closeFigureHold(true);
    });

    var hint = document.createElement("div");
    hint.className = "figure-hold-hint";
    hint.textContent = "Tap again to edit";

    document.body.appendChild(backdrop);
    document.body.appendChild(img);
    document.body.appendChild(hint);
    figureHoldState = { item: item, backdrop: backdrop, img: img, hint: hint, originRect: originRect };

    requestAnimationFrame(function () {
      backdrop.classList.add("show");
      hint.classList.add("show");
      var target = figureHoldTargetRect(originRect);
      img.style.left = target.left + "px";
      img.style.top = target.top + "px";
      img.style.width = target.width + "px";
      img.style.height = target.height + "px";
    });

    document.addEventListener("keydown", onFigureHoldKeydown);
  }

  function onFigureHoldKeydown(e) {
    if (e.key === "Escape") closeFigureHold(false);
  }

  function closeFigureHold(openEdit) {
    if (!figureHoldState) return;
    var held = figureHoldState;
    figureHoldState = null;
    document.removeEventListener("keydown", onFigureHoldKeydown);

    if (openEdit) {
      held.backdrop.remove();
      held.img.remove();
      held.hint.remove();
      showItemOverlay(held.item);
      return;
    }

    // Put it back: animate to the shelf tile's original rect, then remove.
    held.backdrop.classList.remove("show");
    held.hint.classList.remove("show");
    held.img.style.left = held.originRect.left + "px";
    held.img.style.top = held.originRect.top + "px";
    held.img.style.width = held.originRect.width + "px";
    held.img.style.height = held.originRect.height + "px";
    setTimeout(function () {
      held.backdrop.remove();
      held.img.remove();
      held.hint.remove();
    }, 420);
  }

  function fillFigureFace(face, pageIndex) {
    var items = figuresCaseState.items;
    var perPage = figuresPerPage();
    face.innerHTML = "";
    if (!items.length) {
      face.appendChild(text("div", "empty-on-shelf", "THE CASE IS EMPTY"));
      return;
    }
    items.slice(pageIndex * perPage, pageIndex * perPage + perPage)
      .forEach(function (item) { face.appendChild(buildFigureItem(item)); });
  }

  function updateCaseDots(glass) {
    var dotsEl = glass.querySelector(".case-dots");
    var navBtns = glass.querySelectorAll(".case-nav");
    if (!dotsEl) return;
    var pageCount = Math.max(1, Math.ceil(figuresCaseState.items.length / figuresPerPage()));
    dotsEl.innerHTML = "";
    var multiPage = pageCount > 1;
    navBtns.forEach(function (btn) { btn.style.display = multiPage ? "" : "none"; });
    if (!multiPage) return;
    for (var i = 0; i < pageCount; i++) {
      var dot = document.createElement("span");
      dot.className = "case-dot" + (i === figuresCaseState.page ? " active" : "");
      dotsEl.appendChild(dot);
    }
  }

  function rotateFiguresCase(direction) {
    var glass = figuresCaseState.rotor.closest(".glass-case");
    var items = figuresCaseState.items;
    var pageCount = Math.max(1, Math.ceil(items.length / figuresPerPage()));
    if (figuresCaseState.animating || pageCount <= 1) return;

    var nextPage = ((figuresCaseState.page + direction) % pageCount + pageCount) % pageCount;
    var backFaceIndex = figuresCaseState.frontFace === 0 ? 1 : 0;
    fillFigureFace(figuresCaseState.faces[backFaceIndex], nextPage);

    figuresCaseState.animating = true;
    figuresCaseState.rotation += direction * 180;
    figuresCaseState.rotor.style.transform = "rotateY(" + figuresCaseState.rotation + "deg)";
    figuresCaseState.page = nextPage;
    figuresCaseState.frontFace = backFaceIndex;
    updateCaseDots(glass);

    var rotor = figuresCaseState.rotor;
    function onEnd(e) {
      if (e.target !== rotor || e.propertyName !== "transform") return;
      rotor.removeEventListener("transitionend", onEnd);
      figuresCaseState.animating = false;
      // Keep the rotation value bounded (±180/360 is visually identical to
      // 0/180) so a long session of flipping back and forth never drifts
      // into huge transform values.
      var normalized = ((figuresCaseState.rotation % 360) + 360) % 360;
      if (normalized !== figuresCaseState.rotation) {
        rotor.style.transition = "none";
        figuresCaseState.rotation = normalized;
        rotor.style.transform = "rotateY(" + normalized + "deg)";
        void rotor.offsetWidth; // force reflow before re-enabling the transition
        rotor.style.transition = "";
      }
    }
    rotor.addEventListener("transitionend", onEnd);
  }

  function renderFiguresCase(container, items) {
    figuresCaseState.items = items;

    var glass = document.createElement("div");
    glass.className = "glass-case";

    var light = document.createElement("div");
    light.className = "cabinet-light";
    glass.appendChild(light);

    var carousel = document.createElement("div");
    carousel.className = "figures-carousel";
    var rotor = document.createElement("div");
    rotor.className = "figures-rotor";
    var faceA = document.createElement("div");
    faceA.className = "figures-face figures-grid figures-face-a";
    var faceB = document.createElement("div");
    faceB.className = "figures-face figures-grid figures-face-b";
    rotor.append(faceA, faceB);
    carousel.appendChild(rotor);
    glass.appendChild(carousel);

    var reflection = document.createElement("div");
    reflection.className = "glass-reflection";
    glass.appendChild(reflection);

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "case-nav prev";
    prevBtn.setAttribute("aria-label", "Rotate case to the previous shelf");
    prevBtn.textContent = "‹";
    prevBtn.addEventListener("click", function () { rotateFiguresCase(-1); });
    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "case-nav next";
    nextBtn.setAttribute("aria-label", "Rotate case to the next shelf");
    nextBtn.textContent = "›";
    nextBtn.addEventListener("click", function () { rotateFiguresCase(1); });
    glass.append(prevBtn, nextBtn);

    var dots = document.createElement("div");
    dots.className = "case-dots";
    glass.appendChild(dots);

    container.appendChild(glass);

    figuresCaseState.rotor = rotor;
    figuresCaseState.faces = [faceA, faceB];
    figuresCaseState.frontFace = 0;
    figuresCaseState.rotation = 0;
    rotor.style.transform = "rotateY(0deg)";

    // Column count depends on the case's actual rendered width, so measure
    // once it's laid out, then clamp the remembered page and fill face A.
    requestAnimationFrame(function () {
      figuresCaseState.columns = countGridColumns(faceA);
      var pageCount = Math.max(1, Math.ceil(items.length / figuresPerPage()));
      if (figuresCaseState.page >= pageCount) figuresCaseState.page = pageCount - 1;
      fillFigureFace(faceA, figuresCaseState.page);
      updateCaseDots(glass);
    });
  }

  // ---------- comics: the long-box ----------
  // Shows every owned issue (flattened across series — not grouped), fanned
  // out like a real comic-box browsing session: the card nearest the
  // pointer/selection rises forward. Arrow keys, the mouse wheel, and touch
  // swipe all shift the selection; Enter or a click opens that issue.

  var comicBoxState = { selected: 0, items: [] };

  function renderComicBox(container, items) {
    comicBoxState.items = items;
    if (comicBoxState.selected >= items.length) comicBoxState.selected = Math.max(0, items.length - 1);

    var showcase = document.createElement("div");
    showcase.className = "comic-showcase";

    var callout = document.createElement("div");
    callout.className = "comic-callout";
    callout.innerHTML = 'BROWSE<br>YOUR BOX!<small>コミックを探そう！</small>';
    showcase.appendChild(callout);

    var scene = document.createElement("div");
    scene.className = "box-scene";

    var papers = document.createElement("div");
    papers.className = "comic-papers";
    papers.id = "comicPapers";
    papers.tabIndex = 0;
    papers.setAttribute("role", "listbox");
    papers.setAttribute("aria-label", "Browse your comic box with arrow keys, the mouse wheel, or touch");
    scene.appendChild(papers);

    var lip = document.createElement("div");
    lip.className = "longbox-lip";
    scene.appendChild(lip);

    var front = document.createElement("div");
    front.className = "longbox-front";
    var label = document.createElement("div");
    label.className = "longbox-label";
    label.innerHTML = "<span>MY COMIC COLLECTION</span><b>" + String(items.length).padStart(3, "0") + " ISSUES</b>";
    front.appendChild(label);
    scene.appendChild(front);

    var controls = document.createElement("div");
    controls.className = "comic-controls";
    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.setAttribute("aria-label", "Previous comic");
    prevBtn.textContent = "←";
    var current = document.createElement("strong");
    current.id = "comicCurrent";
    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.setAttribute("aria-label", "Next comic");
    nextBtn.textContent = "→";
    controls.append(prevBtn, current, nextBtn);
    scene.appendChild(controls);

    showcase.appendChild(scene);
    container.appendChild(showcase);

    prevBtn.addEventListener("click", function () { shiftComic(-1); });
    nextBtn.addEventListener("click", function () { shiftComic(1); });

    papers.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); shiftComic(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); shiftComic(-1); }
      else if (e.key === "Enter") {
        var it = comicBoxState.items[comicBoxState.selected];
        if (it) showItemOverlay(it);
      }
    });
    papers.addEventListener("wheel", function (e) {
      e.preventDefault();
      shiftComic(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
    }, { passive: false });
    var touchStartX = 0;
    papers.addEventListener("touchstart", function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
    papers.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 30) shiftComic(dx < 0 ? 1 : -1);
    }, { passive: true });

    renderComicCards();
  }

  function shiftComic(amount) {
    var len = comicBoxState.items.length;
    if (!len) return;
    comicBoxState.selected = (comicBoxState.selected + amount + len) % len;
    renderComicCards();
  }

  // Shows a window of up to 5 cards centered on the selection — the box
  // doesn't try to lay out an arbitrarily large collection flat; it shifts
  // which handful is fanned out, same as physically flipping through a box.
  var COMIC_WINDOW = 5;

  function renderComicCards() {
    var papers = document.getElementById("comicPapers");
    var current = document.getElementById("comicCurrent");
    if (!papers) return;
    papers.innerHTML = "";

    var items = comicBoxState.items;
    var total = items.length;
    if (!total) {
      papers.appendChild(text("div", "empty-on-shelf", "YOUR COMIC BOX IS EMPTY"));
      if (current) current.textContent = "NO ISSUES";
      return;
    }

    var windowSize = Math.min(COMIC_WINDOW, total);
    var start = Math.min(
      Math.max(0, comicBoxState.selected - Math.floor(windowSize / 2)),
      Math.max(0, total - windowSize)
    );
    var visible = items.slice(start, start + windowSize);
    var n = visible.length;

    visible.forEach(function (item, i) {
      var actual = start + i;
      var card = document.createElement("button");
      card.type = "button";
      card.className = "comic-card" + (actual === comicBoxState.selected ? " selected" : "");
      var tilt = (i - (n - 1) / 2) * -2;
      var selected = actual === comicBoxState.selected;
      card.style.left = (n === 1 ? 40 : 4 + i * (73 / (n - 1))) + "%";
      card.style.transform = "translateY(" + (selected ? "-40px" : "0px") + ") rotate(" + (selected ? 0 : tilt) + "deg)";
      card.style.zIndex = selected ? 40 : (n - i);
      card.setAttribute("aria-label", item.title || "Comic issue");
      card.innerHTML = '<img src="' + (item.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">';
      card.addEventListener("pointerenter", function () {
        comicBoxState.selected = actual;
        renderComicCards();
      });
      card.addEventListener("click", function () { showItemOverlay(item); });
      papers.appendChild(card);
    });

    if (current) {
      current.textContent = String(comicBoxState.selected + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0");
    }
  }

  function text(tag, cls, content) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = content;
    return e;
  }

  // Clicking anywhere outside a shelf collapses whatever's expanded —
  // otherwise a popped-forward spine stays stuck open after you move on.
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".spine")) return;
    document.querySelectorAll(".spine.expanded").forEach(function (el) {
      el.classList.remove("expanded");
    });
  });

  // Four ways to look at a shelf section: the user's own drag-and-drop
  // order (sortIndex), alphabetical by title, oldest/newest added, or by
  // author — each flippable top-to-bottom or bottom-to-top. Returns a new
  // array; never mutates the one passed in.
  function sortBookItems(items) {
    var method = state.bookSort.method;
    var sorted = items.slice();
    if (method === "alpha") {
      sorted.sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); });
    } else if (method === "added") {
      sorted.sort(function (a, b) { return (a.addedAt || "").localeCompare(b.addedAt || ""); });
    } else if (method === "author") {
      sorted.sort(function (a, b) { return (a.author || "").localeCompare(b.author || ""); });
    } else {
      sorted.sort(function (a, b) {
        var ai = typeof a.sortIndex === "number" ? a.sortIndex : 0;
        var bi = typeof b.sortIndex === "number" ? b.sortIndex : 0;
        return ai - bi;
      });
    }
    if (state.bookSort.direction === "desc") sorted.reverse();
    return sorted;
  }

  function renderBookSortControls() {
    el.bookSortMethod.value = state.bookSort.method;
    var asc = state.bookSort.direction !== "desc";
    el.bookSortDirectionBtn.textContent = asc ? "↑" : "↓";
    el.bookSortDirectionBtn.setAttribute("aria-label", asc ? "Sort ascending" : "Sort descending");
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
      ghost.className = "spine shelf-drag-ghost";
      ghost.style.width = rect.width + "px";
      document.body.appendChild(ghost);
      moveGhost(x, y);
      try { tile.setPointerCapture(pointerId); } catch (err) {}
    }

    function updateDropTarget(x, y) {
      if (ghost) ghost.style.display = "none";
      var under = document.elementFromPoint(x, y);
      if (ghost) ghost.style.display = "";
      var target = under && under.closest(".spine");
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
    // Whatever order is currently on screen becomes the new custom order —
    // dragging while sorted some other way (alphabetical, by author, ...)
    // adopts that order as the baseline, applies the move on top of it, and
    // switches the shelf back to "Custom" so the drop is what you see next.
    var group = sortBookItems(
      state.items.filter(function (it) { return it.category === "book" && (it.subKind || "book") === groupKey; })
    ).filter(function (it) { return it.id !== movedItem.id; });

    var targetIndex = -1;
    group.forEach(function (it, i) { if (it.id === targetId) targetIndex = i; });
    if (targetIndex === -1) return;

    group.splice(before ? targetIndex : targetIndex + 1, 0, movedItem);
    group.forEach(function (it, i) { it.sortIndex = i; });

    state.bookSort = { method: "custom", direction: "asc" };
    saveBookSort();

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
    el.itemMeta.textContent = CATEGORY_LABELS[item.category] +
      (item.author ? " · " + item.author : "") +
      (item.upc ? " · " + item.upc : "");
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
    el.authorInput.classList.toggle("hidden", state.category !== "book");
    el.coverBgRemoveHint.classList.toggle("hidden", state.category !== "figure");
    // Spine art only makes sense for a category that's actually shelved by
    // its spine (books/manga, movies, games) — a figure has no spine, so
    // hide the option (and force the panel closed) entirely for Figures.
    el.spineArtToggle.classList.toggle("hidden", state.category === "figure");
    if (state.category === "figure") el.spineArtPanel.classList.add("hidden");
    el.titleInput.focus();
  }

  function hideManualForm() {
    el.manualForm.classList.add("hidden");
    el.manualForm.reset();
    el.manualDuplicateWarning.classList.add("hidden");
    el.manualSubmitBtn.textContent = "Add to Collection";
    state.editingId = null;
    populateSpineArtPanel(null);
    resetCoverCropPanel();
  }

  // ---------- real spine art (crop a full-wrap scan, see SPINE_ART.md) ----------

  var spineCropNatural = { width: 0, height: 0 };

  function bindSpineArtPanel() {
    el.spineArtToggle.addEventListener("click", function () {
      el.spineArtPanel.classList.toggle("hidden");
    });
    el.spineImageInput.addEventListener("change", loadSpineCropImage);
    el.spineCropStartInput.addEventListener("input", onSpineCropRangeChange);
    el.spineCropEndInput.addEventListener("input", onSpineCropRangeChange);
    el.spineCropStartNumber.addEventListener("input", onSpineCropNumberChange);
    el.spineCropEndNumber.addEventListener("input", onSpineCropNumberChange);
    el.spineArtClearBtn.addEventListener("click", function () {
      el.spineImageInput.value = "";
      resetSpineArtPreview();
    });
    el.spineUploadInput.addEventListener("change", uploadSpineArtFile);
  }

  // Uploads a file/blob to imgbb via the Worker (see SPINE_ART.md for why
  // imgbb and not Firebase Storage/catbox) and resolves to the hosted URL.
  // Shared by the spine-art upload button and the cover crop-and-upload
  // flow below.
  function uploadBlobToWorker(blob, filename) {
    var formData = new FormData();
    formData.set("file", blob, filename);
    return fetch(LOOKUP_PROXY_URL + "/upload", { method: "POST", body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        return data.url;
      });
  }

  // Uploads the chosen file as-is (no crop — that's the cover-art flow
  // below) and fills the URL field with the result, then runs the normal
  // load-and-crop flow as if that URL had been pasted in.
  function uploadSpineArtFile() {
    var file = el.spineUploadInput.files[0];
    if (!file) return;

    el.spineUploadStatus.textContent = "Uploading…";
    uploadBlobToWorker(file, file.name)
      .then(function (url) {
        el.spineImageInput.value = url;
        el.spineUploadStatus.textContent = "Uploaded.";
        loadSpineCropImage();
      })
      .catch(function (err) {
        el.spineUploadStatus.textContent = "Upload failed: " + err.message;
      })
      .finally(function () {
        el.spineUploadInput.value = "";
      });
  }

  function loadSpineCropImage() {
    var url = el.spineImageInput.value.trim();
    if (!url) { resetSpineArtPreview(); return; }
    var probe = new Image();
    probe.onload = function () {
      spineCropNatural.width = probe.naturalWidth;
      spineCropNatural.height = probe.naturalHeight;
      el.spineCropPreviewImg.src = url;
      el.spineCropPreviewWrap.classList.remove("hidden");
      el.spineCropControls.classList.remove("hidden");
      el.spineLivePreviewRow.classList.remove("hidden");
      el.spineLivePreview.innerHTML = "";
      var img = document.createElement("img");
      img.alt = "";
      img.src = url;
      el.spineLivePreview.appendChild(img);

      // Crop range is in real source pixels now, not a percentage — a
      // spine is often only ~5% of the image's width, so whole-percent
      // steps were too coarse to land on the real seam. Re-anchor the
      // 0-100 default (44/50) onto this image's actual width the first
      // time it loads, so there's still a sane starting guess.
      [el.spineCropStartInput, el.spineCropEndInput, el.spineCropStartNumber, el.spineCropEndNumber].forEach(function (input) {
        input.max = probe.naturalWidth;
      });
      if (Number(el.spineCropEndInput.max) === 100 || !el.spineCropStartInput.dataset.isPixels) {
        el.spineCropStartInput.value = Math.round(probe.naturalWidth * 0.44);
        el.spineCropEndInput.value = Math.round(probe.naturalWidth * 0.50);
      }
      el.spineCropStartInput.dataset.isPixels = "1";
      syncSpineCropNumbers();
      updateSpineCropUI();
    };
    probe.onerror = function () {
      resetSpineArtPreview();
      setStatus("Couldn't load that image — check the URL.");
    };
    probe.src = url;
  }

  function onSpineCropRangeChange() {
    syncSpineCropNumbers();
    enforceSpineCropOrder(document.activeElement === el.spineCropStartInput);
    updateSpineCropUI();
  }

  function onSpineCropNumberChange() {
    el.spineCropStartInput.value = el.spineCropStartNumber.value;
    el.spineCropEndInput.value = el.spineCropEndNumber.value;
    enforceSpineCropOrder(document.activeElement === el.spineCropStartNumber);
    syncSpineCropNumbers();
    updateSpineCropUI();
  }

  function syncSpineCropNumbers() {
    el.spineCropStartNumber.value = el.spineCropStartInput.value;
    el.spineCropEndNumber.value = el.spineCropEndInput.value;
  }

  // Keeps a minimum 1px gap without fighting whichever handle the user is
  // actually moving.
  function enforceSpineCropOrder(movingStart) {
    var start = Number(el.spineCropStartInput.value);
    var end = Number(el.spineCropEndInput.value);
    var max = Number(el.spineCropEndInput.max) || 100;
    if (end <= start) {
      if (movingStart) {
        end = Math.min(max, start + 1);
        el.spineCropEndInput.value = end;
        el.spineCropEndNumber.value = end;
      } else {
        start = Math.max(0, end - 1);
        el.spineCropStartInput.value = start;
        el.spineCropStartNumber.value = start;
      }
    }
  }

  function updateSpineCropUI() {
    var start = Number(el.spineCropStartInput.value);
    var end = Number(el.spineCropEndInput.value);
    var width = spineCropNatural.width || Number(el.spineCropEndInput.max) || 1;
    el.spineCropMaskLeft.style.left = "0";
    el.spineCropMaskLeft.style.width = (start / width * 100) + "%";
    el.spineCropMaskRight.style.left = (end / width * 100) + "%";
    el.spineCropMaskRight.style.width = (100 - end / width * 100) + "%";

    var img = el.spineLivePreview.querySelector("img");
    if (img && spineCropNatural.width && spineCropNatural.height) {
      applyImageCrop(spineCropNatural.width, spineCropNatural.height, start, end, el.spineLivePreview, img, 100);
    }
  }

  function resetSpineArtPreview() {
    spineCropNatural.width = 0;
    spineCropNatural.height = 0;
    el.spineCropPreviewWrap.classList.add("hidden");
    el.spineCropControls.classList.add("hidden");
    el.spineLivePreviewRow.classList.add("hidden");
    el.spineLivePreview.innerHTML = "";
    el.spineUploadStatus.textContent = "";
    delete el.spineCropStartInput.dataset.isPixels;
  }

  // Shows/hides and fills the panel when opening the form for an existing
  // item (edit) vs. a brand-new one (item === null).
  function populateSpineArtPanel(item) {
    if (item && hasRealSpineArt(item)) {
      el.spineArtPanel.classList.remove("hidden");
      el.spineImageInput.value = item.spineImage;
      el.spineCropStartInput.value = item.spineCropStart;
      el.spineCropEndInput.value = item.spineCropEnd;
      el.spineCropStartInput.dataset.isPixels = "1"; // don't re-guess 44/50% once loaded
      loadSpineCropImage();
    } else {
      el.spineArtPanel.classList.add("hidden");
      el.spineImageInput.value = "";
      resetSpineArtPreview();
    }
  }

  function readSpineArtFromForm() {
    var url = el.spineImageInput.value.trim();
    if (!url) return null;
    var start = Number(el.spineCropStartInput.value);
    var end = Number(el.spineCropEndInput.value);
    if (!(end > start)) return null;
    return { spineImage: url, spineCropStart: start, spineCropEnd: end };
  }

  // ---------- cover art: upload & crop ----------
  // Unlike the spine tool above (which keeps the full source image and
  // crops it live every render), this crops once, client-side, and
  // uploads only the cropped result — item.image stays a plain already-
  // cropped URL, so every existing place that already shows it (grid
  // tiles, the confirm panel, the item overlay, the figures case) needs
  // no changes. Cropping happens on a local object URL (the file the user
  // just picked), never on a fetched remote URL, so the canvas is never
  // cross-origin-tainted — this is why it's an upload-only flow, not a
  // "paste a URL" one like the spine tool.

  var coverCropState = { naturalWidth: 0, naturalHeight: 0, objectUrl: null };

  function bindCoverCropPanel() {
    el.coverUploadToggle.addEventListener("click", function () {
      el.coverCropPanel.classList.toggle("hidden");
    });
    el.coverUploadInput.addEventListener("change", onCoverFilePicked);
    el.coverCropStartInput.addEventListener("input", onCoverCropRangeChange);
    el.coverCropEndInput.addEventListener("input", onCoverCropRangeChange);
    el.coverCropStartNumber.addEventListener("input", onCoverCropNumberChange);
    el.coverCropEndNumber.addEventListener("input", onCoverCropNumberChange);
    el.coverCropApplyBtn.addEventListener("click", applyCoverCrop);
    el.coverCropCancelBtn.addEventListener("click", resetCoverCropPanel);
    // A pasted "Cover image URL" (as opposed to the upload-and-crop tool
    // above) gets the same Figures-only background removal — best effort,
    // since a cross-origin host that doesn't send CORS headers taints the
    // canvas and makes this impossible; see attemptUrlBackgroundRemoval.
    el.imageInput.addEventListener("change", function () {
      attemptUrlBackgroundRemoval(el.imageInput.value.trim());
    });
  }

  // Only runs for Figures, and only on a URL actually typed/pasted into
  // the field (programmatic value assignment elsewhere in this file, e.g.
  // after the upload-and-crop flow above runs, never fires "change"). Asks
  // first — not every figure photo has a background to remove — then tries
  // to load the image cross-origin and remove it the same way the upload
  // flow does. If the image host doesn't send CORS headers the canvas
  // comes back tainted and reading its pixels throws; caught below, and
  // the pasted URL is left exactly as typed rather than silently
  // half-processed.
  function attemptUrlBackgroundRemoval(url) {
    if (state.category !== "figure" || !url) return;
    askRemoveBackground(function (shouldRemove) {
      if (!shouldRemove) return;

      var probe = new Image();
      probe.crossOrigin = "anonymous";
      probe.onload = function () {
        // The status line lives inside the (possibly collapsed) upload
        // panel — open it so a message triggered by the plain URL field,
        // above/outside that panel, is actually visible.
        el.coverCropPanel.classList.remove("hidden");
        var canvas;
        try {
          canvas = document.createElement("canvas");
          canvas.width = probe.naturalWidth;
          canvas.height = probe.naturalHeight;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(probe, 0, 0);
          ctx.getImageData(0, 0, 1, 1); // throws if the canvas is cross-origin-tainted
        } catch (err) {
          el.coverUploadStatus.textContent = "Couldn't remove the background from that URL (the image's host doesn't allow it) — using it as-is.";
          return;
        }
        canvas = downscaleCanvas(canvas, 1200);
        canvas = removeBackgroundAndAutocrop(canvas);
        uploadProcessedCover(canvas, true);
      };
      probe.onerror = function () {}; // leave it to the existing broken-image handling elsewhere
      probe.src = url;
    });
  }

  function onCoverFilePicked() {
    var file = el.coverUploadInput.files[0];
    if (!file) return;
    if (coverCropState.objectUrl) URL.revokeObjectURL(coverCropState.objectUrl);
    var objectUrl = URL.createObjectURL(file);
    coverCropState.objectUrl = objectUrl;

    var probe = new Image();
    probe.onload = function () {
      coverCropState.naturalWidth = probe.naturalWidth;
      coverCropState.naturalHeight = probe.naturalHeight;

      el.coverCropPreviewImg.src = objectUrl;
      el.coverCropPreviewWrap.classList.remove("hidden");
      el.coverCropControls.classList.remove("hidden");
      el.coverLivePreviewRow.classList.remove("hidden");
      el.coverLivePreview.innerHTML = "";
      var preview = document.createElement("img");
      preview.alt = "";
      preview.src = objectUrl;
      el.coverLivePreview.appendChild(preview);

      [el.coverCropStartInput, el.coverCropEndInput, el.coverCropStartNumber, el.coverCropEndNumber].forEach(function (input) {
        input.max = probe.naturalWidth;
      });
      // Default to the full image (no crop) — most uploads here will
      // already be a plain front cover, not a full-wrap scan, so "no
      // crop" should be the zero-effort default, not a guessed slice.
      el.coverCropStartInput.value = 0;
      el.coverCropEndInput.value = probe.naturalWidth;
      syncCoverCropNumbers();
      updateCoverCropUI();
    };
    probe.onerror = function () {
      el.coverUploadStatus.textContent = "Couldn't read that file.";
    };
    probe.src = objectUrl;
  }

  function onCoverCropRangeChange() {
    syncCoverCropNumbers();
    enforceCoverCropOrder(document.activeElement === el.coverCropStartInput);
    updateCoverCropUI();
  }

  function onCoverCropNumberChange() {
    el.coverCropStartInput.value = el.coverCropStartNumber.value;
    el.coverCropEndInput.value = el.coverCropEndNumber.value;
    enforceCoverCropOrder(document.activeElement === el.coverCropStartNumber);
    syncCoverCropNumbers();
    updateCoverCropUI();
  }

  function syncCoverCropNumbers() {
    el.coverCropStartNumber.value = el.coverCropStartInput.value;
    el.coverCropEndNumber.value = el.coverCropEndInput.value;
  }

  function enforceCoverCropOrder(movingStart) {
    var start = Number(el.coverCropStartInput.value);
    var end = Number(el.coverCropEndInput.value);
    var max = Number(el.coverCropEndInput.max) || 100;
    if (end <= start) {
      if (movingStart) {
        end = Math.min(max, start + 1);
        el.coverCropEndInput.value = end;
        el.coverCropEndNumber.value = end;
      } else {
        start = Math.max(0, end - 1);
        el.coverCropStartInput.value = start;
        el.coverCropStartNumber.value = start;
      }
    }
  }

  function updateCoverCropUI() {
    var start = Number(el.coverCropStartInput.value);
    var end = Number(el.coverCropEndInput.value);
    var width = coverCropState.naturalWidth || Number(el.coverCropEndInput.max) || 1;
    el.coverCropMaskLeft.style.left = "0";
    el.coverCropMaskLeft.style.width = (start / width * 100) + "%";
    el.coverCropMaskRight.style.left = (end / width * 100) + "%";
    el.coverCropMaskRight.style.width = (100 - end / width * 100) + "%";

    var img = el.coverLivePreview.querySelector("img");
    if (img && coverCropState.naturalWidth && coverCropState.naturalHeight) {
      applyImageCrop(coverCropState.naturalWidth, coverCropState.naturalHeight, start, end, el.coverLivePreview, img, 170);
    }
  }

  function resetCoverCropPanel() {
    if (coverCropState.objectUrl) URL.revokeObjectURL(coverCropState.objectUrl);
    coverCropState = { naturalWidth: 0, naturalHeight: 0, objectUrl: null };
    el.coverUploadInput.value = "";
    el.coverUploadStatus.textContent = "";
    el.coverCropPreviewWrap.classList.add("hidden");
    el.coverCropControls.classList.add("hidden");
    el.coverLivePreviewRow.classList.add("hidden");
    el.coverLivePreview.innerHTML = "";
    el.coverCropPanel.classList.add("hidden");
  }

  // Draws just the [start, end] horizontal slice (full height, the same
  // crop shape as the spine tool) onto an offscreen canvas at native
  // resolution, uploads that as a new file, and fills the Cover image URL
  // field with the result. For Figures specifically, asks first whether to
  // also strip the photo's background (see removeBackgroundAndAutocrop
  // below) — not every figure photo has one to remove (some are already a
  // transparent cutout, or a studio render with nothing to strip), so this
  // is never silent/automatic.
  function applyCoverCrop() {
    var start = Number(el.coverCropStartInput.value);
    var end = Number(el.coverCropEndInput.value);
    if (!(end > start) || !coverCropState.naturalHeight) return;

    var canvas = document.createElement("canvas");
    canvas.width = end - start;
    canvas.height = coverCropState.naturalHeight;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(
      el.coverCropPreviewImg,
      start, 0, end - start, coverCropState.naturalHeight,
      0, 0, end - start, coverCropState.naturalHeight
    );

    if (state.category !== "figure") {
      uploadProcessedCover(canvas, false);
      return;
    }

    askRemoveBackground(function (shouldRemove) {
      var finalCanvas = canvas;
      if (shouldRemove) {
        finalCanvas = downscaleCanvas(canvas, 1200);
        finalCanvas = removeBackgroundAndAutocrop(finalCanvas);
      }
      uploadProcessedCover(finalCanvas, true);
    });
  }

  // Shared by applyCoverCrop above and attemptUrlBackgroundRemoval below:
  // uploads the given canvas and fills the Cover image URL field with the
  // hosted result. Figures always upload as PNG (even when background
  // removal was declined) since a figure photo may already be a
  // transparent cutout worth preserving; every other category keeps JPEG.
  function uploadProcessedCover(canvas, asPng) {
    el.coverUploadStatus.textContent = "Uploading…";
    canvas.toBlob(function (blob) {
      if (!blob) {
        el.coverUploadStatus.textContent = "Couldn't process that image.";
        return;
      }
      uploadBlobToWorker(blob, asPng ? "cover.png" : "cover.jpg")
        .then(function (url) {
          el.imageInput.value = url;
          el.coverUploadStatus.textContent = "Uploaded.";
          resetCoverCropPanel();
        })
        .catch(function (err) {
          el.coverUploadStatus.textContent = "Upload failed: " + err.message;
        });
    }, asPng ? "image/png" : "image/jpeg", 0.92);
  }

  // A small inline Yes/No prompt in place of the status line — used before
  // ever running background removal, since it's a real "maybe, maybe not"
  // choice (a figure photo might already have no background to remove),
  // not something to decide silently on the user's behalf.
  function askRemoveBackground(onDecision) {
    el.coverCropPanel.classList.remove("hidden");
    el.coverUploadStatus.innerHTML = "";
    var question = document.createElement("span");
    question.textContent = "Remove this photo's background automatically? ";
    var yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.className = "btn primary bg-remove-choice";
    yesBtn.textContent = "Yes, remove it";
    var noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.className = "btn bg-remove-choice";
    noBtn.textContent = "No, keep as-is";
    yesBtn.addEventListener("click", function () {
      el.coverUploadStatus.textContent = "";
      onDecision(true);
    });
    noBtn.addEventListener("click", function () {
      el.coverUploadStatus.textContent = "";
      onDecision(false);
    });
    el.coverUploadStatus.append(question, yesBtn, noBtn);
  }

  // ---------- figures: automatic background removal on cover upload ----------
  // Scoped to Figures only — other categories' cover art (a VHS box, a game
  // box, a book cover) is supposed to show its real background, so only a
  // figure photo gets this treatment. No ML model, no paid API: flood-fills
  // inward from the image's four edges, removing any region of connected,
  // similar-enough color. That covers the common case (a product photo shot
  // on a plain/near-uniform backdrop — white, black, gray seamless paper)
  // without downloading anything. A busy/photographic background (a real
  // room, a cluttered desk) won't fully disappear, since it isn't one
  // connected tone — there's no ML segmentation behind this.

  var BG_REMOVE_COLOR_TOLERANCE = 24; // Euclidean RGB distance between adjacent pixels in the flood-fill chain
  var BG_REMOVE_ANCHOR_TOLERANCE = 42; // Euclidean RGB distance from the averaged background color overall

  function downscaleCanvas(canvas, maxDim) {
    var longest = Math.max(canvas.width, canvas.height);
    if (longest <= maxDim) return canvas;
    var scale = maxDim / longest;
    var out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  function removeBackgroundAndAutocrop(canvas) {
    var w = canvas.width, h = canvas.height;
    if (!w || !h) return canvas;
    var ctx = canvas.getContext("2d");
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;

    var visited = new Uint8Array(w * h);
    var queue = new Int32Array(w * h);
    var qHead = 0, qTail = 0;

    function idx(x, y) { return y * w + x; }
    function colorDist(i1, i2) {
      var dr = data[i1 * 4] - data[i2 * 4];
      var dg = data[i1 * 4 + 1] - data[i2 * 4 + 1];
      var db = data[i1 * 4 + 2] - data[i2 * 4 + 2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    // The background color isn't sampled from one pixel but averaged across
    // every border pixel, then every removal decision is checked against
    // that single fixed anchor (not just the previous pixel in the chain).
    // A pure "close to the previous step" flood fill drifts: a long chain
    // of small color changes (ordinary shading/gradient on the figure
    // itself) can add up to something far from the real background color,
    // tunneling the fill straight through parts of the figure that happen
    // to be a similar tone to the backdrop (seen on a real figure photo
    // where metallic-gray parts sat close enough to a light-gray backdrop
    // to leak through). Anchoring every pixel back to one fixed reference
    // color stops that drift.
    var anchorR = 0, anchorG = 0, anchorB = 0, seedCount = 0;
    var seeds = [];
    function addSeed(x, y) {
      var i = idx(x, y);
      if (visited[i]) return;
      visited[i] = 1;
      seeds.push(i);
      anchorR += data[i * 4]; anchorG += data[i * 4 + 1]; anchorB += data[i * 4 + 2];
      seedCount++;
    }
    for (var sx = 0; sx < w; sx++) { addSeed(sx, 0); addSeed(sx, h - 1); }
    for (var sy = 0; sy < h; sy++) { addSeed(0, sy); addSeed(w - 1, sy); }
    anchorR /= seedCount; anchorG /= seedCount; anchorB /= seedCount;

    function anchorDist(i) {
      var dr = data[i * 4] - anchorR;
      var dg = data[i * 4 + 1] - anchorG;
      var db = data[i * 4 + 2] - anchorB;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }
    for (var s = 0; s < seeds.length; s++) queue[qTail++] = seeds[s];

    // A candidate neighbor must be both close to the pixel that reached it
    // (tolerates a real gradient across the backdrop) AND close to the
    // overall background anchor color (stops that from drifting into an
    // unrelated tone) — admitted only if it passes both checks.
    var removed = new Uint8Array(w * h);
    while (qHead < qTail) {
      var i = queue[qHead++];
      removed[i] = 1;
      var x = i % w, y = (i / w) | 0;
      var nx, ny, ni;
      if (x > 0) { nx = x - 1; ni = idx(nx, y); if (!visited[ni] && colorDist(i, ni) <= BG_REMOVE_COLOR_TOLERANCE && anchorDist(ni) <= BG_REMOVE_ANCHOR_TOLERANCE) { visited[ni] = 1; queue[qTail++] = ni; } }
      if (x < w - 1) { nx = x + 1; ni = idx(nx, y); if (!visited[ni] && colorDist(i, ni) <= BG_REMOVE_COLOR_TOLERANCE && anchorDist(ni) <= BG_REMOVE_ANCHOR_TOLERANCE) { visited[ni] = 1; queue[qTail++] = ni; } }
      if (y > 0) { ny = y - 1; ni = idx(x, ny); if (!visited[ni] && colorDist(i, ni) <= BG_REMOVE_COLOR_TOLERANCE && anchorDist(ni) <= BG_REMOVE_ANCHOR_TOLERANCE) { visited[ni] = 1; queue[qTail++] = ni; } }
      if (y < h - 1) { ny = y + 1; ni = idx(x, ny); if (!visited[ni] && colorDist(i, ni) <= BG_REMOVE_COLOR_TOLERANCE && anchorDist(ni) <= BG_REMOVE_ANCHOR_TOLERANCE) { visited[ni] = 1; queue[qTail++] = ni; } }
    }

    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var py = 0; py < h; py++) {
      for (var px = 0; px < w; px++) {
        var pi = idx(px, py);
        if (removed[pi]) {
          data[pi * 4 + 3] = 0;
        } else {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    if (maxX < minX || maxY < minY) return canvas; // nothing survived — bail out untouched

    featherAlphaEdges(ctx, w, h);

    // Trim to the bounding box of what's left (plus a little breathing
    // room) so the figure isn't floating in a big transparent margin.
    var pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
    var cropX = Math.max(0, minX - pad);
    var cropY = Math.max(0, minY - pad);
    var cropW = Math.min(w, maxX + pad + 1) - cropX;
    var cropH = Math.min(h, maxY + pad + 1) - cropY;

    var trimmed = document.createElement("canvas");
    trimmed.width = cropW;
    trimmed.height = cropH;
    trimmed.getContext("2d").drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return trimmed;
  }

  // Softens the cut silhouette with a single 3x3 box blur over the alpha
  // channel only (color is untouched) — without it the removed/kept
  // boundary is a hard, slightly jagged edge.
  function featherAlphaEdges(ctx, w, h) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    var alphaCopy = new Uint8ClampedArray(w * h);
    for (var i = 0; i < w * h; i++) alphaCopy[i] = data[i * 4 + 3];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0, count = 0;
        for (var dy = -1; dy <= 1; dy++) {
          var ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            sum += alphaCopy[ny * w + nx];
            count++;
          }
        }
        data[(y * w + x) * 4 + 3] = Math.round(sum / count);
      }
    }
    ctx.putImageData(imageData, 0, 0);
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
          author: item.author || "",
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
    var metaText = match.meta || match.upc || "";
    if (match.author) metaText = metaText ? metaText + " · " + match.author : match.author;
    el.confirmMeta.textContent = metaText;
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
          author: item.author || "",
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
