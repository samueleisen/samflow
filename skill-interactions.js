// skill-interactions.js — All event handlers: pointer, touch, keyboard, wheel, mode setters, CRUD actions.
// Uses event delegation on nodeLayer and regionLayer instead of per-element listeners.

import {
	normalizeNodes, normalizeConnections, normalizeRegions,
	upsertNode, upsertConnection, upsertRegion,
	nextNodeState, createLocalId, nowStamp, clamp,
	canvasWidth, canvasHeight, defaultNodeSize, interactionThreshold,
	defaultRegionColor, serializeNodes, serializeConnections, serializeRegions,
	nodeDigest, connectionDigest, regionDigest,
} from "./skill-data.js";
import { store } from "./skill-store.js";
import {
	editMode, deleteMode, setEditMode, setDeleteMode,
	canEditStructure, canModifyStructure, canDelete, canChangeStatus,
	isDesktopLayout, isEditableShortcutTarget, desktopQuery,
} from "./skill-mode.js";
import { captureTreeSnapshot, pushHistorySnapshot, undoTreeChange, redoTreeChange, syncTreeSnapshot } from "./skill-history.js";
import { renderScene, renderSelection, updateControlsUi, findNodeAtCanvasPoint } from "./skill-render.js";
import {
	openRenameDialog, closeRenameDialog, closeRegionEditDialog, closeDetailWindow,
	openRegionEditDialog, openDetailWindow, showNodeDesc, hideNodeDesc,
	activeDescNodeId, renameDialog, regionEditDialog, detailWindow,
	getDescLongPressActive, setDescLongPressActive, clearDescLongPressTimer, setDescLongPressTimer,
} from "./skill-dialogs.js";

// ── Interaction state ─────────────────────────────────────────────────
let firstSelectedNodeId = null;
let selectedNodes = [];
let pendingNodePointer = null;
let activeNodeDrag = null;
let activeResize = null;
let activeSelectionRect = null;
let activeRegionDrag = null;
let activeRegionResize = null;

const interactionState = { consumeClick: false };

// ── Injected sync operations (from orchestrator) ──────────────────────
let _sync = null;
let _camera = null;
let _viewportFrame = null;
let _nodeLayer = null;
let _regionLayer = null;

export function mountInteractions(elements, syncOps) {
	_viewportFrame = elements.viewportFrame;
	_nodeLayer = elements.nodeLayer;
	_regionLayer = elements.regionLayer;
	_camera = elements.camera;
	_sync = syncOps;

	_bindNodeLayerDelegation();
	_bindRegionLayerDelegation();
	_bindViewportListeners();
	_bindGlobalListeners();
}

// ── Selection helpers ─────────────────────────────────────────────────

export function clearSelectedNodes() {
	selectedNodes = [];
}

function toggleSelectedNode(nodeId) {
	firstSelectedNodeId = null;
	if (selectedNodes.includes(nodeId)) {
		selectedNodes = selectedNodes.filter((id) => id !== nodeId);
	} else {
		selectedNodes = [...selectedNodes, nodeId];
	}
	renderSelection(selectedNodes, firstSelectedNodeId);
}

function isSelectedNode(nodeId) {
	return selectedNodes.includes(nodeId);
}

function removeSelectedNode(nodeId) {
	if (!selectedNodes.includes(nodeId)) return;
	selectedNodes = selectedNodes.filter((id) => id !== nodeId);
	renderSelection(selectedNodes, firstSelectedNodeId);
}

// ── CRUD Actions ──────────────────────────────────────────────────────

function cycleNodeStatus(nodeId) {
	const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === nodeId);
	if (!node) return;

	pushHistorySnapshot(captureTreeSnapshot());

	const updated = { ...node, state: nextNodeState(node.state), updatedAt: nowStamp() };
	store.nodesSource = upsertNode(store.nodesSource, updated);
	_renderSceneWithSelection();
	_sync.persistNode(updated);
}

export function deleteNode(nodeId) {
	pushHistorySnapshot(captureTreeSnapshot());

	if (!_sync.hasRemoteTreeSync()) {
		store.nodesSource = normalizeNodes(store.nodesSource).filter((node) => node.id !== nodeId);
		store.connectionsSource = normalizeConnections(store.connectionsSource).filter(
			(connection) => connection.from !== nodeId && connection.to !== nodeId,
		);
		if (firstSelectedNodeId === nodeId) firstSelectedNodeId = null;
		removeSelectedNode(nodeId);
		closeRenameDialog(); // always safe — dialog module checks its own activeRenameNodeId
		_renderSceneWithSelection();
		return;
	}

	_sync.deleteNode(nodeId);

	for (const connection of normalizeConnections(store.connectionsSource)) {
		if (connection.from === nodeId || connection.to === nodeId) {
			deleteConnection(connection.id, true);
		}
	}

	if (firstSelectedNodeId === nodeId) firstSelectedNodeId = null;
	removeSelectedNode(nodeId);
	closeRenameDialog();
}

