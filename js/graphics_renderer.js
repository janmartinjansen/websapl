/**
 * Sapl HTML5 Canvas Graphics Renderer & Mouse Event Dispatcher
 * Implements the Amanda / Sapl Graphics & Event Protocol:
 * - 16 VGA/EGA Color Palette
 * - Normalized [-1.0, 1.0] mathematical coordinate space (y-up, center at 0,0)
 * - Complete AST S-Expression parser for JMVM Constructor output
 * - Real-time Mouse & Keyboard Event Capture:
 *     MouseDown(p), MouseUp(p), MouseDragged(p), MouseDoubleClick(p), KeyIn(c)
 * - High-DPI (Retina) rendering support
 */

class SaplGraphicsRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // 16 VGA/EGA Color Palette
    this.palette = [
      '#000000', // 0: Black
      '#0000AA', // 1: Blue
      '#00AA00', // 2: Green
      '#00AAAA', // 3: Cyan
      '#AA0000', // 4: Red
      '#AA00AA', // 5: Magenta
      '#AA5500', // 6: Brown
      '#AAAAAA', // 7: Light Gray
      '#555555', // 8: Dark Gray
      '#5555FF', // 9: Bright Blue
      '#55FF55', // 10: Bright Green
      '#55FFFF', // 11: Bright Cyan
      '#FF5555', // 12: Bright Red
      '#FF55FF', // 13: Bright Magenta
      '#FFFF55', // 14: Yellow
      '#FFFFFF'  // 15: White
    ];

    this.isMouseDown = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.eventCallbacks = [];
    this.menuCallbacks = [];
    this.promptCallbacks = [];
    // Last menu structure this.renderOutput() saw - null until a run
    // actually outputs a GraphMenu. onMenu callbacks fire with this same
    // shape: [{ name, items: [string, ...] }, ...] (see the GraphMenu
    // case in drawGraphicsTokens for the wire format it's parsed from).
    this.lastMenu = null;
    this._lastMenuSerialized = null; // dedup guard, see emitMenu below

    // Canvas backdrop, independent of the page's dark/light UI theme (the
    // figure palette above is tuned for contrast against a dark-ish
    // backdrop, see graphics.html's .canvas-wrapper comment) - selectable
    // via the swatches in graphics.html's controls-panel.
    this.bgColor = '#0a0f1d';

    this.setupHighDPI();
    window.addEventListener('resize', () => this.setupHighDPI());
    this.initEventListeners();
  }

  setupHighDPI() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.width || 600;
    const height = rect.height || this.canvas.height || 600;

    this.canvas.width = Math.max(100, Math.floor(width * dpr));
    this.canvas.height = Math.max(100, Math.floor(height * dpr));
    if (this.ctx.setTransform) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else if (this.ctx.resetTransform) {
      this.ctx.resetTransform();
      this.ctx.scale(dpr, dpr);
    }
    this.displayWidth = Math.max(100, width);
    this.displayHeight = Math.max(100, height);
  }

  getColor(c) {
    const idx = Math.floor(c);
    if (idx >= 0 && idx < this.palette.length) {
      return this.palette[idx];
    }
    return this.palette[15];
  }

  // Coordinate mapping: [-1.0, 1.0] -> Canvas [0, width] x [0, height]
  toCanvasX(x) {
    return ((x + 1.0) / 2.0) * this.displayWidth;
  }

  toCanvasY(y) {
    return (1.0 - ((y + 1.0) / 2.0)) * this.displayHeight;
  }

  toCanvasCoord(x, y) {
    return { x: this.toCanvasX(x), y: this.toCanvasY(y) };
  }

  // Reverse mapping: Canvas coords -> Normalized [-1.0, 1.0]
  fromCanvasCoord(cx, cy) {
    const x = (cx / this.displayWidth) * 2.0 - 1.0;
    const y = 1.0 - (cy / this.displayHeight) * 2.0;
    return { x, y };
  }

  getEventPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    return this.fromCanvasCoord(cx, cy);
  }

  // --- Mouse & Keyboard Event System ---
  onEvent(callback) {
    this.eventCallbacks.push(callback);
  }

  emitEvent(event) {
    for (const cb of this.eventCallbacks) {
      cb(event);
    }
  }

  // A GraphMenu is a UI widget (a DOM menu bar), not something drawn on
  // the canvas - onMenu is the renderer's side of that split: the host
  // page (graphics.html) subscribes here to build/update its own menu
  // bar element whenever a run's output includes a GraphMenu, instead of
  // this class reaching into page DOM it doesn't own.
  onMenu(callback) {
    this.menuCallbacks.push(callback);
  }

  emitMenu(cats) {
    // grafisch/graphics.cfp's own interactive demos re-emit their WHOLE
    // drawing (menu included) on every single tick, not just when
    // something actually changed (see docs/2026-08-31_interactieve_
    // grafische_architectuur.md's state-per-event protocol) - and a
    // MouseDragged tick fires many times a second. Without this guard,
    // every one of those ticks rebuilt the menu-bar DOM from scratch
    // (graphics.html's onMenu subscriber does `bar.innerHTML = ''` and
    // recreates every button), which reset any open dropdown's `hidden`
    // state back to closed before the user could click an item inside
    // it - the menu LOOKED like static, undraggable canvas art rather
    // than a real clickable dropdown, because it effectively never
    // stayed open. Skip the rebuild (and the onMenu callbacks) entirely
    // when the menu's own content hasn't actually changed since last
    // time; graphics.html's DOM keeps whatever open/closed state it
    // already has.
    const serialized = JSON.stringify(cats);
    if (this._lastMenuSerialized === serialized) return;
    this._lastMenuSerialized = serialized;
    this.lastMenu = cats;
    for (const cb of this.menuCallbacks) {
      cb(cats);
    }
  }

  // GraphPrompt is the other non-canvas widget (a text-input dialog) -
  // same split as onMenu/emitMenu above: the host page owns the actual
  // dialog DOM, this just hands it the (title, defaultText) pair.
  onPrompt(callback) {
    this.promptCallbacks.push(callback);
  }

  emitPrompt(title, deflt) {
    for (const cb of this.promptCallbacks) {
      cb(title, deflt);
    }
  }

  initEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      const p = this.getEventPoint(e);
      this.lastMousePos = p;
      this.emitEvent({
        type: 'MouseDown',
        p: p,
        raw: e,
        saplConstructor: `(constr_1: (constr_0: ${p.x.toFixed(4)} ${p.y.toFixed(4)}))`
      });
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown) return;
      const p = this.getEventPoint(e);
      const dx = p.x - this.lastMousePos.x;
      const dy = p.y - this.lastMousePos.y;
      this.lastMousePos = p;
      this.emitEvent({
        type: 'MouseDragged',
        p: p,
        delta: { x: dx, y: dy },
        raw: e,
        saplConstructor: `(constr_3: (constr_0: ${p.x.toFixed(4)} ${p.y.toFixed(4)}))`
      });
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isMouseDown) return;
      this.isMouseDown = false;
      const p = this.getEventPoint(e);
      this.emitEvent({
        type: 'MouseUp',
        p: p,
        raw: e,
        saplConstructor: `(constr_2: (constr_0: ${p.x.toFixed(4)} ${p.y.toFixed(4)}))`
      });
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const p = this.getEventPoint(e);
      this.emitEvent({
        type: 'MouseDoubleClick',
        p: p,
        raw: e,
        saplConstructor: `(constr_4: (constr_0: ${p.x.toFixed(4)} ${p.y.toFixed(4)}))`
      });
    });

    window.addEventListener('keydown', (e) => {
      if (document.activeElement === this.canvas || document.activeElement === document.body) {
        this.emitEvent({
          type: 'KeyIn',
          c: e.key,
          raw: e,
          saplConstructor: `(constr_0: "${e.key}")`
        });
      }
    });
  }

  setBgColor(color) {
    this.bgColor = color;
  }

  clear(bgColor = this.bgColor) {
    this.ctx.save();
    this.ctx.fillStyle = bgColor;
    this.ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
    this.ctx.restore();
  }

  drawGrid() {
    this.ctx.save();
    this.ctx.strokeStyle = '#1e293b';
    this.ctx.lineWidth = 1;

    for (let x = -1.0; x <= 1.0; x += 0.2) {
      const p1 = this.toCanvasCoord(x, -1.0);
      const p2 = this.toCanvasCoord(x, 1.0);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    for (let y = -1.0; y <= 1.0; y += 0.2) {
      const p1 = this.toCanvasCoord(-1.0, y);
      const p2 = this.toCanvasCoord(1.0, y);
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    // Axes
    this.ctx.strokeStyle = '#334155';
    this.ctx.lineWidth = 1.5;
    const x0 = this.toCanvasCoord(-1.0, 0);
    const x1 = this.toCanvasCoord(1.0, 0);
    const y0 = this.toCanvasCoord(0, -1.0);
    const y1 = this.toCanvasCoord(0, 1.0);

    this.ctx.beginPath();
    this.ctx.moveTo(x0.x, x0.y);
    this.ctx.lineTo(x1.x, x1.y);
    this.ctx.moveTo(y0.x, y0.y);
    this.ctx.lineTo(y1.x, y1.y);
    this.ctx.stroke();

    this.ctx.restore();
  }

  drawPolyLine(color, points) {
    if (!points || points.length < 2) return;
    this.ctx.save();
    this.ctx.strokeStyle = this.getColor(color);
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    const start = this.toCanvasCoord(points[0].x, points[0].y);
    this.ctx.moveTo(start.x, start.y);
    for (let i = 1; i < points.length; i++) {
      const pt = this.toCanvasCoord(points[i].x, points[i].y);
      this.ctx.lineTo(pt.x, pt.y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawPolygon(color, points, filled = false) {
    if (!points || points.length < 2) return;
    this.ctx.save();
    this.ctx.beginPath();
    const start = this.toCanvasCoord(points[0].x, points[0].y);
    this.ctx.moveTo(start.x, start.y);
    for (let i = 1; i < points.length; i++) {
      const pt = this.toCanvasCoord(points[i].x, points[i].y);
      this.ctx.lineTo(pt.x, pt.y);
    }
    this.ctx.closePath();
    if (filled) {
      this.ctx.fillStyle = this.getColor(color);
      this.ctx.fill();
    } else {
      this.ctx.strokeStyle = this.getColor(color);
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawRectangle(color, p1, p2, filled = false) {
    this.ctx.save();
    const c1 = this.toCanvasCoord(p1.x, p1.y);
    const c2 = this.toCanvasCoord(p2.x, p2.y);
    const x = Math.min(c1.x, c2.x);
    const y = Math.min(c1.y, c2.y);
    const w = Math.abs(c2.x - c1.x);
    const h = Math.abs(c2.y - c1.y);

    if (filled) {
      this.ctx.fillStyle = this.getColor(color);
      this.ctx.fillRect(x, y, w, h);
    } else {
      this.ctx.strokeStyle = this.getColor(color);
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(x, y, w, h);
    }
    this.ctx.restore();
  }

  drawEllipse(color, p1, p2, filled = false) {
    this.ctx.save();
    const c1 = this.toCanvasCoord(p1.x, p1.y);
    const c2 = this.toCanvasCoord(p2.x, p2.y);
    const cx = (c1.x + c2.x) / 2.0;
    const cy = (c1.y + c2.y) / 2.0;
    const rx = Math.abs(c2.x - c1.x) / 2.0;
    const ry = Math.abs(c2.y - c1.y) / 2.0;

    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, 2 * Math.PI);
    if (filled) {
      this.ctx.fillStyle = this.getColor(color);
      this.ctx.fill();
    } else {
      this.ctx.strokeStyle = this.getColor(color);
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawDisc(color, p1, p2) {
    this.drawEllipse(color, p1, p2, true);
  }

  drawText(color, p, text) {
    this.ctx.save();
    this.ctx.fillStyle = this.getColor(color);
    this.ctx.font = '13px "Courier New", Courier, monospace';
    const c = this.toCanvasCoord(p.x, p.y);
    this.ctx.fillText(text, c.x, c.y);
    this.ctx.restore();
  }

  /**
   * Extracts the payload of the `(string: ...)` wrapper the VM prints
   * around a top-level packed-array result (see printdebug.cpp's STR
   * case) - i.e. the flat text `graphicsout` (grafisch/graphics.cfp)
   * produced. Uses paren-counting, not indexOf(')'), because GraphText
   * labels can themselves contain literal parens (e.g. "... (Logic
   * Circuit)" in grafisch/hwdes.cfp).
   *
   * The state-per-event interactive demos (bspline/convex/boom) don't
   * go through this auto-printed path at all: their `start` calls
   * `printString` directly (see grafisch/bspline.cfp), which writes
   * the raw graphicsout text with no `(string: ...)` wrapper - so when
   * that wrapper isn't found, treat the whole text as already being
   * the content instead of returning null (which used to make
   * renderOutput silently draw nothing but the grid).
   */
  extractGraphicsOutContent(text) {
    const resIdx = text.indexOf("res:");
    const searchFrom = resIdx !== -1 ? resIdx + 4 : 0;
    const strIdx = text.indexOf("(string:", searchFrom);
    if (strIdx === -1) return text.trim();
    let i = strIdx + 8;
    const start = i;
    let pCount = 1;
    while (i < text.length && pCount > 0) {
      if (text[i] === '(') pCount++;
      else if (text[i] === ')') pCount--;
      i++;
    }
    return text.substring(start, i - 1).trim();
  }

  /**
   * Tokenizes graphicsout's flat, space-separated protocol. A
   * `"..."` run (a GraphText label) is kept as one 'text' token,
   * spaces and all; everything else splits on whitespace.
   */
  tokenizeGraphicsOut(content) {
    const tokens = [];
    let i = 0;
    while (i < content.length) {
      while (i < content.length && /\s/.test(content[i])) i++;
      if (i >= content.length) break;
      if (content[i] === '"') {
        const start = i + 1;
        let j = start;
        while (j < content.length && content[j] !== '"') j++;
        tokens.push({ type: 'text', value: content.substring(start, j) });
        i = j + 1;
      } else {
        const start = i;
        while (i < content.length && !/\s/.test(content[i])) i++;
        tokens.push({ type: 'word', value: content.substring(start, i) });
      }
    }
    return tokens;
  }

  /**
   * Walks graphicsout's token stream and issues the matching draw
   * call per item. Dispatch is on the REAL constructor name (e.g.
   * "GraphPolyLine"), not a positional `constr_N` index - see
   * grafisch/graphics.cfp's `graphicsout` for the producing side and
   * why that matters.
   */
  drawGraphicsTokens(tokens) {
    let pos = 0;
    const nextWord = () => tokens[pos++].value;
    const nextNum = () => parseFloat(nextWord());
    const nextPt = () => ({ x: nextNum(), y: nextNum() });

    while (pos < tokens.length) {
      const tag = nextWord();
      if (tag === "GraphClear") {
        this.clear();
        this.drawGrid();
      } else if (tag === "GraphPolyLine" || tag === "GraphPolygon") {
        const color = nextNum();
        const n = parseInt(nextWord(), 10) || 0;
        const pts = [];
        for (let k = 0; k < n; k++) pts.push(nextPt());
        if (pts.length > 0) {
          if (tag === "GraphPolyLine") this.drawPolyLine(color, pts);
          else this.drawPolygon(color, pts, false);
        }
      } else if (tag === "GraphRectangle" || tag === "GraphEllipse" || tag === "GraphDisc") {
        const color = nextNum();
        const p1 = nextPt();
        const p2 = nextPt();
        if (tag === "GraphRectangle") this.drawRectangle(color, p1, p2, false);
        else if (tag === "GraphEllipse") this.drawEllipse(color, p1, p2, false);
        else this.drawDisc(color, p1, p2);
      } else if (tag === "GraphText") {
        const color = nextNum();
        const p = nextPt();
        const txt = (tokens[pos] && tokens[pos].type === 'text') ? tokens[pos++].value : "";
        this.drawText(color, p, txt);
      } else if (tag === "GraphMenu") {
        // A UI widget, not a canvas draw - see grafisch/graphics.cfp's
        // menuCatsChars for the producing side: `<nCats> <"name">
        // <nItems> <"item"> ...` per category, repeated. Handed off via
        // emitMenu() instead of drawn; the host page owns the actual
        // menu-bar DOM (onMenu subscriber in graphics.html).
        const nCats = parseInt(nextWord(), 10) || 0;
        const cats = [];
        for (let c = 0; c < nCats; c++) {
          const name = nextWord();
          const nItems = parseInt(nextWord(), 10) || 0;
          const items = [];
          for (let k = 0; k < nItems; k++) items.push(nextWord());
          cats.push({ name, items });
        }
        this.emitMenu(cats);
      } else if (tag === "GraphPrompt") {
        // Also a UI widget, not a canvas draw - grafisch/graphics.cfp's
        // itemChars emits `<"title"> <"default">`; the host page's own
        // dialog (onPrompt subscriber in graphics.html) sends the answer
        // back as a RAW `PText <text>` stdin line (not through
        // encodeEventForSapl/queueTick's usual space-joined-words shape
        // - graphics.cfp's parseEvent special-cases PText to take the
        // rest of the line verbatim, since prompt text may itself
        // contain spaces).
        const title = nextWord();
        const deflt = nextWord();
        this.emitPrompt(title, deflt);
      } else {
        console.warn("Graphics render: unrecognized tag, stopping:", tag);
        break;
      }
    }
  }

  /**
   * Main render entrypoint
   */
  renderOutput(text) {
    this.setupHighDPI();
    this.clear();
    this.drawGrid();

    if (!text || typeof text !== 'string') return;

    try {
      const content = this.extractGraphicsOutContent(text);
      if (content === null) return;
      const tokens = this.tokenizeGraphicsOut(content);
      this.drawGraphicsTokens(tokens);
    } catch (err) {
      console.warn("Graphics render error:", err);
    }
  }
}

if (typeof window !== 'undefined') {
  window.SaplGraphicsRenderer = SaplGraphicsRenderer;
}
