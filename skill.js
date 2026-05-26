import { database, ref, set, onValue, push, remove } from "./firebase-config.js";

const viewportFrame = document.getElementById("viewport-frame");
const canvas = document.getElementById("skill-canvas");
const nodeLayer = document.getElementById("skill-node-layer");
const lineLayer = document.getElementById("skill-line-layer");
const toggleEditBtn = document.getElementById("toggle-edit-btn");
const toggleDeleteBtn = document.getElementById("toggle-delete-btn");
const controlsHint = document.querySelector(".skill-controls__hint");

if (!viewportFrame || !canvas || !nodeLayer || !lineLayer || !toggleEditBtn || !toggleDeleteBtn) {
	throw new Error("Skill tree page is missing required mount points.");
}

const desktopQuery = window.matchMedia("(min-width: 920px)");
const svgNs = "http://www.w3.org/2000/svg";
const canvasSize = 2000;
const defaultNodeSize = 90;
const minNodeSize = 60;
const maxNodeSize = 220;
const interactionThreshold = 4;
const nodeBorderWidth = 2;
const nodeHitSlop = 10;
const connectionArrowPadding = 2;
const connectionStrokeWidth = 2;
const connectionArrowWidth = 4;
const connectionArrowHeight = 4;
const minZoom = 0.25;
const maxZoom = 2.5;
const defaultZoom = 0.8;
const wheelZoomIntensity = 0.0015;
const nodeStates = ["none", "processing", "complete"];
const connectionStateColors = {
	none: "#ffffff",
	processing: "#ffcc00",
	complete: "#00cc66",
};

const nodesRef = ref(database, "skillTree/nodes");
const connectionsRef = ref(database, "skillTree/connections");

const connectionLayer = document.createElementNS(svgNs, "g");
connectionLayer.setAttribute("id", "skill-connection-layer");
lineLayer.appendChild(connectionLayer);
lineLayer.setAttribute("viewBox", `0 0 ${canvasSize} ${canvasSize}`);
lineLayer.setAttribute("width", String(canvasSize));
lineLayer.setAttribute("height", String(canvasSize));

function connectionMarkerId(state) {
	return `skill-arrow-${state}`;
}

function ensureConnectionMarkers() {
	let defs = lineLayer.querySelector("defs");

	if (!defs) {
		defs = document.createElementNS(svgNs, "defs");
		lineLayer.prepend(defs);
	}

	defs.querySelector("#skill-arrow")?.remove();

	const arrowPath = `M0,0 L${connectionArrowWidth - 1},${connectionArrowHeight / 2} L0,${connectionArrowHeight} z`;

	for (const state of nodeStates) {
		const id = connectionMarkerId(state);
		let marker = defs.querySelector(`#${id}`);

		if (!marker) {
			marker = document.createElementNS(svgNs, "marker");
			marker.setAttribute("id", id);
			marker.setAttribute("markerWidth", String(connectionArrowWidth));
			marker.setAttribute("markerHeight", String(connectionArrowHeight));
			marker.setAttribute("refX", String(connectionArrowWidth - 1));
			marker.setAttribute("refY", String(connectionArrowHeight / 2));
			marker.setAttribute("orient", "auto");
			marker.setAttribute("markerUnits", "strokeWidth");

			const path = document.createElementNS(svgNs, "path");
			path.setAttribute("d", arrowPath);
			marker.appendChild(path);
			defs.appendChild(marker);
		}

		marker.querySelector("path")?.setAttribute("fill", connectionStateColors[state]);
	}
}

ensureConnectionMarkers();

viewportFrame.tabIndex = 0;

let editMode = false;
let deleteMode = false;
let panX = 0;
let panY = 0;
let zoom = defaultZoom;
let viewportBounds = viewportFrame.getBoundingClientRect();
let firstSelectedNodeId = null;
let lastNodesDigest = "";
let lastConnectionsDigest = "";
let activePan = null;
let pendingNodePointer = null;
let activeNodeDrag = null;
let activeResize = null;
let activePinch = null;
let latestNodesSource = null;
let latestConnectionsSource = null;

const interactionState = {
	consumeClick: false,
};

function isDesktopLayout() {
	return desktopQuery.matches;
}

