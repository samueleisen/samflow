// skill-history.js — Undo/redo history for skill tree changes.

import { store } from "./skill-store.js";
import {
	cloneNodes, cloneConnections, cloneRegions,
	normalizeNodes, normalizeConnections, normalizeRegions,
	nodeDigest, connectionDigest, regionDigest,
} from "./skill-data.js";

let historyUndoStack = [];
let historyRedoStack = [];
const historyLimit = 100;

// Injected by orchestrator — called after snapshot is applied to store
let _onApplySnapshot = null;

export function initHistory({ onApplySnapshot }) {
	_onApplySnapshot = onApplySnapshot;
}

export function captureTreeSnapshot() {
	return {
		nodes: cloneNodes(normalizeNodes(store.nodesSource)),
		connections: cloneConnections(normalizeConnections(store.connectionsSource)),
		regions: cloneRegions(normalizeRegions(store.regionsSource)),
	};
}

export function pushHistorySnapshot(snapshot) {
	historyUndoStack = [...historyUndoStack, snapshot].slice(-historyLimit);
	historyRedoStack = [];
}

export function resetHistory() {
	historyUndoStack = [];
	historyRedoStack = [];
}

// Applies a snapshot to the store and notifies the orchestrator to sync UI + Firebase
export function syncTreeSnapshot(snapshot) {
	store.nodesSource = cloneNodes(snapshot.nodes);
	store.connectionsSource = cloneConnections(snapshot.connections);
	store.regionsSource = cloneRegions(snapshot.regions);
	store.nodesDigest = nodeDigest(store.nodesSource);
	store.connectionsDigest = connectionDigest(store.connectionsSource);
	store.regionsDigest = regionDigest(store.regionsSource);

	if (_onApplySnapshot) {
		_onApplySnapshot(snapshot);
	}
}

export function undoTreeChange() {
	if (historyUndoStack.length === 0) return;
	const snapshot = historyUndoStack.pop();
	historyRedoStack.push(captureTreeSnapshot());
	syncTreeSnapshot(snapshot);
}

export function redoTreeChange() {
	if (historyRedoStack.length === 0) return;
	const snapshot = historyRedoStack.pop();
	historyUndoStack.push(captureTreeSnapshot());
	syncTreeSnapshot(snapshot);
}
