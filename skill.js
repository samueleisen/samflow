// skill.js — Orchestrator. Boots all modules and wires their cross-module callbacks.
// This file owns no business logic — it only creates DOM refs, instantiates services,
// and injects the callbacks each module needs to call into other modules.

import { ViewportCamera } from "./viewport-camera.js";
import { SkillSync } from "./skill-sync.js";
import { store } from "./skill-store.js";
import {
	normalizeNodes, normalizeConnections, normalizeRegions,
	nodeDigest, connectionDigest, regionDigest,
	serializeNodes, serializeConnections, serializeRegions,
	cloneGuestDemoNodes, cloneGuestDemoConnections, cloneGuestDemoRegions,
	defaultRegionColor, canvasWidth, canvasHeight,
	minZoom, maxZoom, defaultZoom, wheelZoomIntensity, interactionThreshold,
} from "./skill-data.js";
import { initHistory } from "./skill-history.js";
import { initDialogs, mountDialogs } from "./skill-dialogs.js";
import { initRender, renderScene, updateControlsUi, ensureConnectionMarkers } from "./skill-render.js";
import { mountInteractions, handleApplySnapshot, applyEditMode, applyDeleteMode, clearSelectedNodes } from "./skill-interactions.js";
import { captureTreeSnapshot, pushHistorySnapshot } from "./skill-history.js";

// ── Required DOM mount points ─────────────────────────────────────────
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

viewportFrame.tabIndex = 0;

// ── Region layer (sits between canvas and nodeLayer in DOM) ───────────
const regionLayer = document.createElement("div");
regionLayer.className = "skill-region-layer";
canvas.insertBefore(regionLayer, nodeLayer);

// ── Selection rect ────────────────────────────────────────────────────
const selectionRectEl = document.createElement("div");
selectionRectEl.className = "skill-selection-rect";
selectionRectEl.hidden = true;
canvas.appendChild(selectionRectEl);

// ── Camera ────────────────────────────────────────────────────────────
const camera = new ViewportCamera(viewportFrame, canvas, {
	canvasWidth,
	canvasHeight,
	minZoom,
	maxZoom,
	defaultZoom,
	wheelZoomIntensity,
	interactionThreshold,
});

// ── Bootstrap store with guest demo data ──────────────────────────────
store.nodesSource = cloneGuestDemoNodes();
store.connectionsSource = cloneGuestDemoConnections();
store.regionsSource = cloneGuestDemoRegions();
store.nodesDigest = nodeDigest(store.nodesSource);
store.connectionsDigest = connectionDigest(store.connectionsSource);
store.regionsDigest = regionDigest(store.regionsSource);

// ── Skill Sync ────────────────────────────────────────────────────────
const skillSync = new SkillSync({
	onNodesUpdate: (val) => {
		const incoming = normalizeNodes(val);
		const digest = nodeDigest(incoming);
		store.nodesSource = incoming;
		if (digest === store.nodesDigest) return;
		store.nodesDigest = digest;
		// If the first-selected node was deleted, clear it
		// (skill-interactions exposes no direct write, renderScene handles visual)
		renderScene();
	},
	onConnectionsUpdate: (val) => {
		const incoming = normalizeConnections(val);
		const digest = connectionDigest(incoming);
		store.connectionsSource = incoming;
		if (digest === store.connectionsDigest) return;
		store.connectionsDigest = digest;
		renderScene();
	},
	onRegionsUpdate: (val) => {
		const incoming = normalizeRegions(val);
		const digest = regionDigest(incoming);
		store.regionsSource = incoming;
		if (digest === store.regionsDigest) return;
		store.regionsDigest = digest;
		renderScene();
	},
	onAuthStateChange: (user) => {
		if (!user) {
			store.nodesSource = cloneGuestDemoNodes();
			store.connectionsSource = cloneGuestDemoConnections();
			store.regionsSource = cloneGuestDemoRegions();
			store.nodesDigest = nodeDigest(store.nodesSource);
			store.connectionsDigest = connectionDigest(store.connectionsSource);
			store.regionsDigest = regionDigest(store.regionsSource);
			clearSelectedNodes();
			// History and dialog cleanup handled by handleApplySnapshot-style reset
			applyEditMode(false);
		}
		updateControlsUi();
		renderScene();
	},
});

// ── Sync operations object (injected into interactions) ───────────────
const syncOps = {
	hasRemoteTreeSync: () => skillSync.hasRemoteTreeSync(),
	persistNode: (node) => skillSync.persistNode(node),
	persistRegion: (region) => skillSync.persistRegion(region),
	deleteNode: (nodeId) => skillSync.deleteNode(nodeId),
	deleteConnection: (connectionId) => skillSync.deleteConnection(connectionId),
	deleteRegion: (regionId) => skillSync.deleteRegion(regionId),
	pushNewNode: (node) => skillSync.pushNewNode(node),
	pushNewConnection: (data) => skillSync.pushNewConnection(data),
	pushNewRegion: (data) => skillSync.pushNewRegion(data),
	setTreeData: (nodes, connections, regions) => skillSync.setTreeData(nodes, connections, regions),
};

// ── Init: Render module ───────────────────────────────────────────────
initRender({
	nodeLayer,
	lineLayer,
	regionLayer,
	selectionRectEl,
	viewportFrame,
	toggleEditBtn,
	toggleDeleteBtn,
	controlsHint,
	getAuthUser: () => skillSync.currentAuthUser,
});

// ── Init: Dialogs ─────────────────────────────────────────────────────
initDialogs({
	renderScene: () => renderScene(),
	persistNode: (node) => skillSync.persistNode(node),
	persistRegion: (region) => skillSync.persistRegion(region),
	pushHistorySnapshot,
	captureTreeSnapshot,
});
mountDialogs(viewportFrame);

// ── Init: History (must come after interactions so handleApplySnapshot exists) ──
initHistory({ onApplySnapshot: () => handleApplySnapshot() });

// ── Init: Interactions ────────────────────────────────────────────────
mountInteractions({ viewportFrame, nodeLayer, regionLayer, camera }, syncOps);

// ── Boot sequence ─────────────────────────────────────────────────────
skillSync.init();
camera.refreshViewportBounds();
camera.centerCanvasView();
applyEditMode(false);