function canEditStructure() {
	return isDesktopLayout() && editMode;
}

function canModifyStructure() {
	return canEditStructure() && !deleteMode;
}

function canDelete() {
	return canEditStructure() && deleteMode;
}

function canChangeStatus() {
	return !isDesktopLayout() || !editMode;
}

function nowStamp() {
	return Date.now();
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function nodeDigest(nodes) {
	return JSON.stringify(
		nodes
			.slice()
			.sort((left, right) => String(left.id).localeCompare(String(right.id)))
			.map((node) => ({
				id: node.id,
				title: node.title,
				x: node.x,
				y: node.y,
				size: node.size,
				state: node.state,
			})),
	);
}

function connectionDigest(connections) {
	return JSON.stringify(
		connections
			.slice()
			.sort((left, right) => String(left.id).localeCompare(String(right.id)))
			.map((connection) => ({
				id: connection.id,
				from: connection.from,
				to: connection.to,
			})),
	);
}

function clampPan(nextX, nextY) {
	const scaledWidth = canvasSize * zoom;
	const scaledHeight = canvasSize * zoom;

	let minX;
	let maxX;
	let minY;
	let maxY;

	if (scaledWidth <= viewportBounds.width) {
		const centeredX = (viewportBounds.width - scaledWidth) / 2;
		minX = centeredX;
		maxX = centeredX;
	} else {
		minX = viewportBounds.width - scaledWidth;
		maxX = 0;
	}

	if (scaledHeight <= viewportBounds.height) {
		const centeredY = (viewportBounds.height - scaledHeight) / 2;
		minY = centeredY;
		maxY = centeredY;
	} else {
		minY = viewportBounds.height - scaledHeight;
		maxY = 0;
	}

	return {
		x: clamp(nextX, minX, maxX),
		y: clamp(nextY, minY, maxY),
	};
}

function updateCanvasTransform() {
	canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
}

function setZoomAtViewportPoint(viewportX, viewportY, nextZoom) {
	const clampedZoom = clamp(nextZoom, minZoom, maxZoom);
	const canvasX = (viewportX - panX) / zoom;
	const canvasY = (viewportY - panY) / zoom;

	zoom = clampedZoom;
	panX = viewportX - canvasX * zoom;
	panY = viewportY - canvasY * zoom;

	const clamped = clampPan(panX, panY);
	panX = clamped.x;
	panY = clamped.y;
	updateCanvasTransform();
}

function centerCanvasView() {
	const canvasCenter = canvasSize / 2;
	panX = viewportBounds.width / 2 - canvasCenter * zoom;
	panY = viewportBounds.height / 2 - canvasCenter * zoom;

	const clamped = clampPan(panX, panY);
	panX = clamped.x;
	panY = clamped.y;
	updateCanvasTransform();
}

function refreshViewportBounds() {
	viewportBounds = viewportFrame.getBoundingClientRect();
	const clamped = clampPan(panX, panY);
	panX = clamped.x;
	panY = clamped.y;
	updateCanvasTransform();
}

function getCanvasPoint(event) {
	return {
		x: clamp((event.clientX - viewportBounds.left - panX) / zoom, 0, canvasSize),
		y: clamp((event.clientY - viewportBounds.top - panY) / zoom, 0, canvasSize),
	};
}

function getTouchPairDistance(firstTouch, secondTouch) {
	return Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
}

function getTouchPairCenter(firstTouch, secondTouch) {
	return {
		x: (firstTouch.clientX + secondTouch.clientX) / 2,
		y: (firstTouch.clientY + secondTouch.clientY) / 2,
	};
}

function cancelActivePanForPinch() {
	activePan = null;
	pendingNodePointer = null;
}

function coerceNode(candidate, fallbackId) {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const title = String(candidate.title ?? candidate.name ?? "").trim();

	if (!title) {
		return null;
	}

	const x = Number(candidate.x);
	const y = Number(candidate.y);
	const size = Number(candidate.size);
	const state = nodeStates.includes(candidate.state) ? candidate.state : "none";

	return {
		id: String(candidate.id ?? fallbackId),
		title,
		x: Number.isFinite(x) ? x : canvasSize / 2,
		y: Number.isFinite(y) ? y : canvasSize / 2,
		size: Number.isFinite(size) ? clamp(size, minNodeSize, maxNodeSize) : defaultNodeSize,
		state,
	};
}

function coerceConnection(candidate, fallbackId) {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const from = String(candidate.from ?? "").trim();
	const to = String(candidate.to ?? "").trim();

	if (!from || !to) {
		return null;
	}

	return {
		id: String(candidate.id ?? fallbackId),
		from,
		to,
	};
}

function normalizeNodes(source) {
	if (!source) {
		return [];
	}

	if (Array.isArray(source)) {
		return source.map((node, index) => coerceNode(node, index + 1)).filter(Boolean);
	}

	return Object.entries(source).map(([key, node]) => coerceNode(node, key)).filter(Boolean);
}

function normalizeConnections(source) {
	if (!source) {
		return [];
	}

	if (Array.isArray(source)) {
		return source.map((connection, index) => coerceConnection(connection, index + 1)).filter(Boolean);
	}

	return Object.entries(source).map(([key, connection]) => coerceConnection(connection, key)).filter(Boolean);
}

function upsertNode(source, node) {
	const nodes = normalizeNodes(source);
	const existingIndex = nodes.findIndex((entry) => entry.id === node.id);

	if (existingIndex >= 0) {
		nodes[existingIndex] = node;
		return nodes;
	}

	nodes.push(node);
	return nodes;
}

function nextNodeState(currentState) {
	const index = nodeStates.indexOf(currentState);
	const nextIndex = index >= 0 ? (index + 1) % nodeStates.length : 0;
	return nodeStates[nextIndex];
}

function renderSelection() {
	for (const child of nodeLayer.children) {
		child.classList.toggle("is-selected", child.dataset.nodeId === firstSelectedNodeId);
	}
}

function nodeOutlineRadius(node) {
	return node.size / 2 + nodeBorderWidth;
}

function findNodeAtCanvasPoint(x, y) {
	const hitRadius = (node) => nodeOutlineRadius(node) + nodeHitSlop;

	for (const node of normalizeNodes(latestNodesSource)) {
		if (Math.hypot(x - node.x, y - node.y) <= hitRadius(node)) {
			return node;
		}
	}

	return null;
}

function connectionLinePoints(fromNode, toNode) {
	const dx = toNode.x - fromNode.x;
	const dy = toNode.y - fromNode.y;
	const distance = Math.hypot(dx, dy);

	if (distance < 1) {
		return {
			x1: fromNode.x,
			y1: fromNode.y,
			x2: toNode.x,
			y2: toNode.y,
		};
	}

	const unitX = dx / distance;
	const unitY = dy / distance;
	const fromRadius = nodeOutlineRadius(fromNode);
	const toRadius = nodeOutlineRadius(toNode) + connectionArrowPadding;

	return {
		x1: fromNode.x + unitX * fromRadius,
		y1: fromNode.y + unitY * fromRadius,
		x2: toNode.x - unitX * toRadius,
		y2: toNode.y - unitY * toRadius,
	};
}

function renderConnections(nodes, connections) {
	const deleting = canDelete();
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	connectionLayer.replaceChildren();

	for (const connection of connections) {
		const fromNode = nodesById.get(connection.from);
		const toNode = nodesById.get(connection.to);

		if (!fromNode || !toNode) {
			continue;
		}

		const destinationState = nodeStates.includes(toNode.state) ? toNode.state : "none";
		const strokeColor = connectionStateColors[destinationState];
		const points = connectionLinePoints(fromNode, toNode);
		const line = document.createElementNS(svgNs, "line");
		line.classList.add("skill-connection");
		line.dataset.connectionId = connection.id;
		line.setAttribute("x1", String(points.x1));
		line.setAttribute("y1", String(points.y1));
		line.setAttribute("x2", String(points.x2));
		line.setAttribute("y2", String(points.y2));
		line.setAttribute("stroke-width", String(connectionStrokeWidth));
		line.setAttribute("stroke", strokeColor);
		line.setAttribute("marker-end", `url(#${connectionMarkerId(destinationState)})`);

		if (deleting) {
			line.classList.add("is-deletable");
			line.addEventListener("click", (event) => {
				event.stopPropagation();
				deleteConnection(connection.id);
			});
		}

		connectionLayer.appendChild(line);
	}
}

function cycleNodeStatus(nodeId) {
	const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === nodeId);

	if (!node) {
		return;
	}

	const updated = {
		...node,
		state: nextNodeState(node.state),
		updatedAt: nowStamp(),
	};

	latestNodesSource = upsertNode(latestNodesSource, updated);
	renderScene();
	persistNode(updated);
}

