export class ViewportCamera {
	constructor(viewportFrame, canvas, options = {}) {
		this.viewportFrame = viewportFrame;
		this.canvas = canvas;

		// ── Configuration Constants ─────────────────────────────────────
		this.canvasWidth = options.canvasWidth ?? options.canvasSize ?? 5000;
		this.canvasHeight = options.canvasHeight ?? options.canvasSize ?? 3000;
		this.minZoom = options.minZoom ?? 0.25;
		this.maxZoom = options.maxZoom ?? 2.5;
		this.defaultZoom = options.defaultZoom ?? 0.5;
		this.wheelZoomIntensity = options.wheelZoomIntensity ?? 0.0015;
		this.interactionThreshold = options.interactionThreshold ?? 4;

		// ── Camera State ────────────────────────────────────────────────
		this.panX = 0;
		this.panY = 0;
		this.zoom = this.defaultZoom;
		this.currentGridSize = 20;
		this.viewportBounds = viewportFrame.getBoundingClientRect();
		this.activePan = null;
		this.activePinch = null;
	}

	// ── Coordinate Bounds & Transform Application ───────────────────────

	clampPan(nextX, nextY) {
		const scaledWidth = this.canvasWidth * this.zoom;
		const scaledHeight = this.canvasHeight * this.zoom;

		let minX, maxX, minY, maxY;

		if (scaledWidth <= this.viewportBounds.width) {
			const centeredX = (this.viewportBounds.width - scaledWidth) / 2;
			minX = centeredX;
			maxX = centeredX;
		} else {
			minX = this.viewportBounds.width - scaledWidth;
			maxX = 0;
		}

		if (scaledHeight <= this.viewportBounds.height) {
			const centeredY = (this.viewportBounds.height - scaledHeight) / 2;
			minY = centeredY;
			maxY = centeredY;
		} else {
			minY = this.viewportBounds.height - scaledHeight;
			maxY = 0;
		}

		return {
			x: Math.max(minX, Math.min(maxX, nextX)),
			y: Math.max(minY, Math.min(maxY, nextY)),
		};
	}

	updateCanvasTransform() {
		this.canvas.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoom})`;

		let gridSize = 20;
		if (this.zoom < 0.35) {
			gridSize = 80;
		} else if (this.zoom < 0.70) {
			gridSize = 40;
		}

		// Keep dot size consistent on screen (~1.5px) by scaling inversely with zoom
		const dotSize = Math.max(1, Number((1.5 / this.zoom).toFixed(2)));

		if (this.currentGridSize !== gridSize) {
			this.currentGridSize = gridSize;
			this.canvas.style.setProperty("--grid-size", `${gridSize}px`);
		}

		this.canvas.style.setProperty("--dot-size", `${dotSize}px`);
	}

	clampAndApply() {
		const clamped = this.clampPan(this.panX, this.panY);
		this.panX = clamped.x;
		this.panY = clamped.y;
		this.updateCanvasTransform();
	}

	// ── Zoom & Center Helpers ───────────────────────────────────────────

	setZoomAtViewportPoint(viewportX, viewportY, nextZoom) {
		const clampedZoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
		const canvasX = (viewportX - this.panX) / this.zoom;
		const canvasY = (viewportY - this.panY) / this.zoom;

		this.zoom = clampedZoom;
		this.panX = viewportX - canvasX * this.zoom;
		this.panY = viewportY - canvasY * this.zoom;

		this.clampAndApply();
	}

	centerCanvasView() {
		this.panX = this.viewportBounds.width / 2 - (this.canvasWidth / 2) * this.zoom;
		this.panY = this.viewportBounds.height / 2 - (this.canvasHeight / 2) * this.zoom;
		this.clampAndApply();
	}

	refreshViewportBounds() {
		this.viewportBounds = this.viewportFrame.getBoundingClientRect();
		this.clampAndApply();
	}

	getCanvasPoint(clientX, clientY) {
		return {
			x: Math.max(0, Math.min(this.canvasWidth, (clientX - this.viewportBounds.left - this.panX) / this.zoom)),
			y: Math.max(0, Math.min(this.canvasHeight, (clientY - this.viewportBounds.top - this.panY) / this.zoom)),
		};
	}

	// ── Gesture Math & Pointer Events ───────────────────────────────────

	getTouchPairDistance(firstTouch, secondTouch) {
		return Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
	}

	getTouchPairCenter(firstTouch, secondTouch) {
		return {
			x: (firstTouch.clientX + secondTouch.clientX) / 2,
			y: (firstTouch.clientY + secondTouch.clientY) / 2,
		};
	}

	cancelActivePanForPinch() {
		this.activePan = null;
	}

	beginPan(event) {
		this.activePan = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originX: this.panX,
			originY: this.panY,
			moved: false,
		};
	}
}
