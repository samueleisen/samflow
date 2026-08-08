// skill-render.js — DOM rendering: nodes, connections, regions, selection, controls UI.
// No event listeners attached to individual elements (event delegation in skill-interactions.js).

import {
	normalizeNodes, normalizeConnections, normalizeRegions,
	computeNodeFontSize, escapeHtml,
	canvasWidth, canvasHeight,
	connectionStateColors, nodeStates,
	connectionArrowPadding, connectionStrokeWidth, connectionArrowWidth, connectionArrowHeight,
	nodeBorderWidth, nodeHitSlop,
} from "./skill-data.js";
import { store } from "./skill-store.js";
import { canEditStructure, canModifyStructure, canDelete, isDesktopLayout, editMode, deleteMode } from "./skill-mode.js";
import { isPopupActive, updateViewportCursor, renameDialog, regionEditDialog, detailWindow } from "./skill-dialogs.js";

const svgNs = "http://www.w3.org/2000/svg";

// ── DOM refs injected by orchestrator ─────────────────────────────────
let _nodeLayer = null;
let _lineLayer = null;
let _connectionLayer = null;
let _regionLayer = null;
let _selectionRectEl = null;
let _viewportFrame = null;
let _toggleEditBtn = null;
let _toggleDeleteBtn = null;
let _controlsHint = null;
let _getAuthUser = null;

export function initRender({ nodeLayer, lineLayer, regionLayer, selectionRectEl, viewportFrame, toggleEditBtn, toggleDeleteBtn, controlsHint, getAuthUser }) {
	_nodeLayer = nodeLayer;
	_lineLayer = lineLayer;
	_regionLayer = regionLayer;
	_selectionRectEl = selectionRectEl;
	_viewportFrame = viewportFrame;
	_toggleEditBtn = toggleEditBtn;
	_toggleDeleteBtn = toggleDeleteBtn;
	_controlsHint = controlsHint;
	_getAuthUser = getAuthUser;

	// SVG layer setup
	_connectionLayer = document.createElementNS(svgNs, "g");
	_connectionLayer.setAttribute("id", "skill-connection-layer");
	lineLayer.appendChild(_connectionLayer);
	lineLayer.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
	lineLayer.setAttribute("width", String(canvasWidth));
	lineLayer.setAttribute("height", String(canvasHeight));

	ensureConnectionMarkers();
}

// ── Connection Arrow Markers ──────────────────────────────────────────

function connectionMarkerId(state) {
	return `skill-arrow-${state}`;
}

