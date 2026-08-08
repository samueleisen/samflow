// skill-store.js — Shared mutable state for skill tree data.
// Import and mutate this object from any module that reads or writes the current tree.

export const store = {
	nodesSource: null,
	connectionsSource: null,
	regionsSource: null,
	nodesDigest: "",
	connectionsDigest: "",
	regionsDigest: "",
};
