import { database, ref, set, onValue, push, remove } from "./firebase-config.js";
import { subscribeAuthState } from "./auth.js";

const viewportFrame = document.getElementById("viewport-frame");
const canvas = document.getElementById("skill-canvas");
const nodeLayer = document.getElementById("skill-node-layer");
const lineLayer = document.getElementById("skill-line-layer");
const toggleEditBtn = document.getElementById("toggle-edit-btn");
const toggleDeleteBtn = document.getElementById("toggle-delete-btn");
const controlsHint = document.querySelector(".skill-controls__hint");

// Font sizing for nodes is computed dynamically when nodes are rendered.
// Removed the initial one-off sizing pass because nodes are created later.

if (!viewportFrame || !canvas || !nodeLayer || !lineLayer || !toggleEditBtn || !toggleDeleteBtn) {
	throw new Error("Skill tree page is missing required mount points.");
}

const desktopQuery = window.matchMedia("(min-width: 920px)");
const svgNs = "http://www.w3.org/2000/svg";
const canvasSize = 4000;
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
const defaultZoom = 0.5;
const wheelZoomIntensity = 0.0015;
const nodeStates = ["activated","deactivated"];
const connectionStateColors = {
	activated: "#ffffff",
	deactivated: "#888888"
};
// for zoom simply add the css and more array both const will do 

const guestDemoNodes = [
	{
		id: "-OtbNwVjOENV-rUCyGky",
		title: "TECH",
		x: 1997.3454831199738,
		y: 1987.6359220973955,
		size: 90,
		state: "activated",
	},
	{
		id: "-OtbqA8a_Y-9IibOCNOq",
		title: "PRACTICE",
		x: 2365.3454831199738,
		y: 1987.6359220973955,
		size: 90,
		state: "deactivated",
	},
];

const guestDemoConnections = [
	{
		id: "-OtbqS2SQJW8-7RLGckY",
		from: "-OtbNwVjOENV-rUCyGky",
		to: "-OtbqA8a_Y-9IibOCNOq",
	},
];

let nodesRef = null;
let connectionsRef = null;
let nodesUnsubscribe = null;
let connectionsUnsubscribe = null;
let currentUserId = null;
let currentAuthUser = null;

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
let selectedNodes = [];
let activeRenameNodeId = null;
let lastNodesDigest = "";
let lastConnectionsDigest = "";
let activePan = null;
let pendingNodePointer = null;
let activeNodeDrag = null;
let activeResize = null;
let activePinch = null;
let latestNodesSource = null;
let latestConnectionsSource = null;
let historyUndoStack = [];
let historyRedoStack = [];

const historyLimit = 100;

const interactionState = {
	consumeClick: false,
};

const renameDialog = document.createElement("div");
renameDialog.className = "skill-rename-dialog";
renameDialog.hidden = true;
renameDialog.innerHTML = `
	<div class="skill-rename-dialog__backdrop" data-rename-cancel></div>
	<div class="skill-rename-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="skill-rename-title">
		<p class="skill-rename-dialog__kicker">Edit skill</p>
		<h2 id="skill-rename-title" class="skill-rename-dialog__title">Update the node</h2>
		<form class="skill-rename-dialog__form" autocomplete="off">
			<label class="skill-rename-dialog__label" for="skill-rename-input">Skill title</label>
			<input id="skill-rename-input" class="skill-rename-dialog__input" type="text" maxlength="80" spellcheck="false" />
			<label class="skill-rename-dialog__label skill-rename-dialog__label--desc" for="skill-desc-input">Description <span style="font-weight:400;opacity:0.55">(optional)</span></label>
			<textarea id="skill-desc-input" class="skill-rename-dialog__textarea" maxlength="600" spellcheck="false" placeholder="Add a short note about this skill…"></textarea>
			<div class="skill-rename-dialog__actions">
				<button type="button" class="skill-rename-dialog__button skill-rename-dialog__button--ghost" data-rename-cancel>Cancel</button>
				<button type="submit" class="skill-rename-dialog__button">Save</button>
			</div>
		</form>
	</div>
`;

const renameForm = renameDialog.querySelector(".skill-rename-dialog__form");
const renameInput = renameDialog.querySelector("#skill-rename-input");
const renameDescInput = renameDialog.querySelector("#skill-desc-input");
const renameCancelTargets = renameDialog.querySelectorAll("[data-rename-cancel]");
viewportFrame.appendChild(renameDialog);