function renderNodes(nodes) {
	const structureEditing = canEditStructure();
	const modifying = canModifyStructure();
	const deleting = canDelete();
	nodeLayer.replaceChildren();

	for (const nodeData of nodes) {
		const node = document.createElement("button");
		node.type = "button";
		node.className = `skill-node state-${nodeData.state}`;
		node.dataset.nodeId = nodeData.id;
		node.style.width = `${nodeData.size}px`;
		node.style.height = `${nodeData.size}px`;
		node.style.left = `${nodeData.x - nodeData.size / 2}px`;
		node.style.top = `${nodeData.y - nodeData.size / 2}px`;
		node.setAttribute("aria-label", `${nodeData.title}, status ${nodeData.state}`);
		node.innerHTML = `
			<span class="skill-node__label">${escapeHtml(nodeData.title)}</span>
			${modifying ? '<span class="skill-node__resize" aria-hidden="true"></span>' : ""}
		`;

		if (deleting) {
			node.classList.add("is-deletable");
		}

		node.addEventListener("pointerdown", (event) => {
			if (!structureEditing || event.button !== 0) {
				return;
			}

			event.stopPropagation();

			if (deleting) {
				beginNodePointer(nodeData.id, event, "delete");
				return;
			}

			if (!modifying) {
				return;
			}

			const resizeHandle = event.target.closest(".skill-node__resize");
			beginNodePointer(nodeData.id, event, resizeHandle ? "resize" : "drag");
		});

		node.addEventListener("click", (event) => {
			event.stopPropagation();

			if (interactionState.consumeClick) {
				interactionState.consumeClick = false;
				return;
			}

			if (deleting) {
				deleteNode(nodeData.id);
				return;
			}

			if (structureEditing) {
				return;
			}

			event.preventDefault();

			if (canChangeStatus()) {
				cycleNodeStatus(nodeData.id);
			}
		});

		node.addEventListener("dblclick", (event) => {
			if (!modifying) {
				return;
			}

			if (interactionState.consumeClick) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			firstSelectedNodeId = null;
			renderSelection();
			cycleNodeStatus(nodeData.id);
		});

		nodeLayer.appendChild(node);
	}

	renderSelection();
}

