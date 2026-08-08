// skill-data.js — Pure data layer: constants, coerce/normalize, serialize, digest, clone, upsert.
// No DOM access. No side effects. Safe to import from any module.

// ── Canvas & Node Constants ───────────────────────────────────────────
export const canvasWidth = 5000;
export const canvasHeight = 3000;
export const defaultNodeSize = 90;
export const minNodeSize = 60;
export const maxNodeSize = 220;
export const interactionThreshold = 4;
export const nodeBorderWidth = 2;
export const nodeHitSlop = 10;
export const connectionArrowPadding = 2;
export const connectionStrokeWidth = 2;
export const connectionArrowWidth = 4;
export const connectionArrowHeight = 4;
export const minZoom = 0.25;
export const maxZoom = 2.5;
export const defaultZoom = 0.5;
export const wheelZoomIntensity = 0.0015;
// for zoom simply add the css and more array both const will do
export const nodeStates = ["activated", "deactivated"];
export const connectionStateColors = {
	activated: "#ffffff",
	deactivated: "#888888",
};

export const regionColorPresets = [
	"rgba(77, 216, 255, 0.12)",
	"rgba(168, 85, 247, 0.12)",
	"rgba(52, 211, 153, 0.12)",
	"rgba(251, 191, 36, 0.12)",
	"rgba(239, 68, 68, 0.12)",
	"rgba(236, 72, 153, 0.12)",
	"rgba(59, 130, 246, 0.12)",
	"rgba(255, 255, 255, 0.08)",
];

export const defaultRegionColor = regionColorPresets[0];