export function deleteConnection(connectionId, skipHistory = false) {
	if (!skipHistory) pushHistorySnapshot(captureTreeSnapshot());
	store.connectionsSource = normalizeConnections(store.connectionsSource).filter(
		(connection) => connection.id !== connectionId,
	);
	_renderSceneWithSelection();
	if (_sync.hasRemoteTreeSync()) _sync.deleteConnection(connectionId);
}

export function deleteRegion(regionId) {
	pushHistorySnapshot(captureTreeSnapshot());

	if (!_sync.hasRemoteTreeSync()) {
		store.regionsSource = normalizeRegions(store.regionsSource).filter((region) => region.id !== regionId);
		closeRegionEditDialog();
		_renderSceneWithSelection();
		return;
	}

	_sync.deleteRegion(regionId);
	closeRegionEditDialog();
}

function createNodeAtEvent(event) {
	const point = _camera.getCanvasPoint(event.clientX, event.clientY);
	if (findNodeAtCanvasPoint(point.x, point.y)) return;

	const title = window.prompt("Enter Skill Title:");
	const value = title?.trim();
	if (!value) return;

	const descPrompt = window.prompt("Description (optional — leave blank to skip):");
	const description = String(descPrompt ?? "").trim();

	pushHistorySnapshot(captureTreeSnapshot());
	const node = {
		id: _sync.hasRemoteTreeSync() ? null : createLocalId("node"),
		title: value,
		description,
		x: point.x,
		y: point.y,
		size: defaultNodeSize,
		state: "deactivated",
		createdAt: nowStamp(),
	};

	if (_sync.hasRemoteTreeSync()) {
		_sync.pushNewNode(node);
	} else {
		store.nodesSource = upsertNode(store.nodesSource, node);
		_renderSceneWithSelection();
	}
	firstSelectedNodeId = null;
}

function handleNodeSelection(nodeId) {
	if (!canModifyStructure()) return;

	if (!firstSelectedNodeId) {
		firstSelectedNodeId = nodeId;
		renderSelection(selectedNodes, firstSelectedNodeId);
		return;
	}

	if (firstSelectedNodeId === nodeId) {
		firstSelectedNodeId = null;
		renderSelection(selectedNodes, firstSelectedNodeId);
		return;
	}

	const existing = normalizeConnections(store.connectionsSource).some(
		(connection) => connection.from === firstSelectedNodeId && connection.to === nodeId,
	);

	if (!existing) {
		pushHistorySnapshot(captureTreeSnapshot());

		if (_sync.hasRemoteTreeSync()) {
			_sync.pushNewConnection({ from: firstSelectedNodeId, to: nodeId, createdAt: nowStamp() });
		} else {
			store.connectionsSource = upsertConnection(store.connectionsSource, {
				id: createLocalId("connection"),
				from: firstSelectedNodeId,
				to: nodeId,
				createdAt: nowStamp(),
			});
			_renderSceneWithSelection();
		}
	}

	firstSelectedNodeId = null;
	renderSelection(selectedNodes, firstSelectedNodeId);
}

// ── Mode Setters (with side effects) ─────────────────────────────────

export function applyEditMode(nextMode) {
	closeRenameDialog();
	closeRegionEditDialog();

	if (!isDesktopLayout()) {
		setEditMode(false);
	} else {
		setEditMode(nextMode);
	}

	if (!editMode) {
		setDeleteMode(false);
		clearSelectedNodes();
	}

	firstSelectedNodeId = null;
	updateControlsUi();
	_renderSceneWithSelection();
}

export function applyDeleteMode(nextMode) {
	closeRenameDialog();

	if (!canEditStructure()) {
		setDeleteMode(false);
	} else {
		setDeleteMode(nextMode);
	}

	firstSelectedNodeId = null;
	updateControlsUi();
	_renderSceneWithSelection();
}

// ── Pointer Interaction State Machine ─────────────────────────────────

function beginNodePointer(nodeId, event, mode) {
	const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === nodeId);
	if (!node) return;

	const point = _camera.getCanvasPoint(event.clientX, event.clientY);
	pendingNodePointer = {
		mode,
		nodeId,
		pointerId: event.pointerId,
		startX: point.x,
		startY: point.y,
		originX: node.x,
		originY: node.y,
		originSize: node.size,
		selectedNodeIds: mode === "drag" && isSelectedNode(nodeId) ? [...selectedNodes] : null,
		selectedNodeOrigins:
			mode === "drag" && isSelectedNode(nodeId)
				? new Map(
					normalizeNodes(store.nodesSource).map((entry) => [
						entry.id,
						{ x: entry.x, y: entry.y, size: entry.size },
					]),
				)
				: null,
		historySnapshot: mode === "drag" || mode === "resize" ? captureTreeSnapshot() : null,
	};
	interactionState.consumeClick = false;
}

