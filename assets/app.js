/**
 * JSON Canvas app.
 *
 * The canvas document is the source of truth. The DOM is rendered from it and
 * every interaction mutates the document, never the DOM directly. That is the
 * inverse of the homepage demo, which reads positions back out of the DOM.
 *
 * Document shape is JSON Canvas 1.0 — see /spec/1.0.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config --
  var STORAGE_KEY = 'jsoncanvas.app.doc';
  var MIN_SCALE = 0.2;
  var MAX_SCALE = 2.5;
  var ZOOM_STEP = 0.15;
  var MIN_NODE_W = 120;
  var MIN_NODE_H = 60;
  var DEFAULT_NODE = { width: 260, height: 120 };

  // Spec preset colors "1".."6". Values are deliberately app-defined; these are
  // tuned to sit alongside the site's palette.
  var PRESET_COLORS = {
    '1': '#d1345b',
    '2': '#e07a3f',
    '3': '#d9a441',
    '4': '#3f8f5c',
    '5': '#3b8fa8',
    '6': '#8b0a5f'
  };

  var SEED_DOC = {
    nodes: [
      {
        id: 'a1b2c3d4e5f60001',
        type: 'text',
        x: -300,
        y: -170,
        width: 300,
        height: 190,
        text:
          '# Canvas notes\n\n' +
          'Double-click anywhere to make a note.\n\n' +
          'Double-click a note to edit it. **Markdown** works.'
      },
      {
        id: 'a1b2c3d4e5f60002',
        type: 'text',
        x: 100,
        y: -180,
        width: 280,
        height: 210,
        color: '6',
        text:
          '## Handling\n\n' +
          '- Drag the header to move\n' +
          '- Drag the corner to resize\n' +
          '- `Delete` removes a selection\n' +
          '- Scroll to pan, `Ctrl`+scroll to zoom'
      },
      {
        id: 'a1b2c3d4e5f60003',
        type: 'text',
        x: -110,
        y: 110,
        width: 300,
        height: 110,
        text: 'Everything you do here edits a JSON Canvas document. Open **JSON** to watch it change.'
      }
    ],
    edges: [
      {
        id: 'a1b2c3d4e5f6e001',
        fromNode: 'a1b2c3d4e5f60001',
        fromSide: 'right',
        toNode: 'a1b2c3d4e5f60002',
        toSide: 'left'
      }
    ]
  };

  // ----------------------------------------------------------------- state --
  var doc = { nodes: [], edges: [] };
  var view = { scale: 1, panX: 0, panY: 0 };
  var selectedId = null;
  var editingId = null;

  var els = {};
  var nodeEls = Object.create(null); // node id -> element

  // ----------------------------------------------------------------- utils --
  function uid() {
    var hex = '';
    var bytes = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function nodeById(id) {
    for (var i = 0; i < doc.nodes.length; i++) {
      if (doc.nodes[i].id === id) return doc.nodes[i];
    }
    return null;
  }

  /** Screen (client) coordinates -> canvas coordinates. */
  function toCanvas(clientX, clientY) {
    var rect = els.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.panX) / view.scale,
      y: (clientY - rect.top - view.panY) / view.scale
    };
  }

  function colorFor(value) {
    if (!value) return '';
    return PRESET_COLORS[value] || value;
  }

  // --------------------------------------------------------------- storage --
  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch (err) {
      /* storage unavailable or full; editing still works in-session */
    }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.nodes)) return null;
      if (!Array.isArray(parsed.edges)) parsed.edges = [];
      return parsed;
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------- render --
  function applyTransform() {
    els.viewport.style.setProperty('--scale', view.scale);
    els.viewport.style.setProperty('--pan-x', view.panX + 'px');
    els.viewport.style.setProperty('--pan-y', view.panY + 'px');
  }

  function nodeBodyHtml(node) {
    switch (node.type) {
      case 'text':
        return '<div class="node-body">' + window.CanvasMarkdown.render(node.text || '') + '</div>';
      case 'link': {
        var url = window.CanvasMarkdown.escapeHtml(node.url || '');
        var safe = /^https?:\/\//i.test(node.url || '') ? url : '';
        return (
          '<div class="node-body node-body-link">' +
          (safe
            ? '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + safe + '</a>'
            : '<span class="node-placeholder">' + (url || 'No URL') + '</span>') +
          '</div>'
        );
      }
      case 'file':
        return (
          '<div class="node-body node-body-file"><span class="node-placeholder">' +
          window.CanvasMarkdown.escapeHtml(node.file || 'No file') +
          '</span></div>'
        );
      case 'group':
        return '';
      default:
        return '';
    }
  }

  function nodeLabel(node) {
    if (node.type === 'group') return node.label || '';
    if (node.type === 'file') return node.file || 'file';
    if (node.type === 'link') return 'link';
    return 'note';
  }

  function createNodeEl(node) {
    var el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = node.id;

    var handle = document.createElement('div');
    handle.className = 'node-handle';

    var title = document.createElement('span');
    title.className = 'node-title';
    handle.appendChild(title);

    var remove = document.createElement('button');
    remove.className = 'node-delete';
    remove.type = 'button';
    remove.title = 'Delete node';
    remove.setAttribute('aria-label', 'Delete node');
    remove.textContent = '×';
    handle.appendChild(remove);

    var content = document.createElement('div');
    content.className = 'node-content';

    var resize = document.createElement('div');
    resize.className = 'node-resize';

    el.appendChild(handle);
    el.appendChild(content);
    el.appendChild(resize);
    els.nodes.appendChild(el);
    return el;
  }

  function updateNodeEl(el, node, index) {
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = node.width + 'px';
    el.style.height = node.height + 'px';
    el.style.zIndex = String(index + 1);
    el.classList.toggle('is-selected', node.id === selectedId);
    el.classList.toggle('is-editing', node.id === editingId);
    el.classList.add('node-type-' + node.type);

    var accent = colorFor(node.color);
    if (accent) el.style.setProperty('--node-accent', accent);
    else el.style.removeProperty('--node-accent');

    el.querySelector('.node-title').textContent = nodeLabel(node);

    // The editor owns the content while a node is being edited.
    if (node.id === editingId) return;

    var content = el.querySelector('.node-content');
    content.innerHTML = nodeBodyHtml(node);
  }

  function render() {
    var seen = Object.create(null);

    doc.nodes.forEach(function (node, index) {
      seen[node.id] = true;
      var el = nodeEls[node.id];
      if (!el) {
        el = createNodeEl(node);
        nodeEls[node.id] = el;
      }
      updateNodeEl(el, node, index);
    });

    Object.keys(nodeEls).forEach(function (id) {
      if (!seen[id]) {
        nodeEls[id].remove();
        delete nodeEls[id];
      }
    });

    renderEdges();
    renderOutput();
  }

  // ----------------------------------------------------------------- edges --
  function anchorPoint(node, side) {
    switch (side) {
      case 'top':
        return { x: node.x + node.width / 2, y: node.y };
      case 'right':
        return { x: node.x + node.width, y: node.y + node.height / 2 };
      case 'bottom':
        return { x: node.x + node.width / 2, y: node.y + node.height };
      case 'left':
        return { x: node.x, y: node.y + node.height / 2 };
      default:
        return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    }
  }

  /** fromSide/toSide are optional in the spec; pick the facing sides. */
  function inferSides(from, to) {
    var dx = to.x + to.width / 2 - (from.x + from.width / 2);
    var dy = to.y + to.height / 2 - (from.y + from.height / 2);
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? ['right', 'left'] : ['left', 'right'];
    }
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  function renderEdges() {
    var paths = els.edgePaths;
    paths.innerHTML = '';

    doc.edges.forEach(function (edge) {
      var from = nodeById(edge.fromNode);
      var to = nodeById(edge.toNode);
      if (!from || !to) return;

      var inferred = inferSides(from, to);
      var fromPoint = anchorPoint(from, edge.fromSide || inferred[0]);
      var toPoint = anchorPoint(to, edge.toSide || inferred[1]);

      var tightness = 0.75;
      var c1x = fromPoint.x + (toPoint.x - fromPoint.x) * tightness;
      var c2x = fromPoint.x + (toPoint.x - fromPoint.x) * (1 - tightness);

      var d =
        'M ' + fromPoint.x + ' ' + fromPoint.y +
        ' C ' + c1x + ' ' + fromPoint.y + ', ' + c2x + ' ' + toPoint.y +
        ', ' + toPoint.x + ' ' + toPoint.y;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      if (edge.color) path.setAttribute('stroke', colorFor(edge.color));
      if (edge.fromEnd === 'arrow') path.setAttribute('marker-start', 'url(#arrow-start)');
      // toEnd defaults to "arrow" per spec.
      if (edge.toEnd !== 'none') path.setAttribute('marker-end', 'url(#arrow-end)');

      paths.appendChild(path);
    });
  }

  // ---------------------------------------------------------------- output --
  function renderOutput() {
    if (els.output.hidden) return;
    var json = JSON.stringify(doc, null, 2);
    els.outputCode.textContent = json;
    if (window.Prism) window.Prism.highlightElement(els.outputCode);
  }

  // ------------------------------------------------------------- mutations --
  function commit() {
    render();
    save();
  }

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    render();
  }

  function bringToFront(node) {
    var index = doc.nodes.indexOf(node);
    if (index === -1 || index === doc.nodes.length - 1) return;
    doc.nodes.splice(index, 1);
    doc.nodes.push(node);
  }

  function addTextNode(canvasX, canvasY) {
    var node = {
      id: uid(),
      type: 'text',
      x: Math.round(canvasX - DEFAULT_NODE.width / 2),
      y: Math.round(canvasY - DEFAULT_NODE.height / 2),
      width: DEFAULT_NODE.width,
      height: DEFAULT_NODE.height,
      text: ''
    };
    doc.nodes.push(node);
    selectedId = node.id;
    commit();
    startEditing(node.id);
    return node;
  }

  function deleteNode(id) {
    var index = doc.nodes.findIndex(function (n) {
      return n.id === id;
    });
    if (index === -1) return;

    doc.nodes.splice(index, 1);
    // An edge cannot reference a node that no longer exists.
    doc.edges = doc.edges.filter(function (edge) {
      return edge.fromNode !== id && edge.toNode !== id;
    });

    if (selectedId === id) selectedId = null;
    if (editingId === id) editingId = null;
    commit();
  }

  // --------------------------------------------------------------- editing --
  function startEditing(id) {
    var node = nodeById(id);
    if (!node || node.type !== 'text') return;

    editingId = id;
    selectedId = id;
    render();

    var el = nodeEls[id];
    var content = el.querySelector('.node-content');
    content.innerHTML = '';

    var textarea = document.createElement('textarea');
    textarea.className = 'node-editor';
    textarea.value = node.text || '';
    textarea.spellcheck = false;
    content.appendChild(textarea);

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    textarea.addEventListener('blur', function () {
      stopEditing(id, textarea.value);
    });

    textarea.addEventListener('keydown', function (event) {
      event.stopPropagation(); // typing must not reach the canvas shortcuts
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        textarea.blur();
      }
    });

    // Editing shouldn't start a drag or a canvas pan.
    textarea.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });
  }

  function stopEditing(id, value) {
    if (editingId !== id) return;
    var node = nodeById(id);
    editingId = null;

    if (node) {
      var text = value.trim();
      // A note that was never given content is noise; drop it.
      if (!text) {
        deleteNode(id);
        return;
      }
      node.text = text;
    }
    commit();
  }

  // ---------------------------------------------------------- interactions --
  var drag = null;

  function onPointerDown(event) {
    if (event.button !== 0) return;

    var nodeEl = event.target.closest('.node');

    if (event.target.closest('.node-delete')) {
      event.preventDefault();
      deleteNode(nodeEl.dataset.id);
      return;
    }

    if (!nodeEl) {
      // Empty canvas: deselect, and drag to pan.
      if (editingId) return; // let the textarea blur commit first
      select(null);
      drag = {
        mode: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: view.panX,
        originY: view.panY
      };
      els.viewport.setPointerCapture(event.pointerId);
      els.viewport.classList.add('is-panning');
      return;
    }

    var node = nodeById(nodeEl.dataset.id);
    if (!node) return;

    select(node.id);

    if (event.target.closest('.node-resize')) {
      event.preventDefault();
      drag = {
        mode: 'resize',
        node: node,
        startX: event.clientX,
        startY: event.clientY,
        originW: node.width,
        originH: node.height
      };
      els.viewport.setPointerCapture(event.pointerId);
      return;
    }

    if (event.target.closest('.node-handle')) {
      event.preventDefault();
      bringToFront(node);
      drag = {
        mode: 'move',
        node: node,
        startX: event.clientX,
        startY: event.clientY,
        originX: node.x,
        originY: node.y
      };
      els.viewport.setPointerCapture(event.pointerId);
      nodeEls[node.id].classList.add('is-dragging');
      render();
    }
  }

  function onPointerMove(event) {
    if (!drag) return;

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;

    if (drag.mode === 'pan') {
      view.panX = drag.originX + dx;
      view.panY = drag.originY + dy;
      applyTransform();
      return;
    }

    if (drag.mode === 'move') {
      drag.node.x = Math.round(drag.originX + dx / view.scale);
      drag.node.y = Math.round(drag.originY + dy / view.scale);
      var el = nodeEls[drag.node.id];
      el.style.left = drag.node.x + 'px';
      el.style.top = drag.node.y + 'px';
      renderEdges();
      return;
    }

    if (drag.mode === 'resize') {
      drag.node.width = Math.round(Math.max(MIN_NODE_W, drag.originW + dx / view.scale));
      drag.node.height = Math.round(Math.max(MIN_NODE_H, drag.originH + dy / view.scale));
      var resizing = nodeEls[drag.node.id];
      resizing.style.width = drag.node.width + 'px';
      resizing.style.height = drag.node.height + 'px';
      renderEdges();
    }
  }

  function onPointerUp() {
    if (!drag) return;

    if (drag.mode === 'pan') {
      els.viewport.classList.remove('is-panning');
    } else {
      var el = nodeEls[drag.node.id];
      if (el) el.classList.remove('is-dragging');
      commit();
    }
    drag = null;
  }

  function onDoubleClick(event) {
    var nodeEl = event.target.closest('.node');

    if (nodeEl) {
      var node = nodeById(nodeEl.dataset.id);
      if (node && node.type === 'text') startEditing(node.id);
      return;
    }

    var point = toCanvas(event.clientX, event.clientY);
    addTextNode(point.x, point.y);
  }

  function zoomAt(clientX, clientY, nextScale) {
    var rect = els.viewport.getBoundingClientRect();
    var originX = clientX - rect.left;
    var originY = clientY - rect.top;

    var clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    var ratio = clamped / view.scale;

    // Keep the point under the cursor fixed while scaling.
    view.panX = originX - (originX - view.panX) * ratio;
    view.panY = originY - (originY - view.panY) * ratio;
    view.scale = clamped;
    applyTransform();
  }

  function onWheel(event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      var factor = event.deltaY > 0 ? 1 - ZOOM_STEP : 1 + ZOOM_STEP;
      zoomAt(event.clientX, event.clientY, view.scale * factor);
      return;
    }
    view.panX -= event.deltaX;
    view.panY -= event.deltaY;
    applyTransform();
  }

  function zoomFromCenter(factor) {
    var rect = els.viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, view.scale * factor);
  }

  function fitToContent() {
    if (!doc.nodes.length) {
      view.scale = 1;
      view.panX = els.viewport.clientWidth / 2;
      view.panY = els.viewport.clientHeight / 2;
      applyTransform();
      return;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    doc.nodes.forEach(function (node) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });

    var padding = 80;
    var boxW = maxX - minX;
    var boxH = maxY - minY;
    var viewW = els.viewport.clientWidth;
    var viewH = els.viewport.clientHeight;

    view.scale = clamp(
      Math.min(viewW / (boxW + padding * 2), viewH / (boxH + padding * 2)),
      MIN_SCALE,
      1
    );
    view.panX = (viewW - boxW * view.scale) / 2 - minX * view.scale;
    view.panY = (viewH - boxH * view.scale) / 2 - minY * view.scale;
    applyTransform();
  }

  function onKeyDown(event) {
    if (editingId) return;

    var target = event.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
      event.preventDefault();
      deleteNode(selectedId);
      return;
    }

    if (event.key === 'Enter' && selectedId) {
      event.preventDefault();
      startEditing(selectedId);
      return;
    }

    if (event.key === 'Escape') {
      select(null);
    }
  }

  // ------------------------------------------------------------------ init --
  function toggleOutput() {
    els.output.hidden = !els.output.hidden;
    els.toggleOutput.setAttribute('aria-expanded', String(!els.output.hidden));
    renderOutput();
  }

  function download() {
    var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'notes.canvas';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function init() {
    els.viewport = document.getElementById('app-viewport');
    els.nodes = document.getElementById('app-nodes');
    els.edgePaths = document.getElementById('app-edge-paths');
    els.output = document.getElementById('app-output');
    els.outputCode = document.getElementById('app-output-code');
    els.toggleOutput = document.getElementById('app-toggle-output');

    doc = load() || JSON.parse(JSON.stringify(SEED_DOC));

    els.viewport.addEventListener('pointerdown', onPointerDown);
    els.viewport.addEventListener('pointermove', onPointerMove);
    els.viewport.addEventListener('pointerup', onPointerUp);
    els.viewport.addEventListener('pointercancel', onPointerUp);
    els.viewport.addEventListener('dblclick', onDoubleClick);
    els.viewport.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    document.getElementById('app-add-node').addEventListener('click', function () {
      var rect = els.viewport.getBoundingClientRect();
      var center = toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
      addTextNode(center.x, center.y);
    });

    els.toggleOutput.addEventListener('click', toggleOutput);
    document.getElementById('app-close-output').addEventListener('click', toggleOutput);
    document.getElementById('app-zoom-in').addEventListener('click', function () {
      zoomFromCenter(1 + ZOOM_STEP);
    });
    document.getElementById('app-zoom-out').addEventListener('click', function () {
      zoomFromCenter(1 - ZOOM_STEP);
    });
    document.getElementById('app-zoom-fit').addEventListener('click', fitToContent);
    document.getElementById('app-download').addEventListener('click', download);

    document.getElementById('app-reset').addEventListener('click', function () {
      if (!window.confirm('Replace this canvas with the starter notes? Your changes will be lost.')) {
        return;
      }
      doc = JSON.parse(JSON.stringify(SEED_DOC));
      selectedId = null;
      editingId = null;
      commit();
      fitToContent();
    });

    render();
    fitToContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