// ── Guest Demo Data ───────────────────────────────────────────────────
export const guestDemoNodes = [
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

export const guestDemoConnections = [
	{
		id: "-OtbqS2SQJW8-7RLGckY",
		from: "-OtbNwVjOENV-rUCyGky",
		to: "-OtbqA8a_Y-9IibOCNOq",
	},
];

export const guestDemoRegions = [];

// ── Utility Functions ─────────────────────────────────────────────────

export function nowStamp() {
	return Date.now();
}

export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function computeNodeFontSize(title, nodeSize) {
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
}

export function createLocalId(prefix) {
	return `${prefix}-${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nextNodeState(currentState) {
	const index = nodeStates.indexOf(currentState);
	const nextIndex = index >= 0 ? (index + 1) % nodeStates.length : 0;
	return nodeStates[nextIndex];
}

// ── Coerce Functions ──────────────────────────────────────────────────

export function coerceNode(candidate, fallbackId) {
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
	const mediaUrl = String(candidate.mediaUrl ?? "").trim();
	const mediaType = ["image", "video"].includes(candidate.mediaType) ? candidate.mediaType : "";

	return {
		id: String(candidate.id ?? fallbackId),
		title,
		description,
		mediaUrl,
		mediaType,
		x: Number.isFinite(x) ? x : canvasWidth / 2,
		y: Number.isFinite(y) ? y : canvasHeight / 2,
		size: Number.isFinite(size) ? clamp(size, minNodeSize, maxNodeSize) : defaultNodeSize,
		state,
	};
}

export function coerceConnection(candidate, fallbackId) {
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

export function coerceRegion(candidate, fallbackId) {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const title = String(candidate.title ?? "").trim();

	if (!title) {
		return null;
	}

	const x = Number(candidate.x);
	const y = Number(candidate.y);
	const width = Number(candidate.width);
	const height = Number(candidate.height);
	const color = String(candidate.color ?? defaultRegionColor);

	return {
		id: String(candidate.id ?? fallbackId),
		title,
		color,
		x: Number.isFinite(x) ? x : 0,
		y: Number.isFinite(y) ? y : 0,
		width: Number.isFinite(width) && width > 0 ? width : 100,
		height: Number.isFinite(height) && height > 0 ? height : 100,
	};
}

// ── Normalize Functions ───────────────────────────────────────────────

export function normalizeNodes(source) {
	if (!source) return [];
	if (Array.isArray(source)) {
		return source.map((node, index) => coerceNode(node, index + 1)).filter(Boolean);
	}
	return Object.entries(source).map(([key, node]) => coerceNode(node, key)).filter(Boolean);
}

export function normalizeConnections(source) {
	if (!source) return [];
	if (Array.isArray(source)) {
		return source.map((connection, index) => coerceConnection(connection, index + 1)).filter(Boolean);
	}
	return Object.entries(source).map(([key, connection]) => coerceConnection(connection, key)).filter(Boolean);
}

export function normalizeRegions(source) {
	if (!source) return [];
	if (Array.isArray(source)) {
		return source.map((region, index) => coerceRegion(region, index + 1)).filter(Boolean);
	}
	return Object.entries(source).map(([key, region]) => coerceRegion(region, key)).filter(Boolean);
}

// ── Serialize Functions ───────────────────────────────────────────────

export function serializeNodes(nodes) {
	const serialized = {};
	for (const node of nodes) {
		serialized[node.id] = { ...node };
	}
	return serialized;
}

export function serializeConnections(connections) {
	const serialized = {};
	for (const connection of connections) {
		serialized[connection.id] = { ...connection };
	}
	return serialized;
}

export function serializeRegions(regions) {
	const serialized = {};
	for (const region of regions) {
		serialized[region.id] = { ...region };
	}
	return serialized;
}

// ── Digest Functions ──────────────────────────────────────────────────

export function nodeDigest(nodes) {
	return JSON.stringify(
		nodes
			.slice()
			.sort((left, right) => String(left.id).localeCompare(String(right.id)))
			.map((node) => ({
				id: node.id,
				title: node.title,
				description: node.description ?? "",
				mediaUrl: node.mediaUrl ?? "",
				mediaType: node.mediaType ?? "",
				x: node.x,
				y: node.y,
				size: node.size,
				state: node.state,
			})),
	);
}

export function connectionDigest(connections) {
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

export function regionDigest(regions) {
	return JSON.stringify(
		regions
			.slice()
			.sort((left, right) => String(left.id).localeCompare(String(right.id)))
			.map((region) => ({
				id: region.id,
				title: region.title,
				color: region.color,
				x: region.x,
				y: region.y,
				width: region.width,
				height: region.height,
			})),
	);
}

// ── Clone Functions ───────────────────────────────────────────────────

export function cloneNodes(nodes) {
	return nodes.map((node) => ({ ...node }));
}

export function cloneConnections(connections) {
	return connections.map((connection) => ({ ...connection }));
}

export function cloneRegions(regions) {
	return regions.map((region) => ({ ...region }));
}

export function cloneGuestDemoNodes() {
	return guestDemoNodes.map((node) => ({ ...node }));
}

export function cloneGuestDemoConnections() {
	return guestDemoConnections.map((connection) => ({ ...connection }));
}

export function cloneGuestDemoRegions() {
	return guestDemoRegions.map((region) => ({ ...region }));
}

// ── Upsert Functions ──────────────────────────────────────────────────

export function upsertNode(source, node) {
	const nodes = normalizeNodes(source);
	const existingIndex = nodes.findIndex((entry) => entry.id === node.id);
	if (existingIndex >= 0) {
		nodes[existingIndex] = node;
		return nodes;
	}
	nodes.push(node);
	return nodes;
}

export function upsertConnection(source, connection) {
	const connections = normalizeConnections(source);
	const existingIndex = connections.findIndex((entry) => entry.id === connection.id);
	if (existingIndex >= 0) {
		connections[existingIndex] = connection;
		return connections;
	}
	connections.push(connection);
	return connections;
}

export function upsertRegion(source, region) {
	const regions = normalizeRegions(source);
	const existingIndex = regions.findIndex((entry) => entry.id === region.id);
	if (existingIndex >= 0) {
		regions[existingIndex] = region;
		return regions;
	}
	regions.push(region);
	return regions;
}
