(function () {
  "use strict";

  var STORAGE_KEY = "shelfScanner.items";
  // UPCitemdb blocks browser-side calls via CORS, so this Worker proxies the
  // lookup server-side. See worker/src/index.js.
  var LOOKUP_PROXY_URL = "https://shelf-scanner-upc.adrian-alemany2-ae1.workers.dev";
  var CATEGORIES = ["game", "figure", "comic", "movie", "manga"];
  var CATEGORY_LABELS = {
    game: "Games",
    figure: "Figures",
    comic: "Comics",
    movie: "Movies",
    manga: "Manga"
  };
  // Barcode lookup is unreliable for these; manual entry is the default path.
  var SCAN_UNRELIABLE = { comic: true, manga: true };
  // Categories with a title-search API wired up in the Worker (worker/src/index.js).
  var SEARCH_KIND = { movie: "movie", game: "game" };

  var state = {
    category: "game",
    items: loadItems(),
    pendingMatch: null, // the item waiting in the confirm panel
    scanner: null
  };

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
  }

  function cacheEls() {
    el.tabs = document.getElementById("categoryTabs");
    el.scanBtn = document.getElementById("scanBtn");
    el.typeBtn = document.getElementById("typeBtn");
    el.scannerWrap = document.getElementById("scannerWrap");
    el.cancelScanBtn = document.getElementById("cancelScanBtn");
    el.searchForm = document.getElementById("searchForm");
    el.searchTitleInput = document.getElementById("searchTitleInput");
    el.cancelSearchBtn = document.getElementById("cancelSearchBtn");
    el.searchResults = document.getElementById("searchResults");
    el.manualForm = document.getElementById("manualForm");
    el.titleInput = document.getElementById("titleInput");
    el.imageInput = document.getElementById("imageInput");
    el.notesInput = document.getElementById("notesInput");
    el.cancelManualBtn = document.getElementById("cancelManualBtn");
    el.confirmPanel = document.getElementById("confirmPanel");
    el.confirmImage = document.getElementById("confirmImage");
    el.confirmTitle = document.getElementById("confirmTitle");
    el.confirmMeta = document.getElementById("confirmMeta");
    el.confirmAddBtn = document.getElementById("confirmAddBtn");
    el.confirmEditBtn = document.getElementById("confirmEditBtn");
    el.confirmCancelBtn = document.getElementById("confirmCancelBtn");
    el.statusMsg = document.getElementById("statusMsg");
    el.collectionTitle = document.getElementById("collectionTitle");
    el.grid = document.getElementById("grid");
    el.emptyMsg = document.getElementById("emptyMsg");
    el.itemOverlay = document.getElementById("itemOverlay");
    el.itemImage = document.getElementById("itemImage");
    el.itemTitle = document.getElementById("itemTitle");
    el.itemMeta = document.getElementById("itemMeta");
    el.itemNotes = document.getElementById("itemNotes");
    el.deleteItemBtn = document.getElementById("deleteItemBtn");
    el.closeItemBtn = document.getElementById("closeItemBtn");
    el.attribution = document.getElementById("attribution");
  }

  function bindEvents() {
    el.tabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".cat-tab");
      if (!btn) return;
      setCategory(btn.dataset.cat);
    });

    el.scanBtn.addEventListener("click", startScan);
    el.cancelScanBtn.addEventListener("click", stopScan);

    el.typeBtn.addEventListener("click", function () {
      if (SEARCH_KIND[state.category]) {
        showSearchForm();
      } else {
        showManualForm();
      }
    });
    el.cancelSearchBtn.addEventListener("click", hideSearchForm);
    el.searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = el.searchTitleInput.value.trim();
      if (!title) return;
      runSearch(title);
    });
    el.cancelManualBtn.addEventListener("click", hideManualForm);
    el.manualForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = el.titleInput.value.trim();
      if (!title) return;
      addItem({
        category: state.category,
        title: title,
        image: el.imageInput.value.trim(),
        notes: el.notesInput.value.trim(),
        source: "manual"
      });
      hideManualForm();
    });

    el.confirmAddBtn.addEventListener("click", function () {
      if (!state.pendingMatch) return;
      addItem(state.pendingMatch);
      hideConfirmPanel();
    });
    el.confirmEditBtn.addEventListener("click", function () {
      if (!state.pendingMatch) return;
      el.titleInput.value = state.pendingMatch.title || "";
      el.imageInput.value = state.pendingMatch.image || "";
      el.notesInput.value = state.pendingMatch.notes || "";
      hideConfirmPanel();
      showManualForm();
    });
    el.confirmCancelBtn.addEventListener("click", hideConfirmPanel);

    el.closeItemBtn.addEventListener("click", hideItemOverlay);
    el.deleteItemBtn.addEventListener("click", function () {
      var id = el.itemOverlay.dataset.id;
      state.items = state.items.filter(function (it) { return it.id !== id; });
      saveItems();
      hideItemOverlay();
      renderGrid();
    });
  }

  // ---------- categories ----------

  function renderTabs() {
    Array.prototype.forEach.call(el.tabs.children, function (btn) {
      btn.classList.toggle("active", btn.dataset.cat === state.category);
    });
    // RAWG's free tier requires a visible backlink wherever its data is shown.
    el.attribution.classList.toggle("hidden", state.category !== "game");
  }

  function setCategory(cat) {
    if (CATEGORIES.indexOf(cat) === -1) return;
    state.category = cat;
    renderTabs();
    renderGrid();
    hideManualForm();
    hideSearchForm();
    hideConfirmPanel();
    stopScan();
  }

  // ---------- storage ----------

  function loadItems() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
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

  function addItem(data) {
    state.items.push({
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      category: data.category || state.category,
      title: data.title || "Untitled",
      image: data.image || "",
      upc: data.upc || "",
      notes: data.notes || "",
      source: data.source || "manual",
      addedAt: new Date().toISOString()
    });
    saveItems();
    renderGrid();
    setStatus("Added to your collection.");
  }

  // ---------- grid ----------

  function renderGrid() {
    el.collectionTitle.textContent = CATEGORY_LABELS[state.category];
    var items = state.items.filter(function (it) { return it.category === state.category; });
    el.grid.innerHTML = "";
    el.emptyMsg.classList.toggle("hidden", items.length > 0);

    items.slice().reverse().forEach(function (item) {
      var card = document.createElement("button");
      card.className = "grid-item";
      card.innerHTML =
        '<img src="' + (item.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="label">' + escapeHtml(item.title) + "</div>";
      card.addEventListener("click", function () { showItemOverlay(item); });
      el.grid.appendChild(card);
    });
  }

  function showItemOverlay(item) {
    el.itemOverlay.dataset.id = item.id;
    el.itemImage.src = item.image || "";
    el.itemTitle.textContent = item.title;
    el.itemMeta.textContent = CATEGORY_LABELS[item.category] + (item.upc ? " · " + item.upc : "");
    el.itemNotes.textContent = item.notes || "";
    el.itemOverlay.classList.remove("hidden");
  }

  function hideItemOverlay() {
    el.itemOverlay.classList.add("hidden");
  }

  // ---------- manual entry ----------

  function showManualForm() {
    hideConfirmPanel();
    hideSearchForm();
    el.manualForm.classList.remove("hidden");
    el.titleInput.focus();
  }

  function hideManualForm() {
    el.manualForm.classList.add("hidden");
    el.manualForm.reset();
  }

  // ---------- title search ----------

  function showSearchForm() {
    hideManualForm();
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

    setStatus("Searching...");
    var url = LOOKUP_PROXY_URL + "/search?kind=" + kind + "&title=" + encodeURIComponent(title);

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setStatus(data.error + " — you can still add it manually.");
          renderSearchResults([]);
          return;
        }
        var items = data.items || [];
        if (!items.length) {
          setStatus("No matches for \"" + title + "\" — try a different search or add it manually.");
        } else {
          setStatus("");
        }
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
        hideSearchForm();
        showConfirmPanel({
          category: state.category,
          title: item.title,
          image: item.image || "",
          meta: item.meta || "",
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
    el.confirmImage.src = match.image || "";
    el.confirmTitle.textContent = match.title;
    el.confirmMeta.textContent = match.meta || match.upc || "";
    el.confirmPanel.classList.remove("hidden");
  }

  function hideConfirmPanel() {
    state.pendingMatch = null;
    el.confirmPanel.classList.add("hidden");
  }

  // ---------- scanning ----------

  function startScan() {
    hideManualForm();
    hideSearchForm();
    hideConfirmPanel();

    if (SCAN_UNRELIABLE[state.category]) {
      setStatus("Barcodes rarely match " + CATEGORY_LABELS[state.category] + " — type the title instead.");
      showManualForm();
      return;
    }

    if (typeof Html5Qrcode === "undefined") {
      setStatus("Scanner library failed to load. Check your connection and reload.");
      return;
    }

    el.scannerWrap.classList.remove("hidden");
    setStatus("Point the camera at the barcode.");

    state.scanner = new Html5Qrcode("reader");
    state.scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 120 } },
        onScanSuccess,
        function () {} // ignore per-frame "not found" noise
      )
      .catch(function (err) {
        setStatus("Could not start camera: " + err);
        el.scannerWrap.classList.add("hidden");
      });
  }

  function stopScan() {
    el.scannerWrap.classList.add("hidden");
    if (state.scanner) {
      state.scanner.stop().catch(function () {}).then(function () {
        state.scanner.clear();
        state.scanner = null;
      });
    }
  }

  function onScanSuccess(decodedText) {
    stopScan();
    setStatus("Found code " + decodedText + " — looking it up...");
    lookupUpc(decodedText);
  }

  // ---------- lookup ----------

  function lookupUpc(upc) {
    var url = LOOKUP_PROXY_URL + "?upc=" + encodeURIComponent(upc);
    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var item = data && data.items && data.items[0];
        if (!item) {
          barcodeNotResolved(upc, "No match found for " + upc + ".");
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
        barcodeNotResolved(upc, "Lookup failed (offline or rate-limited).");
      });
  }

  // When the barcode can't be resolved: fall back to a title search for
  // categories that have one wired up, otherwise plain manual entry.
  function barcodeNotResolved(upc, reason) {
    if (SEARCH_KIND[state.category]) {
      setStatus(reason + " Type the title to search instead.");
      showSearchForm();
    } else {
      setStatus(reason + " Enter it manually.");
      el.titleInput.value = "";
      el.imageInput.value = "";
      el.notesInput.value = "UPC " + upc;
      showManualForm();
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
