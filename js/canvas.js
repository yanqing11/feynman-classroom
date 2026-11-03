/**
 * Pointer-events handwriting pad: mouse, touch, and stylus (Apple Pencil) friendly.
 * Strokes are kept in CSS pixels so undo/redraw stays crisp on high-DPI screens.
 */
export class HandwritingPad {
  constructor(canvas, { placeholder, onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.placeholder = placeholder || null;
    this.onChange = onChange || (() => {});
    this.strokes = [];
    this.current = null;
    this.color = '#1f2a2a';
    this.width = 2.6;
    this.eraser = false;
    this.widthCss = 0;
    this.heightCss = 0;
    this.dpr = 1;
    this.pointerId = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.resize = this.resize.bind(this);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave', (event) => {
      if (this.pointerId !== null && event.buttons === 0) this.handlePointerUp(event);
    });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const oldWidth = this.widthCss || rect.width;
    const oldHeight = this.heightCss || rect.height;
    this.widthCss = rect.width;
    this.heightCss = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    if (this.strokes.length && (oldWidth !== rect.width || oldHeight !== rect.height)) {
      const sx = rect.width / oldWidth;
      const sy = rect.height / oldHeight;
      for (const stroke of this.strokes) {
        for (const point of stroke.points) {
          point.x *= sx;
          point.y *= sy;
        }
      }
    }

    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.redraw();
  }

  pointFrom(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: event.pointerType === 'pen' ? Math.max(0.15, event.pressure || 0.4) : 0.55
    };
  }

  handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'pen') return;
    event.preventDefault();
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointerId = event.pointerId;
    this.current = {
      color: this.color,
      width: this.width,
      erase: this.eraser,
      points: [this.pointFrom(event)]
    };
    this.strokes.push(this.current);
    this.redraw();
    this.updatePlaceholder();
  }

  handlePointerMove(event) {
    if (this.pointerId !== event.pointerId || !this.current) return;
    event.preventDefault();
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const item of events) {
      const point = this.pointFrom(item);
      const last = this.current.points[this.current.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.8) continue;
      this.current.points.push(point);
    }
    this.redraw();
  }

  handlePointerUp(event) {
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.current = null;
    this.redraw();
    this.updatePlaceholder();
    this.onChange();
  }

  updatePlaceholder() {
    if (!this.placeholder) return;
    this.placeholder.hidden = this.strokes.length > 0;
  }

  setColor(color) {
    this.color = color;
    this.eraser = false;
  }

  setEraser(eraser) {
    this.eraser = Boolean(eraser);
  }

  undo() {
    this.strokes.pop();
    this.redraw();
    this.updatePlaceholder();
    this.onChange();
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.updatePlaceholder();
    this.onChange();
  }

  isEmpty() {
    return this.strokes.length === 0;
  }

  redraw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);

    for (const stroke of this.strokes) {
      if (!stroke.points.length) continue;
      ctx.save();
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.points.length === 1) {
        const point = stroke.points[0];
        const radius = (stroke.width * (stroke.erase ? 5 : 1.5)) / 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let index = 1; index < stroke.points.length; index += 1) {
          const previous = stroke.points[index - 1];
          const point = stroke.points[index];
          const pressure = (previous.pressure + point.pressure) / 2;
          ctx.lineWidth = stroke.width * (stroke.erase ? 5 : 0.55 + pressure * 1.15);
          ctx.beginPath();
          ctx.moveTo(previous.x, previous.y);
          const midX = (previous.x + point.x) / 2;
          const midY = (previous.y + point.y) / 2;
          ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  toDataURL() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.canvas.width;
    exportCanvas.height = this.canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#ffffff';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(this.canvas, 0, 0);
    return exportCanvas.toDataURL('image/png');
  }

  destroy() {
    this.observer?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
  }
}