function renderScene() {
	const nodes = normalizeNodes(latestNodesSource);
	const connections = normalizeConnections(latestConnectionsSource);

	renderConnections(nodes, connections);
	renderNodes(nodes);
}

function persistNode(node) {
	set(ref(database, `skillTree/nodes/${node.id}`), node);
}

function deleteNode(nodeId) {
	remove(ref(database, `skillTree/nodes/${nodeId}`));

	for (const connection of normalizeConnections(latestConnectionsSource)) {
		if (connection.from === nodeId || connection.to === nodeId) {
			deleteConnection(connection.id);
		}
	}

	if (firstSelectedNodeId === nodeId) {
		firstSelectedNodeId = null;
	}
}

function deleteConnection(connectionId) {
	remove(ref(database, `skillTree/connections/${connectionId}`));
}

function updateControlsUi() {
	const desktop = isDesktopLayout();
	viewportFrame.classList.toggle("is-desktop", desktop);
	viewportFrame.classList.toggle("is-mobile", !desktop);
	viewportFrame.classList.toggle("is-editing", canModifyStructure());
	viewportFrame.classList.toggle("is-delete-mode", canDelete());
	toggleEditBtn.hidden = !desktop;
	toggleEditBtn.textContent = `Edit Mode: ${editMode ? "ON" : "OFF"}`;
	toggleDeleteBtn.hidden = !canEditStructure();
	toggleDeleteBtn.textContent = `Delete: ${deleteMode ? "ON" : "OFF"}`;
	toggleDeleteBtn.setAttribute("aria-pressed", deleteMode ? "true" : "false");

	if (controlsHint) {
		if (!desktop) {
			controlsHint.textContent = "Drag to pan. Tap a skill to cycle its status.";
		} else if (deleteMode) {
			controlsHint.textContent = "Delete mode is on. Click a skill or connection to remove it.";
		} else if (editMode) {
			controlsHint.textContent =
				"Click empty space to add skills. Click two skills to connect. Drag to move, corner to resize. Double-click to change status.";
		} else {
			controlsHint.textContent = "Drag to pan. Click a skill to cycle its status. Turn on edit mode to add, move, connect, and resize.";
		}
	}
}