// ── Description popup ──────────────────────────────────────────────
const nodeDescPopup = document.createElement("div");
nodeDescPopup.className = "skill-node-desc";
nodeDescPopup.setAttribute("aria-live", "polite");
nodeDescPopup.innerHTML = `<p class="skill-node-desc__title"></p><p class="skill-node-desc__body"></p>`;
viewportFrame.appendChild(nodeDescPopup);

const nodeDescTitle = nodeDescPopup.querySelector(".skill-node-desc__title");
const nodeDescBody = nodeDescPopup.querySelector(".skill-node-desc__body");

let activeDescNodeId = null;
let descHideTimer = null;
let descLongPressTimer = null;
let descLongPressActive = false;

renameDialog.addEventListener("click", (event) => {
	if (event.target.closest("[data-rename-cancel]")) {
		closeRenameDialog();
		return;
	}

	if (event.target.closest(".skill-rename-dialog__panel")) {
		event.stopPropagation();
	}
});

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

function hasRemoteTreeSync() {
	return Boolean(nodesRef && connectionsRef && currentUserId);
}

function createLocalId(prefix) {
	return `${prefix}-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`;
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

function computeNodeFontSize(title, nodeSize) {
    const length = String(title ?? "").trim().length;
    
    // 1. Calculate a dynamic base that grows with the node, but has a higher minimum cap
    const base = Math.max(14, Math.round(nodeSize * 0.18)); 

    // 2. Short Words (4 chars or less): Give them a scaling bonus instead of a limit
    if (length <= 4) {
        // Boosts the size for short words, maxing out at a clean 24px
        return `${Math.min(Math.round(base * 1.3), 24)}px`;
    }

    // 3. Long Words: Reduce font size gradually as length increases. Floor at 6px.
    const excess = Math.max(0, length - 4);
    
    // Dropping by 3.5% per character makes the drop noticeable immediately
    const scale = Math.max(0.45, 1 - (excess * 0.005)); 
    const size = Math.max(6, Math.round(base * scale));
    
    return `${size}px`;
// undo redo
}

	function cloneNodes(nodes) {
		return nodes.map((node) => ({ ...node }));
	}

	function cloneConnections(connections) {
		return connections.map((connection) => ({ ...connection }));
	}

	function serializeNodes(nodes) {
		const serialized = {};

		for (const node of nodes) {
			serialized[node.id] = { ...node };
		}

		return serialized;
	}

	function serializeConnections(connections) {
		const serialized = {};

		for (const connection of connections) {
			serialized[connection.id] = { ...connection };
		}

		return serialized;
	}

	function captureTreeSnapshot() {
		return {
			nodes: cloneNodes(normalizeNodes(latestNodesSource)),
			connections: cloneConnections(normalizeConnections(latestConnectionsSource)),
		};
	}

	function pushHistorySnapshot(snapshot) {
		historyUndoStack = [...historyUndoStack, snapshot].slice(-historyLimit);
		historyRedoStack = [];
	}

	function resetHistory() {
		historyUndoStack = [];
		historyRedoStack = [];
	}

	function syncTreeSnapshot(snapshot) {
		latestNodesSource = cloneNodes(snapshot.nodes);
		latestConnectionsSource = cloneConnections(snapshot.connections);
		lastNodesDigest = nodeDigest(latestNodesSource);
		lastConnectionsDigest = connectionDigest(latestConnectionsSource);
		firstSelectedNodeId = null;
		clearSelectedNodes();
		closeRenameDialog();
		interactionState.consumeClick = false;
		pendingNodePointer = null;
		activeNodeDrag = null;
		activeResize = null;
		activePan = null;
		activePinch = null;
		renderScene();
		updateControlsUi();

		if (!nodesRef || !connectionsRef || !currentUserId) {
			return;
		}

		set(nodesRef, serializeNodes(latestNodesSource));
		set(connectionsRef, serializeConnections(latestConnectionsSource));
	}

	function undoTreeChange() {
		if (historyUndoStack.length === 0) {
			return;
		}

		const snapshot = historyUndoStack.pop();
		historyRedoStack.push(captureTreeSnapshot());
		syncTreeSnapshot(snapshot);
	}

	function redoTreeChange() {
		if (historyRedoStack.length === 0) {
			return;
		}

		const snapshot = historyRedoStack.pop();
		historyUndoStack.push(captureTreeSnapshot());
		syncTreeSnapshot(snapshot);
	}

	function isEditableShortcutTarget(target) {
		return Boolean(
			target &&
			(typeof target.closest === "function"
				? target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable
				: false),
		);
	}

function nodeDigest(nodes) {
	return JSON.stringify(
		nodes
			.slice()
			.sort((left, right) => String(left.id).localeCompare(String(right.id)))
			.map((node) => ({
				id: node.id,
				title: node.title,
				description: node.description ?? "",
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
	const state = nodeStates.includes(candidate.state) ? candidate.state : "deactivated";

	const description = String(candidate.description ?? "").trim();

	return {
		id: String(candidate.id ?? fallbackId),
		title,
		description,
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

function upsertConnection(source, connection) {
	const connections = normalizeConnections(source);
	const existingIndex = connections.findIndex((entry) => entry.id === connection.id);

	if (existingIndex >= 0) {
		connections[existingIndex] = connection;
		return connections;
	}

	connections.push(connection);
	return connections;
}

function cloneGuestDemoNodes() {
	return guestDemoNodes.map((node) => ({ ...node }));
}

function cloneGuestDemoConnections() {
	return guestDemoConnections.map((connection) => ({ ...connection }));
}

function nextNodeState(currentState) {
	const index = nodeStates.indexOf(currentState);
	const nextIndex = index >= 0 ? (index + 1) % nodeStates.length : 0;
	return nodeStates[nextIndex];
}
// multi selector
function renderSelection() {
	const selectedNodeIds = selectedNodes.length > 0 ? new Set(selectedNodes) : firstSelectedNodeId ? new Set([firstSelectedNodeId]) : null;

	for (const child of nodeLayer.children) {
		child.classList.toggle("is-selected", Boolean(selectedNodeIds?.has(child.dataset.nodeId)));
	}
}

function clearSelectedNodes() {
	selectedNodes = [];
}

function toggleSelectedNode(nodeId) {
	firstSelectedNodeId = null;

	if (selectedNodes.includes(nodeId)) {
		selectedNodes = selectedNodes.filter((selectedNodeId) => selectedNodeId !== nodeId);
	} else {
		selectedNodes = [...selectedNodes, nodeId];
	}

	renderSelection();
}

function isSelectedNode(nodeId) {
	return selectedNodes.includes(nodeId);
}

function removeSelectedNode(nodeId) {
	if (!selectedNodes.includes(nodeId)) {
		return;
	}

	selectedNodes = selectedNodes.filter((selectedNodeId) => selectedNodeId !== nodeId);
	renderSelection();
}

function closeRenameDialog() {
	activeRenameNodeId = null;
	renameDialog.hidden = true;
	delete renameDialog.dataset.open;
	interactionState.consumeClick = false;
}

function openRenameDialog(nodeId) {
	if (!canModifyStructure()) {
		return;
	}

	const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === nodeId);

	if (!node) {
		return;
	}

	activeRenameNodeId = node.id;
	renameInput.value = node.title;
	renameDescInput.value = node.description ?? "";
	renameDialog.hidden = false;
	renameDialog.dataset.open = "true";
	renameInput.focus();
	renameInput.select();
}

function saveRenameDialog() {
	if (!activeRenameNodeId) {
		return;
	}

	const nextTitle = String(renameInput.value ?? "").trim();

	if (!nextTitle) {
		return;
	}

	const nextDescription = String(renameDescInput.value ?? "").trim();

	const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === activeRenameNodeId);

	if (!node) {
		closeRenameDialog();
		return;
	}

	if (node.title === nextTitle && (node.description ?? "") === nextDescription) {
		closeRenameDialog();
		return;
	}

	pushHistorySnapshot(captureTreeSnapshot());

	const updated = {
		...node,
		title: nextTitle,
		description: nextDescription,
		updatedAt: nowStamp(),
	};

	latestNodesSource = upsertNode(latestNodesSource, updated);
	renderScene();
	persistNode(updated);
	closeRenameDialog();
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

		const destinationState = nodeStates.includes(toNode.state) ? toNode.state : "deactivated";
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

	pushHistorySnapshot(captureTreeSnapshot());

	const updated = {
		...node,
		state: nextNodeState(node.state),
		updatedAt: nowStamp(),
	};

	latestNodesSource = upsertNode(latestNodesSource, updated);
	renderScene();
	persistNode(updated);
}

// ── Description popup helpers ─────────────────────────────────────

function showNodeDesc(nodeId, anchorEl) {
	const node = normalizeNodes(latestNodesSource).find((entry) => entry.id === nodeId);

	if (!node || !(node.description ?? "").trim()) {
		return;
	}

	// Clear any pending hide
	if (descHideTimer) {
		clearTimeout(descHideTimer);
		descHideTimer = null;
	}

	activeDescNodeId = nodeId;
	nodeDescTitle.textContent = node.title;
	nodeDescBody.textContent = node.description;

	// Pin to the bottom of the viewport, spanning full width
	nodeDescPopup.style.left = "0";
	nodeDescPopup.style.right = "0";
	nodeDescPopup.style.bottom = "";
	nodeDescPopup.style.top = "";
	nodeDescPopup.style.width = "";
	nodeDescPopup.style.maxWidth = "";

	// Force reflow so transition fires
	nodeDescPopup.classList.remove("is-visible");
	// eslint-disable-next-line no-unused-expressions
	void nodeDescPopup.offsetWidth;
	nodeDescPopup.classList.add("is-visible");
}

function hideNodeDesc(immediate = false) {
	if (descHideTimer) {
		clearTimeout(descHideTimer);
		descHideTimer = null;
	}

	if (immediate) {
		activeDescNodeId = null;
		nodeDescPopup.classList.remove("is-visible");
		return;
	}

	descHideTimer = setTimeout(() => {
		activeDescNodeId = null;
		nodeDescPopup.classList.remove("is-visible");
		descHideTimer = null;
	}, 120);
}

function renderNodes(nodes) {
	const structureEditing = canEditStructure();
	const modifying = canModifyStructure();
	const deleting = canDelete();
	const isMobile = !isDesktopLayout();
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

		// Apply computed font size based on title length and node size
		const labelEl = node.querySelector('.skill-node__label');
		if (labelEl) {
			labelEl.style.fontSize = computeNodeFontSize(nodeData.title, nodeData.size);
		}

		if (deleting) {
			node.classList.add("is-deletable");
		}

		// ── Description: desktop hover ───────────────────────────────
		if (!isMobile) {
			node.addEventListener("mouseenter", () => {
				if ((nodeData.description ?? "").trim()) {
					showNodeDesc(nodeData.id, node);
				}
			});

			node.addEventListener("mouseleave", () => {
				if (activeDescNodeId === nodeData.id) {
					hideNodeDesc();
				}
			});
		}

		// ── Description: mobile long-press (500 ms) ──────────────────
		if (isMobile) {
			node.addEventListener("touchstart", (event) => {
				if (!(nodeData.description ?? "").trim()) return;
				descLongPressActive = false;
				if (descLongPressTimer) clearTimeout(descLongPressTimer);
				descLongPressTimer = setTimeout(() => {
					descLongPressActive = true;
					showNodeDesc(nodeData.id, node);
				}, 500);
			}, { passive: true });

			node.addEventListener("touchend", () => {
				if (descLongPressTimer) {
					clearTimeout(descLongPressTimer);
					descLongPressTimer = null;
				}
			}, { passive: true });

			node.addEventListener("touchmove", () => {
				// Cancel long press if finger moves
				if (descLongPressTimer) {
					clearTimeout(descLongPressTimer);
					descLongPressTimer = null;
				}
			}, { passive: true });
		}

		node.addEventListener("contextmenu", (event) => {
			if (!canModifyStructure()) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			hideNodeDesc(true);
			openRenameDialog(nodeData.id);
		});

		node.addEventListener("pointerdown", (event) => {
			if (!structureEditing || event.button !== 0) {
				return;
			}

			if (event.shiftKey) {
				event.stopPropagation();
				toggleSelectedNode(nodeData.id);
				interactionState.consumeClick = true;
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
	if (!hasRemoteTreeSync()) {
		return;
	}

	set(ref(database, `users/${currentUserId}/skillTree/nodes/${node.id}`), node);
}
// removal
function removeConnectionFromLocalState(connectionId) {
	latestConnectionsSource = normalizeConnections(latestConnectionsSource).filter(
		(connection) => connection.id !== connectionId,
	);
	renderScene();
}

function deleteNode(nodeId) {
	if (!hasRemoteTreeSync()) {
		pushHistorySnapshot(captureTreeSnapshot());
		latestNodesSource = normalizeNodes(latestNodesSource).filter((node) => node.id !== nodeId);
		latestConnectionsSource = normalizeConnections(latestConnectionsSource).filter(
			(connection) => connection.from !== nodeId && connection.to !== nodeId,
		);

		if (firstSelectedNodeId === nodeId) {
			firstSelectedNodeId = null;
		}

		removeSelectedNode(nodeId);

		if (activeRenameNodeId === nodeId) {
			closeRenameDialog();
		}

		renderScene();
		return;
	}

	if (!nodesRef || !currentUserId) {
		return;
	}

	pushHistorySnapshot(captureTreeSnapshot());
	remove(ref(database, `users/${currentUserId}/skillTree/nodes/${nodeId}`));

	for (const connection of normalizeConnections(latestConnectionsSource)) {
		if (connection.from === nodeId || connection.to === nodeId) {
			deleteConnection(connection.id, true);
		}
	}

	if (firstSelectedNodeId === nodeId) {
		firstSelectedNodeId = null;
	}

	removeSelectedNode(nodeId);

	if (activeRenameNodeId === nodeId) {
		closeRenameDialog();
	}
}

function deleteConnection(connectionId, skipHistory = false) {
	if (!hasRemoteTreeSync()) {
		if (!skipHistory) {
			pushHistorySnapshot(captureTreeSnapshot());
		}

		removeConnectionFromLocalState(connectionId);
		return;
	}

	if (!connectionsRef || !currentUserId) {
		return;
	}

	if (!skipHistory) {
		pushHistorySnapshot(captureTreeSnapshot());
	}

	removeConnectionFromLocalState(connectionId);
	remove(ref(database, `users/${currentUserId}/skillTree/connections/${connectionId}`));
}

function updateControlsUi() {
	const desktop = isDesktopLayout();
	const signedIn = Boolean(currentAuthUser);
	viewportFrame.classList.toggle("is-desktop", desktop);
	viewportFrame.classList.toggle("is-mobile", !desktop);
	viewportFrame.classList.toggle("is-editing", canModifyStructure());
	viewportFrame.classList.toggle("is-delete-mode", canDelete());
	viewportFrame.classList.toggle("is-authenticated", signedIn);
	toggleEditBtn.hidden = !desktop;
	toggleEditBtn.disabled = !desktop;
	toggleEditBtn.textContent = `Edit Mode: ${editMode ? "ON" : "OFF"}`;
	toggleDeleteBtn.hidden = !canEditStructure();
	toggleDeleteBtn.disabled = !canEditStructure();
	toggleDeleteBtn.textContent = `Delete: ${deleteMode ? "ON" : "OFF"}`;
	toggleDeleteBtn.setAttribute("aria-pressed", deleteMode ? "true" : "false");

	if (controlsHint) {
		if (!signedIn) {
			controlsHint.textContent = editMode
				? "Guest sandbox is on. Your edits stay in this browser and will not sync to Firebase."
				: "Guest sandbox is available. Turn on edit mode to change the tree locally, or sign in to sync.";
		} else if (!desktop) {
			controlsHint.textContent = "Drag to pan. Tap a skill to cycle its status.";
		} else if (deleteMode) {
			controlsHint.textContent = "Delete mode is on. Click a skill or connection to remove it.";
		} else if (editMode) {
			controlsHint.textContent =
				"Shift-click skills to multi-select. Drag any selected skill to move the group. Click empty space to add skills. Click two skills to connect. Drag to move, corner to resize. Right-click a skill to rename it. Double-click to change status.";
		} else {
			controlsHint.textContent = "Drag to pan. Click a skill to cycle its status. Turn on edit mode to add, move, connect, and resize.";
		}
	}
}

function setEditMode(nextMode) {
	closeRenameDialog();

	if (!isDesktopLayout()) {
		editMode = false;
	} else {
		editMode = nextMode;
	}

	if (!editMode) {
		deleteMode = false;
		clearSelectedNodes();
	}

	firstSelectedNodeId = null;
	updateControlsUi();
	renderScene();
}

function setDeleteMode(nextMode) {
	closeRenameDialog();

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
		pushHistorySnapshot(captureTreeSnapshot());

		if (hasRemoteTreeSync()) {
			const connectionRef = push(connectionsRef);
			set(connectionRef, {
				id: connectionRef.key,
				from: firstSelectedNodeId,
				to: nodeId,
				createdAt: nowStamp(),
			});
		} else {
			latestConnectionsSource = upsertConnection(latestConnectionsSource, {
				id: createLocalId("connection"),
				from: firstSelectedNodeId,
				to: nodeId,
				createdAt: nowStamp(),
			});
			renderScene();
		}
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
		selectedNodeIds: mode === "drag" && isSelectedNode(nodeId) ? [...selectedNodes] : null,
		selectedNodeOrigins:
			mode === "drag" && isSelectedNode(nodeId)
				? new Map(
					normalizeNodes(latestNodesSource).map((entry) => [
						entry.id,
						{
							x: entry.x,
							y: entry.y,
							size: entry.size,
						},
					]),
				)
				: null,
		historySnapshot: mode === "drag" || mode === "resize" ? captureTreeSnapshot() : null,
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
			historySnapshot: pending.historySnapshot,
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
		deltaX: 0,
		deltaY: 0,
		selectedNodeIds: pending.selectedNodeIds,
		selectedNodeOrigins: pending.selectedNodeOrigins,
		historySnapshot: pending.historySnapshot,
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

	const descPrompt = window.prompt("Description (optional — leave blank to skip):");
	const description = String(descPrompt ?? "").trim();

	pushHistorySnapshot(captureTreeSnapshot());
	const node = {
		id: hasRemoteTreeSync() ? null : createLocalId("node"),
		title: value,
		description,
		x: point.x,
		y: point.y,
		size: defaultNodeSize,
		state: "deactivated",
		createdAt: nowStamp(),
	};

	if (hasRemoteTreeSync()) {
		const nodeRef = push(nodesRef);
		node.id = nodeRef.key;
		set(nodeRef, node);
	} else {
		latestNodesSource = upsertNode(latestNodesSource, node);
		renderScene();
	}
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
// multi
	if (activeNodeDrag && activeNodeDrag.pointerId === event.pointerId) {
		interactionState.consumeClick = activeNodeDrag.moved;
		if (activeNodeDrag.moved) {
			if (activeNodeDrag.historySnapshot) {
				pushHistorySnapshot(activeNodeDrag.historySnapshot);
			}

			const nodeIds = activeNodeDrag.selectedNodeIds ?? [activeNodeDrag.nodeId];
			const originLookup =
				activeNodeDrag.selectedNodeOrigins ??
				new Map([[activeNodeDrag.nodeId, { x: activeNodeDrag.originX, y: activeNodeDrag.originY, size: defaultNodeSize }]]);
			const deltaX = activeNodeDrag.deltaX ?? 0;
			const deltaY = activeNodeDrag.deltaY ?? 0;
			const finalNodes = normalizeNodes(latestNodesSource);

			for (const nodeId of nodeIds) {
				const node = finalNodes.find((entry) => entry.id === nodeId);
				const origin = originLookup.get(nodeId);

				if (!node || !origin) {
					continue;
				}

				node.x = clamp(origin.x + deltaX, node.size / 2, canvasSize - node.size / 2);
				node.y = clamp(origin.y + deltaY, node.size / 2, canvasSize - node.size / 2);
				persistNode(node);
			}

			latestNodesSource = finalNodes;
		}
		activeNodeDrag = null;
	}

	if (activeResize && activeResize.pointerId === event.pointerId) {
		interactionState.consumeClick = activeResize.moved;
		if (activeResize.moved) {
			if (activeResize.historySnapshot) {
				pushHistorySnapshot(activeResize.historySnapshot);
			}

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

		activeNodeDrag.deltaX = deltaX;
		activeNodeDrag.deltaY = deltaY;

		if (!activeNodeDrag.moved) {
			return;
		}
// multi
		const nextNodes = normalizeNodes(latestNodesSource);
		const nodeIds = activeNodeDrag.selectedNodeIds ?? [activeNodeDrag.nodeId];
		const originLookup = activeNodeDrag.selectedNodeOrigins ?? new Map([[activeNodeDrag.nodeId, { x: activeNodeDrag.originX, y: activeNodeDrag.originY }]]);

		for (const nodeId of nodeIds) {
			const nextNode = nextNodes.find((entry) => entry.id === nodeId);
			const origin = originLookup.get(nodeId);

			if (!nextNode || !origin) {
				continue;
			}

			nextNode.x = clamp(origin.x + deltaX, nextNode.size / 2, canvasSize - nextNode.size / 2);
			nextNode.y = clamp(origin.y + deltaY, nextNode.size / 2, canvasSize - nextNode.size / 2);
		}

		latestNodesSource = nextNodes;
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

window.addEventListener("keydown", (event) => {
	// Space key dismisses the description popup (any layout)
	if (event.key === " " && activeDescNodeId && !isEditableShortcutTarget(event.target)) {
		event.preventDefault();
		hideNodeDesc(true);
		return;
	}

	if (!isDesktopLayout() || !renameDialog.hidden || isEditableShortcutTarget(event.target)) {
		return;
	}

	const key = event.key.toLowerCase();
	const isUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
	const isRedo = (event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey));

	if (!isUndo && !isRedo) {
		return;
	}

	event.preventDefault();

	if (isUndo) {
		undoTreeChange();
	} else {
		redoTreeChange();
	}
});

// Clicking blank space on mobile dismisses the description popup
viewportFrame.addEventListener("click", (event) => {
	if (activeDescNodeId && !event.target.closest(".skill-node, .skill-node-desc")) {
		hideNodeDesc(true);
	}
}, { capture: false });

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

	if (event.target.closest(".skill-rename-dialog")) {
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
		if (!renameDialog.hidden) {
			closeRenameDialog();
			return;
		}

		if (deleteMode) {
			setDeleteMode(false);
			return;
		}

		firstSelectedNodeId = null;
		renderSelection();
	}
});

renameForm.addEventListener("submit", (event) => {
	event.preventDefault();
	saveRenameDialog();
});

for (const cancelTarget of renameCancelTargets) {
	cancelTarget.addEventListener("click", () => {
		closeRenameDialog();
	});
}

renameInput.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		closeRenameDialog();
	}
});

function handleLayoutChange() {
	if (!isDesktopLayout()) {
		closeRenameDialog();
		editMode = false;
		deleteMode = false;
		clearSelectedNodes();
		firstSelectedNodeId = null;
	}

	updateControlsUi();
	renderScene();
}

desktopQuery.addEventListener("change", handleLayoutChange);
window.addEventListener("resize", refreshViewportBounds);

function disconnectSkillSync() {
	if (typeof nodesUnsubscribe === "function") {
		nodesUnsubscribe();
	}

	if (typeof connectionsUnsubscribe === "function") {
		connectionsUnsubscribe();
	}

	nodesUnsubscribe = null;
	connectionsUnsubscribe = null;
	nodesRef = null;
	connectionsRef = null;
	currentUserId = null;
	lastNodesDigest = "";
	lastConnectionsDigest = "";
	resetHistory();
}

function resetSkillState() {
	latestNodesSource = cloneGuestDemoNodes();
	latestConnectionsSource = cloneGuestDemoConnections();
	firstSelectedNodeId = null;
	clearSelectedNodes();
	closeRenameDialog();
	editMode = false;
	deleteMode = false;
	resetHistory();
	lastNodesDigest = nodeDigest(latestNodesSource);
	lastConnectionsDigest = connectionDigest(latestConnectionsSource);
	updateControlsUi();
	renderScene();
}

function connectSkillSyncForUser(user) {
	disconnectSkillSync();

	if (!user) {
		currentAuthUser = null;
		resetSkillState();
		updateControlsUi();
		renderScene();
		return;
	}

	currentAuthUser = user;
	currentUserId = user.uid;
	nodesRef = ref(database, `users/${user.uid}/skillTree/nodes`);
	connectionsRef = ref(database, `users/${user.uid}/skillTree/connections`);

	nodesUnsubscribe = onValue(nodesRef, (snapshot) => {
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

	connectionsUnsubscribe = onValue(connectionsRef, (snapshot) => {
		const incoming = normalizeConnections(snapshot.val());
		const digest = connectionDigest(incoming);

		latestConnectionsSource = incoming;

		if (digest === lastConnectionsDigest) {
			return;
		}

		lastConnectionsDigest = digest;
		renderScene();
	});

	updateControlsUi();
}

subscribeAuthState((state) => {
	if (!state.ready) {
		return;
	}

	if (!state.user) {
		connectSkillSyncForUser(null);
		return;
	}

	if (currentUserId === state.user.uid && nodesRef && connectionsRef) {
		currentAuthUser = state.user;
		updateControlsUi();
		return;
	}

	connectSkillSyncForUser(state.user);
});

refreshViewportBounds();
centerCanvasView();
setEditMode(false);
