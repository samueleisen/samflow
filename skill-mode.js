// skill-mode.js — Edit/delete mode state and layout detection.
// Provides pure checkers and simple setters. Callers handle all side effects.

export const desktopQuery = window.matchMedia("(min-width: 920px)");

export let editMode = false;
export let deleteMode = false;

export function isDesktopLayout() {
	return desktopQuery.matches;
}

// Plain setters — dialog cleanup, renderScene etc. are handled by the caller
export function setEditMode(next) {
	editMode = next;
}

export function setDeleteMode(next) {
	deleteMode = next;
}

export function canEditStructure() {
	return isDesktopLayout() && editMode;
}

export function canModifyStructure() {
	return canEditStructure() && !deleteMode;
}

export function canDelete() {
	return canEditStructure() && deleteMode;
}

export function canChangeStatus() {
	return !isDesktopLayout() || !editMode;
}

export function isEditableShortcutTarget(target) {
	return Boolean(
		target &&
		(typeof target.closest === "function"
			? target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable
			: false),
	);
}
