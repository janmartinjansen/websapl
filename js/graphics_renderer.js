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

  clear(bgColor = '#0a0f1d') {
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
   * Parse S-Expression AST from JMVM constructor output
   */
  parseAST(text) {
    const tokens = text.replace(/\(/g, " ( ").replace(/\)/g, " ) ").replace(/\[/g, " [ ").replace(/\]/g, " ] ").trim().split(/\s+/);
    let pos = 0;

    function parseExpr() {
      if (pos >= tokens.length) return null;
      const token = tokens[pos++];
      if (token === "(") {
        const items = [];
        while (pos < tokens.length && tokens[pos] !== ")") {
          items.push(parseExpr());
        }
        pos++; // skip ")"
        return items;
      } else if (token === "[") {
        let depth = 1;
        while (pos < tokens.length && depth > 0) {
          if (tokens[pos] === "[") depth++;
          else if (tokens[pos] === "]") depth--;
          pos++;
        }
        return null;
      } else if (token === ")") {
        return null;
      } else {
        return token;
      }
    }

    const resIdx = tokens.indexOf("res:");
    if (resIdx !== -1) pos = resIdx + 1;
    return parseExpr();
  }

  extractList(node) {
    const items = [];
    let curr = node;
    while (curr && Array.isArray(curr) && (curr[0] === "constr_1:" || curr[0] === "constr_1")) {
      if (curr[1]) items.push(curr[1]);
      curr = curr[2];
    }
    return items;
  }

  extractPt(node) {
    if (Array.isArray(node) && (node[0] === "constr_0:" || node[0] === "constr_0")) {
      return { x: parseFloat(node[1]) || 0, y: parseFloat(node[2]) || 0 };
    }
    return null;
  }

  extractPoints(node) {
    const pts = [];
    const list = this.extractList(node);
    for (const item of list) {
      const pt = this.extractPt(item);
      if (pt) pts.push(pt);
    }
    return pts;
  }

  /**
   * Main render entrypoint
   */
  renderOutput(text) {
    this.clear();
    this.drawGrid();

    if (!text || typeof text !== 'string') return;

    try {
      const ast = this.parseAST(text);
      if (!ast) return;

      const items = this.extractList(ast);
      for (const item of items) {
        if (!Array.isArray(item)) continue;
        const tag = item[0].replace(":", "");
        if (tag === "constr_1" || tag === "GraphPolyLine") {
          const color = parseFloat(item[1]) || 1;
          const pts = this.extractPoints(item[2]);
          if (pts.length > 0) this.drawPolyLine(color, pts);
        } else if (tag === "constr_2" || tag === "GraphPolygon") {
          const color = parseFloat(item[1]) || 2;
          const pts = this.extractPoints(item[2]);
          if (pts.length > 0) this.drawPolygon(color, pts, false);
        } else if (tag === "constr_3" || tag === "GraphRectangle") {
          const color = parseFloat(item[1]) || 4;
          const p1 = this.extractPt(item[2]) || { x: 0, y: 0 };
          const p2 = this.extractPt(item[3]) || { x: 0, y: 0 };
          this.drawRectangle(color, p1, p2, false);
        } else if (tag === "constr_4" || tag === "GraphEllipse") {
          const color = parseFloat(item[1]) || 5;
          const p1 = this.extractPt(item[2]) || { x: 0, y: 0 };
          const p2 = this.extractPt(item[3]) || { x: 0, y: 0 };
          this.drawEllipse(color, p1, p2, false);
        } else if (tag === "constr_5" || tag === "GraphDisc") {
          const color = parseFloat(item[1]) || 12;
          const p1 = this.extractPt(item[2]) || { x: 0, y: 0 };
          const p2 = this.extractPt(item[3]) || { x: 0, y: 0 };
          this.drawDisc(color, p1, p2);
        } else if (tag === "constr_0" || tag === "GraphText") {
          const color = parseFloat(item[1]) || 15;
          const p = this.extractPt(item[2]) || { x: 0, y: 0 };
          const txt = item[3] ? String(item[3]).replace(/string:\s*/, "") : "";
          this.drawText(color, p, txt);
        } else if (tag === "constr_6" || tag === "GraphClear") {
          this.clear();
          this.drawGrid();
        }
      }
    } catch (err) {
      console.warn("Graphics render error:", err);
    }
  }
}

if (typeof window !== 'undefined') {
  window.SaplGraphicsRenderer = SaplGraphicsRenderer;
}
