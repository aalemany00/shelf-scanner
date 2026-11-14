/* Shelf Scanner — physical comic long-box interface.
 * Uses the existing collection items and item-details callback; no new storage.
 */
(function (global) {
  'use strict';

  var PAGE_SIZE = 15;
  var singlesKey = '__singles__';
  var current = { box: null, page: 0, picked: null };
  var ctx = null;
  var opening = false;

  function make(tag, className, label) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (label !== undefined) el.textContent = label;
    return el;
  }

  function button(className, label, handler) {
    var b = make('button', className, label);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  }

  function image(src, cls) {
    var img = document.createElement('img');
    img.className = cls || '';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (src) {
      img.src = src;
      img.addEventListener('error', function () { img.style.display = 'none'; }, { once: true });
    } else {
      img.style.display = 'none';
    }
    return img;
  }

  function issueNo(it) {
    var m = (it.title || '').match(/(?:#|\b(?:issue|no\.?|number)\s*)(\d+(?:\.\d+)?)/i);
    return m ? Number(m[1]) : null;
  }

  function issueLabel(it) {
    var num = issueNo(it);
    return num === null ? 'SINGLE ISSUE' : 'ISSUE #' + num;
  }

  function boxesFrom(items) {
    var groups = new Map();
    items.forEach(function (it) {
      var label = String(it.seriesName || '').trim();
      var key = label ? label.toLowerCase() : singlesKey;
      if (!groups.has(key)) groups.set(key, { key: key, label: label || 'Singles & One-Shots', items: [] });
      groups.get(key).items.push(it);
    });
    var boxes = Array.from(groups.values());
    boxes.forEach(function (box) {
      box.items.sort(function (a, b) {
        var na = issueNo(a), nb = issueNo(b);
        if (na !== null && nb !== null && na !== nb) return na - nb;
        if (na !== null && nb === null) return -1;
        if (na === null && nb !== null) return 1;
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true });
      });
    });
    boxes.sort(function (a, b) {
      if (a.key === singlesKey) return 1;
      if (b.key === singlesKey) return -1;
      return a.label.localeCompare(b.label);
    });
    return boxes;
  }

  function render(target, items, onItem) {
    ctx = { target: target, items: items, onItem: onItem };
    target.innerHTML = '';
    var root = make('div', 'clb-app');
    target.appendChild(root);
    var boxes = boxesFrom(items);
    if (!boxes.length) {
      current.box = null;
      renderEmpty(root);
      return;
    }
    var active = boxes.find(function (box) { return box.key === current.box; });
    if (current.box && !active) current.box = null;
    if (active) renderOpen(root, active, boxes.length);
    else renderRoom(root, boxes);
  }

  function redraw() {
    if (ctx) render(ctx.target, ctx.items, ctx.onItem);
  }

  function renderEmpty(root) {
    var empty = make('div', 'clb-empty');
    empty.appendChild(make('div', 'clb-empty-mark', '▤'));
    empty.appendChild(make('h3', '', 'An empty archive, for now.'));
    empty.appendChild(make('p', '', 'Add a comic to start filling your first long box.'));
    root.appendChild(empty);
  }

  function intro(kicker, heading, detail) {
    var title = make('div', 'clb-section-heading');
    var left = make('div');
    left.appendChild(make('span', 'clb-eyebrow', kicker));
    left.appendChild(make('h2', 'clb-main-title', heading));
    if (detail) left.appendChild(make('p', 'clb-heading-detail', detail));
    title.appendChild(left);
    return title;
  }

  function renderRoom(root, boxes) {
    var total = boxes.reduce(function (n, box) { return n + box.items.length; }, 0);
    var heading = intro('コレクション · LONG BOX ARCHIVE', 'The Comic Vault', 'A box for every series. Pick one to start digging.');
    var stats = make('div', 'clb-archive-stats');
    stats.appendChild(make('strong', '', String(boxes.length).padStart(2, '0')));
    stats.appendChild(make('span', '', 'BOXES'));
    stats.appendChild(make('i', '', '·'));
    stats.appendChild(make('strong', '', String(total).padStart(2, '0')));
    stats.appendChild(make('span', '', 'ISSUES'));
    heading.appendChild(stats);
    root.appendChild(heading);

    var tray = make('div', 'clb-archive-tray');
    var shelf = make('div', 'clb-box-grid');
    boxes.forEach(function (box, index) { shelf.appendChild(buildClosedBox(box, index, shelf)); });
    tray.appendChild(shelf);
    tray.appendChild(make('div', 'clb-tray-footer', 'ARCHIVED WITH CARE   ✦   OPEN A BOX TO FLIP THROUGH ITS ISSUES'));
    root.appendChild(tray);
  }

  function buildClosedBox(box, index, shelf) {
    var tile = make('button', 'clb-box-tile');
    tile.type = 'button';
    tile.style.setProperty('--box-order', String(index));
    tile.setAttribute('aria-label', 'Open ' + box.label + ', ' + box.items.length + ' comics');

    var housing = make('div', 'clb-box-housing');
    var well = make('div', 'clb-box-well');
    var stack = make('div', 'clb-box-stacked-edges');
    // White bagged-and-boarded edges: every physical stripe is just decoration.
    for (var i = 0; i < 19; i++) {
      var edge = make('span', 'clb-packed-edge');
      edge.style.setProperty('--line-offset', (i % 5) + 'px');
      stack.appendChild(edge);
    }
    well.appendChild(stack);
    var sample = box.items[0];
    var cover = make('div', 'clb-box-preview-cover');
    cover.appendChild(image(sample.image, ''));
    var fallback = make('span', 'clb-box-preview-fallback', (sample.title || box.label).slice(0, 34));
    cover.appendChild(fallback);
    well.appendChild(cover);
    housing.appendChild(well);

    // The closed lid is its own layer: it slips off when opening a box.
    var lid = make('div', 'clb-box-lid');
    lid.appendChild(make('span', 'clb-lid-tape'));
    lid.appendChild(make('span', 'clb-lid-small', 'COLLECTOR SERIES  /  FILED NO. ' + String(index + 1).padStart(2, '0')));
    lid.appendChild(make('strong', 'clb-lid-title', box.label));
    lid.appendChild(make('span', 'clb-lid-rule'));
    lid.appendChild(make('span', 'clb-lid-bottom', 'LIFT TO EXPLORE   ↗'));
    housing.appendChild(lid);
    var wall = make('div', 'clb-box-short-wall');
    var tag = make('div', 'clb-box-front-label');
    tag.appendChild(make('b', '', box.label));
    tag.appendChild(make('small', '', box.items.length + (box.items.length === 1 ? ' ISSUE' : ' ISSUES')));
    wall.appendChild(tag);
    wall.appendChild(make('div', 'clb-box-handle'));
    housing.appendChild(wall);
    tile.appendChild(housing);

    var caption = make('div', 'clb-box-caption');
    caption.appendChild(make('strong', '', box.label));
    caption.appendChild(make('span', '', box.items.length + (box.items.length === 1 ? ' comic' : ' comics')));
    tile.appendChild(caption);

    tile.addEventListener('click', function () {
      if (opening) return;
      opening = true;
      shelf.classList.add('clb-room-exiting');
      tile.classList.add('clb-box-opening');
      var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      global.setTimeout(function () {
        current.box = box.key;
        current.page = 0;
        current.picked = null;
        opening = false;
        redraw();
      }, reduced ? 0 : 300);
    });
    return tile;
  }

  function renderOpen(root, box, boxCount) {
    var head = make('div', 'clb-open-head');
    head.appendChild(button('clb-back-button', '‹  ALL BOXES', function () {
      current.box = null;
      current.picked = null;
      redraw();
    }));
    var meta = make('div', 'clb-open-label');
    meta.appendChild(make('span', 'clb-eyebrow', 'OPEN BOX   /   ' + boxCount + ' IN THE ARCHIVE'));
    meta.appendChild(make('h2', '', box.label));
    meta.appendChild(make('p', '', box.items.length + ' carefully filed ' + (box.items.length === 1 ? 'issue' : 'issues') + ' · Hover to pull a comic forward. Click to inspect.'));
    head.appendChild(meta);
    root.appendChild(head);

    var scene = make('section', 'clb-open-scene');
    var desk = make('div', 'clb-desk-mat');
    var stamp = make('div', 'clb-desk-stamp', 'THE COMIC VAULT  /  SHELF SCANNER');
    desk.appendChild(stamp);
    scene.appendChild(desk);

    var layout = make('div', 'clb-open-layout');
    var boxShell = make('div', 'clb-open-shell');
    var boxFrame = make('div', 'clb-open-frame');
    boxFrame.appendChild(make('div', 'clb-far-wall'));
    var well = make('div', 'clb-open-well');
    well.appendChild(make('div', 'clb-well-lining'));
    var stack = make('div', 'clb-open-stack');
    var totalPages = Math.max(1, Math.ceil(box.items.length / PAGE_SIZE));
    current.page = Math.max(0, Math.min(current.page, totalPages - 1));
    var first = current.page * PAGE_SIZE;
    var shown = box.items.slice(first, first + PAGE_SIZE);
    var selectedBox = null;
    var selectedIssue = null;
    var isTouch = global.matchMedia && global.matchMedia('(hover: none)').matches;

    function selectIssue(it, tile) {
      if (selectedBox && selectedBox !== tile) selectedBox.classList.remove('clb-is-pulled');
      selectedBox = tile;
      selectedIssue = it;
      tile.classList.add('clb-is-pulled');
      current.picked = it.id;
      updateSelection(it);
    }
    function releaseIssue() {
      // Retract only when leaving the whole stack; retracting on each
      // edge's pointerleave can flicker when the issue itself moves.
      if (!isTouch && selectedBox) {
        selectedBox.classList.remove('clb-is-pulled');
        selectedBox = null;
        selectedIssue = null;
        current.picked = null;
        updateSelection(null);
      }
    }
    function updateSelection(it) {
      var label = scene.querySelector('.clb-current-selection');
      if (!label) return;
      label.querySelector('.clb-current-number').textContent = it ? issueLabel(it) : 'BROWSE THE STACK';
      label.querySelector('.clb-current-name').textContent = it ? (it.title || 'Untitled comic') : 'Pick an issue';
      label.querySelector('.clb-current-help').textContent = it ? 'Click to see cover details and collection information.' : 'Move your pointer across the white edges to lift a comic out.';
    }

    shown.forEach(function (item, index) {
      var comic = make('button', 'clb-comic');
      comic.type = 'button';
      comic.style.setProperty('--comic-index', String(index));
      comic.style.setProperty('--comic-z', String(index + 1));
      comic.style.setProperty('--sleeve-hue', String(index % 4));
      comic.setAttribute('aria-label', 'Inspect ' + (item.title || 'Comic issue'));
      comic.setAttribute('title', item.title || 'Comic issue');
      var board = make('span', 'clb-comic-board');
      comic.appendChild(board);
      var art = make('span', 'clb-comic-art');
      art.appendChild(image(item.image, 'clb-comic-image'));
      art.appendChild(make('span', 'clb-comic-fallback', (item.title || 'COMIC').slice(0, 38)));
      comic.appendChild(art);
      var spine = make('span', 'clb-comic-ridge');
      spine.appendChild(make('span', '', issueLabel(item)));
      comic.appendChild(spine);
      comic.appendChild(make('span', 'clb-comic-sleeve'));
      comic.addEventListener('pointerenter', function () { if (!isTouch) selectIssue(item, comic); });
      comic.addEventListener('focus', function () { if (!isTouch) selectIssue(item, comic); });
      comic.addEventListener('click', function () {
        if (isTouch && selectedIssue !== item) {
          selectIssue(item, comic);
          return;
        }
        ctx.onItem(item);
      });
      stack.appendChild(comic);
    });

    // Small variations in the stack depth preserve the long-box silhouette.
    stack.addEventListener('pointerleave', releaseIssue);
    stack.style.setProperty('--stack-count', String(shown.length));
    well.appendChild(stack);
    boxFrame.appendChild(well);
    boxFrame.appendChild(make('div', 'clb-short-wall clb-short-wall-near'));
    boxFrame.appendChild(make('div', 'clb-open-handle'));
    boxShell.appendChild(boxFrame);
    boxShell.appendChild(make('div', 'clb-box-floor-note', 'BAGGED  •  BOARDED  •  SORTED'));
    layout.appendChild(boxShell);

    var info = make('aside', 'clb-open-sidebar');
    info.appendChild(make('span', 'clb-side-overline', 'THE ISSUE FINDER  /  001'));
    var selected = make('div', 'clb-current-selection');
    selected.appendChild(make('span', 'clb-current-number', 'BROWSE THE STACK'));
    selected.appendChild(make('h3', 'clb-current-name', 'Pick an issue'));
    selected.appendChild(make('p', 'clb-current-help', 'Move your pointer across the white edges to lift a comic out.'));
    info.appendChild(selected);
    var guide = make('div', 'clb-instruction-card');
    guide.appendChild(make('b', '', 'HOW TO FLIP THROUGH'));
    guide.appendChild(make('p', '', 'Hover over the thin bagged edges. The issue slides out of the box to show its cover.'));
    guide.appendChild(make('p', '', 'Click the comic to open your existing details panel. On touch screens, tap once to pull it forward, then again to inspect.'));
    info.appendChild(guide);
    var pageHead = make('div', 'clb-page-heading');
    pageHead.appendChild(make('span', '', 'FILING RANGE'));
    pageHead.appendChild(make('strong', '', String(first + 1).padStart(2, '0') + ' — ' + String(first + shown.length).padStart(2, '0')));
    info.appendChild(pageHead);
    var controls = make('div', 'clb-pagination');
    var prev = button('clb-page-btn', '‹  PREV', function () { current.page--; current.picked = null; redraw(); });
    prev.disabled = current.page === 0;
    var counter = make('span', '', 'STACK ' + (current.page + 1) + '/' + totalPages);
    var next = button('clb-page-btn', 'NEXT  ›', function () { current.page++; current.picked = null; redraw(); });
    next.disabled = current.page + 1 >= totalPages;
    controls.append(prev, counter, next);
    info.appendChild(controls);
    info.appendChild(make('div', 'clb-side-footer', 'YOUR COLLECTION, YOUR STORY.'));
    layout.appendChild(info);
    scene.appendChild(layout);
    root.appendChild(scene);
  }

  // Native browser back is not used because the app uses in-page tabs.
  // Escape collapses just the open box, without interfering with item overlays.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !current.box) return;
    var details = document.getElementById('itemOverlay');
    if (details && !details.classList.contains('hidden')) return;
    if (event.target.closest && event.target.closest('input, textarea, select')) return;
    current.box = null;
    current.picked = null;
    redraw();
  });

  global.ComicLongBoxes = { render: render };
})(window);