export function ensureConnectionMarkers() {
	let defs = _lineLayer.querySelector("defs");
	if (!defs) {
		defs = document.createElementNS(svgNs, "defs");
		_lineLayer.prepend(defs);
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

// ── Node Geometry Helpers ─────────────────────────────────────────────

function nodeOutlineRadius(node) {
	return node.size / 2 + nodeBorderWidth;
}

export function findNodeAtCanvasPoint(x, y) {
	const hitRadius = (node) => nodeOutlineRadius(node) + nodeHitSlop;
	for (const node of normalizeNodes(store.nodesSource)) {
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
		return { x1: fromNode.x, y1: fromNode.y, x2: toNode.x, y2: toNode.y };
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

// ── Selection Helpers ─────────────────────────────────────────────────

// multi selector
export function renderSelection(selectedNodes = [], firstSelectedNodeId = null) {
	const selectedNodeIds = (selectedNodes && selectedNodes.length > 0)
		? new Set(selectedNodes)
		: firstSelectedNodeId
			? new Set([firstSelectedNodeId])
			: null;

	for (const child of _nodeLayer.children) {
		child.classList.toggle("is-selected", Boolean(selectedNodeIds?.has(child.dataset.nodeId)));
	}
}

// ── Connections ───────────────────────────────────────────────────────

export function renderConnections(nodes, connections) {
	const deleting = canDelete();
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	_connectionLayer.replaceChildren();

	for (const connection of connections) {
		const fromNode = nodesById.get(connection.from);
		const toNode = nodesById.get(connection.to);

		if (!fromNode || !toNode) continue;

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
		}

		_connectionLayer.appendChild(line);
	}
}

// ── Nodes ─────────────────────────────────────────────────────────────
// Listeners are NOT attached here — event delegation handles all node events
// in skill-interactions.js. _nodeData is still stored on the element for fast lookups.

export function renderNodes(nodes, selectedNodes, firstSelectedNodeId) {
	const structureEditing = canEditStructure();
	const modifying = canModifyStructure();
	const deleting = canDelete();

	// 1. Map existing children by nodeId
	const existingEls = new Map();
	for (const child of _nodeLayer.children) {
		const nodeId = child.dataset.nodeId;
		if (nodeId) existingEls.set(nodeId, child);
	}

	const activeIds = new Set();

	// 2. Loop through nodes to update or create
	for (const nodeData of nodes) {
		activeIds.add(nodeData.id);
		let node = existingEls.get(nodeData.id);

		if (!node) {
			// CREATE — no listeners, delegation handles everything
			node = document.createElement("button");
			node.type = "button";
			node.dataset.nodeId = nodeData.id;
			_nodeLayer.appendChild(node);
		}

		// UPDATE STATE AND STYLES
		node._nodeData = nodeData;
		node.className = `skill-node state-${nodeData.state}${deleting ? " is-deletable" : ""}`;
		node.style.width = `${nodeData.size}px`;
		node.style.height = `${nodeData.size}px`;
		node.style.left = `${nodeData.x - nodeData.size / 2}px`;
		node.style.top = `${nodeData.y - nodeData.size / 2}px`;
		node.setAttribute("aria-label", `${nodeData.title}, status ${nodeData.state}`);

		// Update or create label
		let labelEl = node.querySelector(".skill-node__label");
		if (!labelEl) {
			labelEl = document.createElement("span");
			labelEl.className = "skill-node__label";
			node.appendChild(labelEl);
		}

		const titleEscaped = escapeHtml(nodeData.title);
		if (labelEl.innerHTML !== titleEscaped) {
			labelEl.innerHTML = titleEscaped;
		}
		labelEl.style.fontSize = computeNodeFontSize(nodeData.title, nodeData.size);

		// Update or create resize handle
		let resizeEl = node.querySelector(".skill-node__resize");
		if (modifying) {
			if (!resizeEl) {
				resizeEl = document.createElement("span");
				resizeEl.className = "skill-node__resize";
				resizeEl.setAttribute("aria-hidden", "true");
				node.appendChild(resizeEl);
			}
		} else {
			if (resizeEl) resizeEl.remove();
		}
	}

	// 3. Remove obsolete nodes
	for (const [nodeId, childEl] of existingEls) {
		if (!activeIds.has(nodeId)) childEl.remove();
	}

	renderSelection(selectedNodes, firstSelectedNodeId);
}

// ── Regions ───────────────────────────────────────────────────────────
// Listeners NOT attached here — delegation in skill-interactions.js

export function renderRegions(regions) {
	const deleting = canDelete();

	const existingEls = new Map();
	for (const child of _regionLayer.children) {
		const regionId = child.dataset.regionId;
		if (regionId) existingEls.set(regionId, child);
	}

	const activeIds = new Set();

	for (const regionData of regions) {
		activeIds.add(regionData.id);
		let regionEl = existingEls.get(regionData.id);

		if (!regionEl) {
			regionEl = document.createElement("div");
			regionEl.dataset.regionId = regionData.id;
			_regionLayer.appendChild(regionEl);
		}

		regionEl.className = `skill-region${deleting ? " is-deletable" : (canModifyStructure() ? " is-draggable" : "")}`;
		regionEl.style.left = `${regionData.x}px`;
		regionEl.style.top = `${regionData.y}px`;
		regionEl.style.width = `${regionData.width}px`;
		regionEl.style.height = `${regionData.height}px`;
		regionEl.style.background = regionData.color;

		let labelEl = regionEl.querySelector(".skill-region__label");
		if (!labelEl) {
			labelEl = document.createElement("span");
			labelEl.className = "skill-region__label";
			regionEl.appendChild(labelEl);
		}
		if (labelEl.textContent !== regionData.title) {
			labelEl.textContent = regionData.title;
		}

		let resizeHandle = regionEl.querySelector(".skill-region__resize");
		if (canModifyStructure() && !deleting) {
			if (!resizeHandle) {
				resizeHandle = document.createElement("div");
				resizeHandle.className = "skill-region__resize";
				resizeHandle.title = "Drag to resize region";
				regionEl.appendChild(resizeHandle);
			}
		} else if (resizeHandle) {
			resizeHandle.remove();
		}
	}

	for (const [regionId, childEl] of existingEls) {
		if (!activeIds.has(regionId)) childEl.remove();
	}
}

// ── Scene ─────────────────────────────────────────────────────────────

export function renderScene(selectedNodes = [], firstSelectedNodeId = null) {
	const nodes = normalizeNodes(store.nodesSource);
	const connections = normalizeConnections(store.connectionsSource);
	const regions = normalizeRegions(store.regionsSource);

	renderRegions(regions);
	renderConnections(nodes, connections);
	renderNodes(nodes, selectedNodes, firstSelectedNodeId);
}

// ── Controls UI ───────────────────────────────────────────────────────

export function updateControlsUi() {
	const desktop = isDesktopLayout();
	const signedIn = Boolean(_getAuthUser?.());

	_viewportFrame.classList.toggle("is-desktop", desktop);
	_viewportFrame.classList.toggle("is-mobile", !desktop);
	_viewportFrame.classList.toggle("is-editing", canModifyStructure());
	_viewportFrame.classList.toggle("is-delete-mode", canDelete());
	_viewportFrame.classList.toggle("is-authenticated", signedIn);

	_toggleEditBtn.hidden = !desktop;
	_toggleEditBtn.disabled = !desktop;
	_toggleEditBtn.textContent = `Edit Mode: ${editMode ? "ON" : "OFF"}`;
	_toggleDeleteBtn.hidden = !canEditStructure();
	_toggleDeleteBtn.disabled = !canEditStructure();
	_toggleDeleteBtn.textContent = `Delete: ${deleteMode ? "ON" : "OFF"}`;
	_toggleDeleteBtn.setAttribute("aria-pressed", deleteMode ? "true" : "false");

	if (_controlsHint) {
		if (!signedIn) {
			_controlsHint.textContent = editMode
				? "Guest sandbox is on. Your edits stay in this browser and will not sync to Firebase."
				: "Guest sandbox is available. Turn on edit mode to change the tree locally, or sign in to sync.";
		} else if (!desktop) {
			_controlsHint.textContent = "Drag to pan. Tap a skill to cycle its status.";
		} else if (deleteMode) {
			_controlsHint.textContent = "Delete mode is on. Click a skill, connection, or region to remove it.";
		} else if (editMode) {
			_controlsHint.textContent =
				"Right-click and drag to create a region and select skills. Left-click and drag a region to move it with its nodes. Drag any selected skill to move the group. Click empty space to add skills. Click two skills to connect. Right-click a skill to rename it, a region to edit it. Double-click to change status.";
		} else {
			_controlsHint.textContent = "Drag to pan. Click a skill to cycle its status. Turn on edit mode to add, move, connect, and resize.";
		}
	}

	updateViewportCursor();
}