function promotePendingNodePointer(event) {
	if (!pendingNodePointer || pendingNodePointer.pointerId !== event.pointerId) return;

	const pending = pendingNodePointer;
	pendingNodePointer = null;
	_viewportFrame.setPointerCapture(event.pointerId);

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
	const point = _camera.getCanvasPoint(event.clientX, event.clientY);
	return Math.hypot(point.x - startX, point.y - startY) > interactionThreshold;
}

function beginPan(event) {
	_camera.beginPan(event);
	interactionState.consumeClick = false;
	_viewportFrame.setPointerCapture(event.pointerId);
}

function finishPointerInteraction(event) {
	if (pendingNodePointer && pendingNodePointer.pointerId === event.pointerId) {
		if (pendingNodePointer.mode === "delete") {
			deleteNode(pendingNodePointer.nodeId);
		} else if (pendingNodePointer.mode === "drag") {
			if (event.shiftKey) {
				toggleSelectedNode(pendingNodePointer.nodeId);
			} else {
				handleNodeSelection(pendingNodePointer.nodeId);
			}
		}
		interactionState.consumeClick = true;
		pendingNodePointer = null;
	}

	if (_camera.activePan && _camera.activePan.pointerId === event.pointerId) {
		interactionState.consumeClick = _camera.activePan.moved;
		_camera.activePan = null;
	}

	// multi
	if (activeNodeDrag && activeNodeDrag.pointerId === event.pointerId) {
		interactionState.consumeClick = activeNodeDrag.moved;
		if (activeNodeDrag.moved) {
			if (activeNodeDrag.historySnapshot) pushHistorySnapshot(activeNodeDrag.historySnapshot);

			const nodeIds = activeNodeDrag.selectedNodeIds ?? [activeNodeDrag.nodeId];
			const originLookup =
				activeNodeDrag.selectedNodeOrigins ??
				new Map([[activeNodeDrag.nodeId, { x: activeNodeDrag.originX, y: activeNodeDrag.originY, size: defaultNodeSize }]]);
			const deltaX = activeNodeDrag.deltaX ?? 0;
			const deltaY = activeNodeDrag.deltaY ?? 0;
			const finalNodes = normalizeNodes(store.nodesSource);

			for (const nodeId of nodeIds) {
				const node = finalNodes.find((entry) => entry.id === nodeId);
				const origin = originLookup.get(nodeId);
				if (!node || !origin) continue;

				node.x = clamp(origin.x + deltaX, node.size / 2, canvasWidth - node.size / 2);
				node.y = clamp(origin.y + deltaY, node.size / 2, canvasHeight - node.size / 2);
				_sync.persistNode(node);
			}

			store.nodesSource = finalNodes;
		}
		activeNodeDrag = null;
	}

	if (activeResize && activeResize.pointerId === event.pointerId) {
		interactionState.consumeClick = activeResize.moved;
		if (activeResize.moved) {
			if (activeResize.historySnapshot) pushHistorySnapshot(activeResize.historySnapshot);
			const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === activeResize.nodeId);
			if (node) _sync.persistNode(node);
		}
		activeResize = null;
	}

	if (activeRegionDrag && activeRegionDrag.pointerId === event.pointerId) {
		interactionState.consumeClick = activeRegionDrag.moved;
		if (activeRegionDrag.moved) {
			if (activeRegionDrag.historySnapshot) pushHistorySnapshot(activeRegionDrag.historySnapshot);

			const region = normalizeRegions(store.regionsSource).find((r) => r.id === activeRegionDrag.regionId);
			if (region) _sync.persistRegion(region);

			const finalNodes = normalizeNodes(store.nodesSource);
			for (const [nodeId] of activeRegionDrag.containedNodeOrigins) {
				const node = finalNodes.find((n) => n.id === nodeId);
				if (node) _sync.persistNode(node);
			}
		}
		activeRegionDrag = null;
	}

	if (activeRegionResize && activeRegionResize.pointerId === event.pointerId) {
		interactionState.consumeClick = activeRegionResize.moved;
		if (activeRegionResize.moved) {
			if (activeRegionResize.historySnapshot) pushHistorySnapshot(activeRegionResize.historySnapshot);
			const region = normalizeRegions(store.regionsSource).find((r) => r.id === activeRegionResize.regionId);
			if (region) _sync.persistRegion(region);
		}
		activeRegionResize = null;
	}

	if (_viewportFrame.hasPointerCapture(event.pointerId)) {
		_viewportFrame.releasePointerCapture(event.pointerId);
	}
}