function setEditMode(nextMode) {
	if (!isDesktopLayout()) {
		editMode = false;
	} else {
		editMode = nextMode;
	}

	if (!editMode) {
		deleteMode = false;
	}

	firstSelectedNodeId = null;
	updateControlsUi();
	renderScene();
}

function setDeleteMode(nextMode) {
	if (!canEditStructure()) {
		deleteMode = false;
	} else {
		deleteMode = nextMode;
	}

	firstSelectedNodeId = null;
	updateControlsUi();
	renderScene();
}

function handleNodeSelection(nodeId) {
	if (!canModifyStructure()) {
		return;
	}

	if (!firstSelectedNodeId) {
		firstSelectedNodeId = nodeId;
		renderSelection();
		return;
	}

	if (firstSelectedNodeId === nodeId) {
		firstSelectedNodeId = null;
		renderSelection();
		return;
	}

	const existing = normalizeConnections(latestConnectionsSource).some(
		(connection) => connection.from === firstSelectedNodeId && connection.to === nodeId,
	);

	if (!existing) {
		const connectionRef = push(connectionsRef);
		set(connectionRef, {
			id: connectionRef.key,
			from: firstSelectedNodeId,
			to: nodeId,
			createdAt: nowStamp(),
		});
	}

	firstSelectedNodeId = null;
	renderSelection();
}

function beginNodePointer(nodeId, event, mode) {
	const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === nodeId);

	if (!node) {
		return;
	}

	const start = getCanvasPoint(event);
	pendingNodePointer = {
		mode,
		nodeId,
		pointerId: event.pointerId,
		startX: start.x,
		startY: start.y,
		originX: node.x,
		originY: node.y,
		originSize: node.size,
	};
	interactionState.consumeClick = false;
}

function promotePendingNodePointer(event) {
	if (!pendingNodePointer || pendingNodePointer.pointerId !== event.pointerId) {
		return;
	}

	const pending = pendingNodePointer;
	pendingNodePointer = null;
	viewportFrame.setPointerCapture(event.pointerId);

	if (pending.mode === "resize") {
		activeResize = {
			nodeId: pending.nodeId,
			pointerId: pending.pointerId,
			startX: pending.startX,
			startY: pending.startY,
			originSize: pending.originSize,
			moved: false,
		};
		return;
	}

	activeNodeDrag = {
		nodeId: pending.nodeId,
		pointerId: pending.pointerId,
		startX: pending.startX,
		startY: pending.startY,
		originX: pending.originX,
		originY: pending.originY,
		moved: false,
	};
}

function pointerMovedBeyondThreshold(event, startX, startY) {
	const point = getCanvasPoint(event);
	return Math.hypot(point.x - startX, point.y - startY) > interactionThreshold;
}

function beginPan(event) {
	activePan = {
		pointerId: event.pointerId,
		startClientX: event.clientX,
		startClientY: event.clientY,
		originX: panX,
		originY: panY,
		moved: false,
	};
	interactionState.consumeClick = false;
	viewportFrame.setPointerCapture(event.pointerId);
}

function createNodeAtEvent(event) {
	const point = getCanvasPoint(event);

	if (findNodeAtCanvasPoint(point.x, point.y)) {
		return;
	}

	const title = window.prompt("Enter Skill Title:");
	const value = title?.trim();

	if (!value) {
		return;
	}
	const nodeRef = push(nodesRef);
	set(nodeRef, {
		id: nodeRef.key,
		title: value,
		x: point.x,
		y: point.y,
		size: defaultNodeSize,
		state: "none",
		createdAt: nowStamp(),
	});
	firstSelectedNodeId = null;
}