function finishSelectionRect(event) {
	if (!activeSelectionRect || activeSelectionRect.pointerId !== event.pointerId) return;

	const isShiftSelect = Boolean(activeSelectionRect.isShiftSelect);
	const minX = Math.min(activeSelectionRect.startX, activeSelectionRect.currentX);
	const minY = Math.min(activeSelectionRect.startY, activeSelectionRect.currentY);
	const maxX = Math.max(activeSelectionRect.startX, activeSelectionRect.currentX);
	const maxY = Math.max(activeSelectionRect.startY, activeSelectionRect.currentY);

	const selectionRectEl = _viewportFrame.querySelector(".skill-selection-rect");
	if (selectionRectEl) selectionRectEl.hidden = true;
	activeSelectionRect = null;

	if (_viewportFrame.hasPointerCapture(event.pointerId)) {
		_viewportFrame.releasePointerCapture(event.pointerId);
	}

	const rectWidth = maxX - minX;
	const rectHeight = maxY - minY;
	if (rectWidth < interactionThreshold && rectHeight < interactionThreshold) return;

	// Select nodes inside the rect
	const nodes = normalizeNodes(store.nodesSource);
	const hits = [];
	for (const node of nodes) {
		if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
			hits.push(node.id);
		}
	}
	if (hits.length > 0) {
		selectedNodes = hits;
		firstSelectedNodeId = null;
		renderSelection(selectedNodes, firstSelectedNodeId);
	}

	// If triggered via Shift + Left-Click drag, it is a pure selection box (no Region creation prompt)
	if (isShiftSelect) {
		return;
	}

	// Create a persistent region from the rect (Right-Click drag)
	const title = window.prompt("Enter Region Title:");
	const value = title?.trim();
	if (!value) return;

	pushHistorySnapshot(captureTreeSnapshot());
	const regionData = {
		id: _sync.hasRemoteTreeSync() ? null : createLocalId("region"),
		title: value,
		color: defaultRegionColor,
		x: minX,
		y: minY,
		width: rectWidth,
		height: rectHeight,
		createdAt: nowStamp(),
	};

	if (_sync.hasRemoteTreeSync()) {
		_sync.pushNewRegion(regionData);
	} else {
		store.regionsSource = upsertRegion(store.regionsSource, regionData);
		_renderSceneWithSelection();
	}
}

// ── Event Delegation: nodeLayer ───────────────────────────────────────

function _bindNodeLayerDelegation() {
	_nodeLayer.addEventListener("mouseenter", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!isDesktopLayout() || !data || !(data.description ?? "").trim()) return;
		showNodeDesc(data.id);
	}, { capture: true });

	_nodeLayer.addEventListener("mouseleave", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!isDesktopLayout() || !data || activeDescNodeId !== data.id) return;
		hideNodeDesc();
	}, { capture: true });

	_nodeLayer.addEventListener("touchstart", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!isDesktopLayout() || !data) return;
		if (!(data.description ?? "").trim() && !data.mediaUrl) return;

		setDescLongPressActive(false);
		clearDescLongPressTimer();
		setDescLongPressTimer(setTimeout(() => {
			setDescLongPressActive(true);
			hideNodeDesc(true);
			openDetailWindow(data.id);
		}, 500));
	}, { passive: true });

	_nodeLayer.addEventListener("touchend", () => {
		clearDescLongPressTimer();
	}, { passive: true });

	_nodeLayer.addEventListener("touchmove", () => {
		clearDescLongPressTimer();
	}, { passive: true });

	_nodeLayer.addEventListener("contextmenu", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!data) return;

		if (canModifyStructure()) {
			event.preventDefault();
			event.stopPropagation();
			hideNodeDesc(true);
			openRenameDialog(data.id);
			return;
		}

		if (isDesktopLayout() && !editMode) {
			event.preventDefault();
			event.stopPropagation();
			hideNodeDesc(true);
			openDetailWindow(data.id);
		}
	});

	_nodeLayer.addEventListener("pointerdown", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!canEditStructure() || event.button !== 0 || !data) return;

		event.stopPropagation();
		if (canDelete()) {
			beginNodePointer(data.id, event, "delete");
			return;
		}
		if (!canModifyStructure()) return;
		const resizeHandle = event.target.closest(".skill-node__resize");
		beginNodePointer(data.id, event, resizeHandle ? "resize" : "drag");
	});

	_nodeLayer.addEventListener("click", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!data) return;
		event.stopPropagation();

		if (getDescLongPressActive()) { setDescLongPressActive(false); return; }
		if (interactionState.consumeClick) { interactionState.consumeClick = false; return; }
		if (canDelete()) { deleteNode(data.id); return; }
		if (canEditStructure()) return;
		event.preventDefault();
		if (canChangeStatus()) cycleNodeStatus(data.id);
	});

	_nodeLayer.addEventListener("dblclick", (event) => {
		const nodeEl = event.target.closest(".skill-node");
		if (!nodeEl) return;
		const data = nodeEl._nodeData;
		if (!data || !canModifyStructure()) return;
		if (interactionState.consumeClick) return;
		event.preventDefault();
		event.stopPropagation();
		firstSelectedNodeId = null;
		renderSelection(selectedNodes, firstSelectedNodeId);
		cycleNodeStatus(data.id);
	});
}