function finishPointerInteraction(event) {
	if (pendingNodePointer && pendingNodePointer.pointerId === event.pointerId) {
		if (pendingNodePointer.mode === "delete") {
			deleteNode(pendingNodePointer.nodeId);
		} else if (pendingNodePointer.mode === "drag") {
			handleNodeSelection(pendingNodePointer.nodeId);
		}

		interactionState.consumeClick = true;
		pendingNodePointer = null;
	}

	if (activePan && activePan.pointerId === event.pointerId) {
		interactionState.consumeClick = activePan.moved;
		activePan = null;
	}

	if (activeNodeDrag && activeNodeDrag.pointerId === event.pointerId) {
		interactionState.consumeClick = activeNodeDrag.moved;
		if (activeNodeDrag.moved) {
			const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === activeNodeDrag.nodeId);

			if (node) {
				persistNode(node);
			}
		}
		activeNodeDrag = null;
	}

	if (activeResize && activeResize.pointerId === event.pointerId) {
		interactionState.consumeClick = activeResize.moved;
		if (activeResize.moved) {
			const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === activeResize.nodeId);

			if (node) {
				persistNode(node);
			}
		}
		activeResize = null;
	}

	if (viewportFrame.hasPointerCapture(event.pointerId)) {
		viewportFrame.releasePointerCapture(event.pointerId);
	}
}

viewportFrame.addEventListener("pointerdown", (event) => {
	if (activePinch || event.button !== 0 || canEditStructure() || canDelete()) {
		return;
	}

	if (event.target.closest(".skill-controls, .skill-node, .skill-node__resize")) {
		return;
	}

	beginPan(event);
});

viewportFrame.addEventListener("pointermove", (event) => {
	if (activePinch) {
		return;
	}

	if (
		pendingNodePointer &&
		pendingNodePointer.mode !== "delete" &&
		pendingNodePointer.pointerId === event.pointerId &&
		!activeNodeDrag &&
		!activeResize &&
		pointerMovedBeyondThreshold(event, pendingNodePointer.startX, pendingNodePointer.startY)
	) {
		promotePendingNodePointer(event);
	}

	if (activePan && activePan.pointerId === event.pointerId) {
		const deltaX = event.clientX - activePan.startClientX;
		const deltaY = event.clientY - activePan.startClientY;

		if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
			activePan.moved = true;
		}

		const clamped = clampPan(activePan.originX + deltaX, activePan.originY + deltaY);
		panX = clamped.x;
		panY = clamped.y;
		updateCanvasTransform();
	}

	if (activeNodeDrag && activeNodeDrag.pointerId === event.pointerId) {
		const point = getCanvasPoint(event);
		const deltaX = point.x - activeNodeDrag.startX;
		const deltaY = point.y - activeNodeDrag.startY;

		if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
			activeNodeDrag.moved = true;
		}

		if (!activeNodeDrag.moved) {
			return;
		}

		const nextNode = normalizeNodes(latestNodesSource).find((entry) => entry.id === activeNodeDrag.nodeId);

		if (!nextNode) {
			return;
		}

		nextNode.x = clamp(activeNodeDrag.originX + deltaX, nextNode.size / 2, canvasSize - nextNode.size / 2);
		nextNode.y = clamp(activeNodeDrag.originY + deltaY, nextNode.size / 2, canvasSize - nextNode.size / 2);
		latestNodesSource = upsertNode(latestNodesSource, nextNode);
		renderScene();
	}

	if (activeResize && activeResize.pointerId === event.pointerId) {
		const point = getCanvasPoint(event);
		const deltaX = point.x - activeResize.startX;
		const deltaY = point.y - activeResize.startY;

		if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
			activeResize.moved = true;
		}

		if (!activeResize.moved) {
			return;
		}

		const nextNode = normalizeNodes(latestNodesSource).find((entry) => entry.id === activeResize.nodeId);

		if (!nextNode) {
			return;
		}

		nextNode.size = clamp(activeResize.originSize + Math.max(deltaX, deltaY), minNodeSize, maxNodeSize);
		latestNodesSource = upsertNode(latestNodesSource, nextNode);
		renderScene();
	}
});