// ── Event Delegation: regionLayer ─────────────────────────────────────

function _bindRegionLayerDelegation() {
	_regionLayer.addEventListener("contextmenu", (event) => {
		const regionEl = event.target.closest(".skill-region");
		if (!regionEl) return;
		const id = regionEl.dataset.regionId;
		if (!id || !canModifyStructure()) return;
		event.preventDefault();
		event.stopPropagation();
		openRegionEditDialog(id);
	});

	_regionLayer.addEventListener("click", (event) => {
		const regionEl = event.target.closest(".skill-region");
		if (!regionEl) return;
		const id = regionEl.dataset.regionId;
		if (!id) return;
		event.stopPropagation();
		if (canDelete()) deleteRegion(id);
	});

	_regionLayer.addEventListener("pointerdown", (event) => {
		const resizeEl = event.target.closest(".skill-region__resize");
		const regionEl = event.target.closest(".skill-region");
		if (!regionEl) return;
		const id = regionEl.dataset.regionId;
		if (!id || event.button !== 0 || !canModifyStructure()) return;
		event.stopPropagation();
		event.preventDefault();

		const region = normalizeRegions(store.regionsSource).find((r) => r.id === id);
		if (!region) return;

		const start = _camera.getCanvasPoint(event.clientX, event.clientY);

		if (resizeEl) {
			activeRegionResize = {
				regionId: id,
				pointerId: event.pointerId,
				startX: start.x,
				startY: start.y,
				originWidth: region.width,
				originHeight: region.height,
				moved: false,
				historySnapshot: captureTreeSnapshot(),
			};
		} else {
			const containedNodeOrigins = new Map();
			for (const node of normalizeNodes(store.nodesSource)) {
				if (
					node.x >= region.x && node.x <= region.x + region.width &&
					node.y >= region.y && node.y <= region.y + region.height
				) {
					containedNodeOrigins.set(node.id, { x: node.x, y: node.y });
				}
			}
			activeRegionDrag = {
				regionId: id,
				pointerId: event.pointerId,
				startX: start.x,
				startY: start.y,
				originX: region.x,
				originY: region.y,
				containedNodeOrigins,
				moved: false,
				historySnapshot: captureTreeSnapshot(),
			};
		}

		interactionState.consumeClick = false;
		_viewportFrame.setPointerCapture(event.pointerId);
	});
}

// ── Viewport & Window Listeners ───────────────────────────────────────

function _bindViewportListeners() {
	// Pan (left-click, no edit mode and no Shift key)
	_viewportFrame.addEventListener("pointerdown", (event) => {
		if (_camera.activePinch || event.button !== 0 || (canEditStructure() && event.shiftKey) || canDelete()) return;
		if (event.target.closest(".skill-controls, .skill-node, .skill-node__resize, .skill-detail-window, .skill-rename-dialog")) return;
		beginPan(event);
	});

	// ── Selection rectangle (Right-click OR Shift + Left-click drag in edit mode)
	_viewportFrame.addEventListener("pointerdown", (event) => {
		const isRightClick = event.button === 2;
		const isShiftLeftClick = event.button === 0 && event.shiftKey;

		if ((!isRightClick && !isShiftLeftClick) || !canEditStructure() || canDelete()) return;
		if (event.target.closest(".skill-node, .skill-region, .skill-controls, .skill-detail-window, .skill-rename-dialog, .skill-region-dialog")) return;

		const point = _camera.getCanvasPoint(event.clientX, event.clientY);
		if (findNodeAtCanvasPoint(point.x, point.y)) return;

		event.preventDefault();
		event.stopPropagation();
		_viewportFrame.setPointerCapture(event.pointerId);

		activeSelectionRect = {
			pointerId: event.pointerId,
			startX: point.x,
			startY: point.y,
			currentX: point.x,
			currentY: point.y,
			isShiftSelect: isShiftLeftClick,
		};

		const selectionRectEl = _viewportFrame.querySelector(".skill-selection-rect");
		if (selectionRectEl) {
			selectionRectEl.style.left = `${point.x}px`;
			selectionRectEl.style.top = `${point.y}px`;
			selectionRectEl.style.width = "0px";
			selectionRectEl.style.height = "0px";
			selectionRectEl.hidden = false;
		}
	});

	_viewportFrame.addEventListener("contextmenu", (event) => {
		if (!canEditStructure()) return;
		if (event.target.closest(".skill-node, .skill-region, .skill-controls, .skill-detail-window, .skill-rename-dialog, .skill-region-dialog")) return;
		event.preventDefault();
	});

	_viewportFrame.addEventListener("pointermove", (event) => {
		if (_camera.activePinch) return;

		if (activeSelectionRect && activeSelectionRect.pointerId === event.pointerId) {
			const point = _camera.getCanvasPoint(event.clientX, event.clientY);
			activeSelectionRect.currentX = point.x;
			activeSelectionRect.currentY = point.y;

			const minX = Math.min(activeSelectionRect.startX, point.x);
			const minY = Math.min(activeSelectionRect.startY, point.y);
			const maxX = Math.max(activeSelectionRect.startX, point.x);
			const maxY = Math.max(activeSelectionRect.startY, point.y);

			const selectionRectEl = _viewportFrame.querySelector(".skill-selection-rect");
			if (selectionRectEl) {
				selectionRectEl.style.left = `${minX}px`;
				selectionRectEl.style.top = `${minY}px`;
				selectionRectEl.style.width = `${maxX - minX}px`;
				selectionRectEl.style.height = `${maxY - minY}px`;
			}
			return;
		}

		if (activeRegionDrag && activeRegionDrag.pointerId === event.pointerId) {
			const point = _camera.getCanvasPoint(event.clientX, event.clientY);
			const deltaX = point.x - activeRegionDrag.startX;
			const deltaY = point.y - activeRegionDrag.startY;

			if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
				activeRegionDrag.moved = true;
			}
			if (!activeRegionDrag.moved) return;

			activeRegionDrag.deltaX = deltaX;
			activeRegionDrag.deltaY = deltaY;

			const nextRegions = normalizeRegions(store.regionsSource);
			const region = nextRegions.find((r) => r.id === activeRegionDrag.regionId);
			if (region) {
				region.x = clamp(activeRegionDrag.originX + deltaX, 0, canvasWidth - region.width);
				region.y = clamp(activeRegionDrag.originY + deltaY, 0, canvasHeight - region.height);
			}
			store.regionsSource = nextRegions;

			const nextNodes = normalizeNodes(store.nodesSource);
			for (const [nodeId, origin] of activeRegionDrag.containedNodeOrigins) {
				const node = nextNodes.find((n) => n.id === nodeId);
				if (!node) continue;
				node.x = clamp(origin.x + deltaX, node.size / 2, canvasWidth - node.size / 2);
				node.y = clamp(origin.y + deltaY, node.size / 2, canvasHeight - node.size / 2);
			}
			store.nodesSource = nextNodes;
			_renderSceneWithSelection();
			return;
		}

		if (activeRegionResize && activeRegionResize.pointerId === event.pointerId) {
			const point = _camera.getCanvasPoint(event.clientX, event.clientY);
			const deltaX = point.x - activeRegionResize.startX;
			const deltaY = point.y - activeRegionResize.startY;

			if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
				activeRegionResize.moved = true;
			}
			if (!activeRegionResize.moved) return;

			const nextRegions = normalizeRegions(store.regionsSource);
			const region = nextRegions.find((r) => r.id === activeRegionResize.regionId);
			if (region) {
				region.width = clamp(activeRegionResize.originWidth + deltaX, 80, canvasWidth - region.x);
				region.height = clamp(activeRegionResize.originHeight + deltaY, 60, canvasHeight - region.y);
			}
			store.regionsSource = nextRegions;
			_renderSceneWithSelection();
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

		if (_camera.activePan && _camera.activePan.pointerId === event.pointerId) {
			const deltaX = event.clientX - _camera.activePan.startClientX;
			const deltaY = event.clientY - _camera.activePan.startClientY;

			if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
				_camera.activePan.moved = true;
			}

			const clamped = _camera.clampPan(_camera.activePan.originX + deltaX, _camera.activePan.originY + deltaY);
			_camera.panX = clamped.x;
			_camera.panY = clamped.y;
			_camera.updateCanvasTransform();
		}

		if (activeNodeDrag && activeNodeDrag.pointerId === event.pointerId) {
			const point = _camera.getCanvasPoint(event.clientX, event.clientY);
			const deltaX = point.x - activeNodeDrag.startX;
			const deltaY = point.y - activeNodeDrag.startY;

			if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
				activeNodeDrag.moved = true;
			}

			activeNodeDrag.deltaX = deltaX;
			activeNodeDrag.deltaY = deltaY;

			if (!activeNodeDrag.moved) return;

			// multi
			const nextNodes = normalizeNodes(store.nodesSource);
			const nodeIds = activeNodeDrag.selectedNodeIds ?? [activeNodeDrag.nodeId];
			const originLookup = activeNodeDrag.selectedNodeOrigins ?? new Map([[activeNodeDrag.nodeId, { x: activeNodeDrag.originX, y: activeNodeDrag.originY }]]);

			for (const nodeId of nodeIds) {
				const nextNode = nextNodes.find((entry) => entry.id === nodeId);
				const origin = originLookup.get(nodeId);
				if (!nextNode || !origin) continue;
				nextNode.x = clamp(origin.x + deltaX, nextNode.size / 2, canvasWidth - nextNode.size / 2);
				nextNode.y = clamp(origin.y + deltaY, nextNode.size / 2, canvasHeight - nextNode.size / 2);
			}

			store.nodesSource = nextNodes;
			_renderSceneWithSelection();
		}

		if (activeResize && activeResize.pointerId === event.pointerId) {
			const point = _camera.getCanvasPoint(event.clientX, event.clientY);
			const deltaX = point.x - activeResize.startX;
			const deltaY = point.y - activeResize.startY;

			if (Math.abs(deltaX) > interactionThreshold || Math.abs(deltaY) > interactionThreshold) {
				activeResize.moved = true;
			}
			if (!activeResize.moved) return;

			const nextNode = normalizeNodes(store.nodesSource).find((entry) => entry.id === activeResize.nodeId);
			if (!nextNode) return;

			nextNode.size = clamp(activeResize.originSize + Math.max(deltaX, deltaY), 60, 220);
			store.nodesSource = upsertNode(store.nodesSource, nextNode);
			_renderSceneWithSelection();
		}
	});

	_viewportFrame.addEventListener("pointerup", (event) => {
		finishSelectionRect(event);
		finishPointerInteraction(event);
	});

	_viewportFrame.addEventListener("pointercancel", (event) => {
		finishSelectionRect(event);
		finishPointerInteraction(event);
	});

	_viewportFrame.addEventListener(
		"wheel",
		(event) => {
			if (!isDesktopLayout()) return;
			if (!detailWindow.hidden || !renameDialog.hidden) return;

			event.preventDefault();
			const viewportX = event.clientX - _camera.viewportBounds.left;
			const viewportY = event.clientY - _camera.viewportBounds.top;
			const zoomFactor = Math.exp(-event.deltaY * 0.0015);
			_camera.setZoomAtViewportPoint(viewportX, viewportY, _camera.zoom * zoomFactor);
		},
		{ passive: false },
	);

	// Clicking blank space on mobile dismisses the description popup
	_viewportFrame.addEventListener("click", (event) => {
		if (activeDescNodeId && !event.target.closest(".skill-node, .skill-node-desc")) {
			hideNodeDesc(true);
		}
	}, { capture: false });

	// Create node on click in edit mode
	_viewportFrame.addEventListener("click", (event) => {
		if (event.shiftKey || !canModifyStructure()) return;
		if (event.target.closest(".skill-rename-dialog, .skill-detail-window, .skill-region-dialog")) return;
		if (interactionState.consumeClick) { interactionState.consumeClick = false; return; }
		if (event.target.closest(".skill-controls, .skill-node, .skill-node__resize, .skill-connection, .skill-region")) return;

		const point = _camera.getCanvasPoint(event.clientX, event.clientY);
		if (findNodeAtCanvasPoint(point.x, point.y)) return;
		createNodeAtEvent(event);
	});

	// Delete connection click (delegated via SVG line)
	_viewportFrame.addEventListener("click", (event) => {
		if (!canDelete()) return;
		const lineEl = event.target.closest(".skill-connection");
		if (!lineEl) return;
		const connectionId = lineEl.dataset.connectionId;
		if (connectionId) {
			event.stopPropagation();
			deleteConnection(connectionId);
		}
	});

	_viewportFrame.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			if (!regionEditDialog.hidden) { closeRegionEditDialog(); return; }
			if (!detailWindow.hidden) { closeDetailWindow(); return; }
			if (!renameDialog.hidden) { closeRenameDialog(); return; }
			if (deleteMode) { applyDeleteMode(false); return; }
			firstSelectedNodeId = null;
			renderSelection(selectedNodes, firstSelectedNodeId);
		}
	});

	_viewportFrame.addEventListener(
		"touchstart",
		(event) => {
			if (event.touches.length !== 2) return;
			if (event.target.closest(".skill-controls, .page-nav-arrow, .skill-detail-window, .skill-rename-dialog")) return;

			event.preventDefault();
			if (_camera.activePan) { _camera.activePan = null; pendingNodePointer = null; }

			const firstTouch = event.touches[0];
			const secondTouch = event.touches[1];
			_camera.activePinch = {
				startDistance: _camera.getTouchPairDistance(firstTouch, secondTouch),
				startZoom: _camera.zoom,
			};
		},
		{ passive: false },
	);

	_viewportFrame.addEventListener(
		"touchmove",
		(event) => {
			if (!_camera.activePinch || event.touches.length < 2) return;
			event.preventDefault();

			const firstTouch = event.touches[0];
			const secondTouch = event.touches[1];
			const distance = _camera.getTouchPairDistance(firstTouch, secondTouch);
			const center = _camera.getTouchPairCenter(firstTouch, secondTouch);
			const viewportX = center.x - _camera.viewportBounds.left;
			const viewportY = center.y - _camera.viewportBounds.top;
			const nextZoom = _camera.activePinch.startZoom * (distance / _camera.activePinch.startDistance);
			_camera.setZoomAtViewportPoint(viewportX, viewportY, nextZoom);
		},
		{ passive: false },
	);

	const _finishTouchZoom = (event) => {
		if (event.touches.length >= 2) return;
		_camera.activePinch = null;
	};
	_viewportFrame.addEventListener("touchend", _finishTouchZoom);
	_viewportFrame.addEventListener("touchcancel", _finishTouchZoom);
}