viewportFrame.addEventListener("pointerup", finishPointerInteraction);
viewportFrame.addEventListener("pointercancel", finishPointerInteraction);

viewportFrame.addEventListener(
	"wheel",
	(event) => {
		if (!isDesktopLayout()) {
			return;
		}

		event.preventDefault();
		const viewportX = event.clientX - viewportBounds.left;
		const viewportY = event.clientY - viewportBounds.top;
		const zoomFactor = Math.exp(-event.deltaY * wheelZoomIntensity);
		setZoomAtViewportPoint(viewportX, viewportY, zoom * zoomFactor);
	},
	{ passive: false },
);

viewportFrame.addEventListener(
	"touchstart",
	(event) => {
		if (event.touches.length !== 2) {
			return;
		}

		if (event.target.closest(".skill-controls, .page-nav-arrow")) {
			return;
		}

		event.preventDefault();
		cancelActivePanForPinch();

		const firstTouch = event.touches[0];
		const secondTouch = event.touches[1];

		activePinch = {
			startDistance: getTouchPairDistance(firstTouch, secondTouch),
			startZoom: zoom,
		};
	},
	{ passive: false },
);

viewportFrame.addEventListener(
	"touchmove",
	(event) => {
		if (!activePinch || event.touches.length < 2) {
			return;
		}

		event.preventDefault();

		const firstTouch = event.touches[0];
		const secondTouch = event.touches[1];
		const distance = getTouchPairDistance(firstTouch, secondTouch);
		const center = getTouchPairCenter(firstTouch, secondTouch);
		const viewportX = center.x - viewportBounds.left;
		const viewportY = center.y - viewportBounds.top;
		const nextZoom = activePinch.startZoom * (distance / activePinch.startDistance);

		setZoomAtViewportPoint(viewportX, viewportY, nextZoom);
	},
	{ passive: false },
);

function finishTouchZoom(event) {
	if (event.touches.length >= 2) {
		return;
	}

	activePinch = null;
}

viewportFrame.addEventListener("touchend", finishTouchZoom);
viewportFrame.addEventListener("touchcancel", finishTouchZoom);

viewportFrame.addEventListener("click", (event) => {
	if (!canModifyStructure()) {
		return;
	}

	if (interactionState.consumeClick) {
		interactionState.consumeClick = false;
		return;
	}

	if (event.target.closest(".skill-controls, .skill-node, .skill-node__resize, .skill-connection")) {
		return;
	}

	const point = getCanvasPoint(event);

	if (findNodeAtCanvasPoint(point.x, point.y)) {
		return;
	}

	createNodeAtEvent(event);
});

toggleEditBtn.addEventListener("click", () => {
	if (!isDesktopLayout()) {
		return;
	}

	setEditMode(!editMode);
});

toggleDeleteBtn.addEventListener("click", () => {
	if (!canEditStructure()) {
		return;
	}

	setDeleteMode(!deleteMode);
});

viewportFrame.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		if (deleteMode) {
			setDeleteMode(false);
			return;
		}

		firstSelectedNodeId = null;
		renderSelection();
	}
});

function handleLayoutChange() {
	if (!isDesktopLayout()) {
		editMode = false;
		deleteMode = false;
		firstSelectedNodeId = null;
	}

	updateControlsUi();
	renderScene();
}

desktopQuery.addEventListener("change", handleLayoutChange);
window.addEventListener("resize", refreshViewportBounds);

onValue(nodesRef, (snapshot) => {
	const incoming = normalizeNodes(snapshot.val());
	const digest = nodeDigest(incoming);

	latestNodesSource = incoming;

	if (digest === lastNodesDigest) {
		return;
	}

	lastNodesDigest = digest;
	if (firstSelectedNodeId && !incoming.some((node) => node.id === firstSelectedNodeId)) {
		firstSelectedNodeId = null;
	}
	renderScene();
});

onValue(connectionsRef, (snapshot) => {
	const incoming = normalizeConnections(snapshot.val());
	const digest = connectionDigest(incoming);

	latestConnectionsSource = incoming;

	if (digest === lastConnectionsDigest) {
		return;
	}

	lastConnectionsDigest = digest;
	renderScene();
});

refreshViewportBounds();
centerCanvasView();
setEditMode(false);