// ── Global Listeners ──────────────────────────────────────────────────

function _bindGlobalListeners() {
	window.addEventListener("keydown", (event) => {
		// Space key dismisses the description popup (any layout)
		if (event.key === " " && activeDescNodeId && !isEditableShortcutTarget(event.target)) {
			event.preventDefault();
			hideNodeDesc(true);
			return;
		}

		if (!isDesktopLayout() || !renameDialog.hidden || isEditableShortcutTarget(event.target)) return;

		const key = event.key.toLowerCase();
		const isUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
		const isRedo = (event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey));

		if (!isUndo && !isRedo) return;

		event.preventDefault();
		if (isUndo) { undoTreeChange(); } else { redoTreeChange(); }
	});

	desktopQuery.addEventListener("change", _handleLayoutChange);
	window.addEventListener("resize", () => _camera.refreshViewportBounds());

	// Prevent browser default drag-and-drop actions on media to avoid input freeze bugs
	window.addEventListener("dragstart", (event) => {
		if (event.target.tagName === "IMG" || event.target.tagName === "VIDEO") {
			event.preventDefault();
		}
	});

	// Control button bindings (orchestrator passes these via DOM — look them up once)
	const toggleEditBtn = document.getElementById("toggle-edit-btn");
	const toggleDeleteBtn = document.getElementById("toggle-delete-btn");

	toggleEditBtn?.addEventListener("click", () => {
		if (!isDesktopLayout()) return;
		applyEditMode(!editMode);
	});

	toggleDeleteBtn?.addEventListener("click", () => {
		if (!canEditStructure()) return;
		applyDeleteMode(!deleteMode);
	});
}

function _handleLayoutChange() {
	if (!isDesktopLayout()) {
		closeRenameDialog();
		closeDetailWindow();
		closeRegionEditDialog();
		setEditMode(false);
		setDeleteMode(false);
		clearSelectedNodes();
		firstSelectedNodeId = null;
	}
	updateControlsUi();
	_renderSceneWithSelection();
}

// ── Internal render helper ─────────────────────────────────────────────
function _renderSceneWithSelection() {
	renderScene(selectedNodes, firstSelectedNodeId);
}

// ── Sync snapshot handler (called by history.initHistory onApplySnapshot) ──
export function handleApplySnapshot() {
	firstSelectedNodeId = null;
	clearSelectedNodes();
	closeRenameDialog();
	closeRegionEditDialog();
	interactionState.consumeClick = false;
	pendingNodePointer = null;
	activeNodeDrag = null;
	activeResize = null;
	activeRegionDrag = null;
	activeRegionResize = null;
	_camera.activePan = null;
	_camera.activePinch = null;
	_renderSceneWithSelection();
	updateControlsUi();

	if (_sync.hasRemoteTreeSync()) {
		_sync.setTreeData(
			serializeNodes(store.nodesSource),
			serializeConnections(store.connectionsSource),
			serializeRegions(store.regionsSource),
		);
	}
}

