// skill-dialogs.js — All dialog and popup UI: rename node, region edit, detail window, description popup.
// Cloudinary upload lives here since it is only used by the rename dialog.

import {
	normalizeNodes, normalizeRegions, upsertNode, upsertRegion,
	defaultRegionColor, regionColorPresets, nowStamp,
} from "./skill-data.js";
import { store } from "./skill-store.js";

// ── Cloudinary Upload ─────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME = "dqgcrni5w";
const CLOUDINARY_UPLOAD_PRESET = "umlrklxe";

async function uploadToCloudinary(file) {
	const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
	const formData = new FormData();
	formData.append("file", file);
	formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

	const response = await fetch(url, { method: "POST", body: formData });

	if (!response.ok) {
		throw new Error(`Cloudinary upload failed (${response.status})`);
	}

	const data = await response.json();
	return {
		url: data.secure_url,
		resourceType: data.resource_type === "video" ? "video" : "image",
	};
}

// ── Injected callbacks (wired by orchestrator) ────────────────────────
let _renderScene = null;
let _persistNode = null;
let _persistRegion = null;
let _pushHistorySnapshot = null;
let _captureTreeSnapshot = null;
let _viewportFrame = null;

export function initDialogs(callbacks) {
	_renderScene = callbacks.renderScene;
	_persistNode = callbacks.persistNode;
	_persistRegion = callbacks.persistRegion;
	_pushHistorySnapshot = callbacks.pushHistorySnapshot;
	_captureTreeSnapshot = callbacks.captureTreeSnapshot;
}

export function mountDialogs(viewportFrame) {
	_viewportFrame = viewportFrame;
	viewportFrame.appendChild(renameDialog);
	viewportFrame.appendChild(regionEditDialog);
	viewportFrame.appendChild(detailWindow);
	viewportFrame.appendChild(nodeDescPopup);
}

// ── Rename Dialog ─────────────────────────────────────────────────────

export const renameDialog = document.createElement("div");
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
			<div class="skill-rename-dialog__media-section">
				<label class="skill-rename-dialog__media-label">Media <span style="font-weight:400;opacity:0.55">(image or video)</span></label>
				<div class="skill-rename-dialog__media-row">
					<div class="skill-rename-dialog__file-input-wrap">
						<input id="skill-media-input" class="skill-rename-dialog__file-input" type="file" accept="image/*,video/*" />
					</div>
				</div>
				<div id="skill-media-uploading" class="skill-rename-dialog__media-uploading">
					<span class="skill-rename-dialog__media-spinner"></span>
					<span>Uploading…</span>
				</div>
				<div id="skill-media-preview" class="skill-rename-dialog__media-preview">
					<button type="button" id="skill-media-remove" class="skill-rename-dialog__media-remove" title="Remove media">✕</button>
				</div>
			</div>
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
const renameMediaInput = renameDialog.querySelector("#skill-media-input");
const renameMediaPreview = renameDialog.querySelector("#skill-media-preview");
const renameMediaUploading = renameDialog.querySelector("#skill-media-uploading");
const renameMediaRemoveBtn = renameDialog.querySelector("#skill-media-remove");
const renameCancelTargets = renameDialog.querySelectorAll("[data-rename-cancel]");

let activeRenameNodeId = null;
let renameMediaStaged = { url: "", type: "" };

// ── Region Edit Dialog ────────────────────────────────────────────────

export const regionEditDialog = document.createElement("div");
regionEditDialog.className = "skill-region-dialog";
regionEditDialog.hidden = true;
regionEditDialog.innerHTML = `
	<div class="skill-region-dialog__backdrop" data-region-cancel></div>
	<div class="skill-region-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="skill-region-title">
		<p class="skill-region-dialog__kicker">Edit region</p>
		<h2 id="skill-region-title" class="skill-region-dialog__title">Update the region</h2>
		<form class="skill-region-dialog__form" autocomplete="off">
			<label class="skill-region-dialog__label" for="skill-region-name-input">Region name</label>
			<input id="skill-region-name-input" class="skill-region-dialog__input" type="text" maxlength="80" spellcheck="false" />
			<label class="skill-region-dialog__label">Color</label>
			<div class="skill-region-dialog__color-row" id="skill-region-color-row"></div>
			<div class="skill-region-dialog__actions">
				<button type="button" class="skill-region-dialog__button skill-region-dialog__button--ghost" data-region-cancel>Cancel</button>
				<button type="submit" class="skill-region-dialog__button">Save</button>
			</div>
		</form>
	</div>
`;

const regionEditForm = regionEditDialog.querySelector(".skill-region-dialog__form");
const regionEditNameInput = regionEditDialog.querySelector("#skill-region-name-input");
const regionEditColorRow = regionEditDialog.querySelector("#skill-region-color-row");
let regionEditStagedColor = defaultRegionColor;
let activeRegionEditId = null;

// Build color swatches once at module load
for (const preset of regionColorPresets) {
	const swatch = document.createElement("button");
	swatch.type = "button";
	swatch.className = "skill-region-dialog__color-swatch";
	swatch.style.background = preset;
	swatch.dataset.color = preset;
	swatch.addEventListener("click", () => {
		regionEditStagedColor = preset;
		updateRegionColorSwatches();
	});
	regionEditColorRow.appendChild(swatch);
}

function updateRegionColorSwatches() {
	for (const btn of regionEditColorRow.children) {
		btn.classList.toggle("is-active", btn.dataset.color === regionEditStagedColor);
	}
}

// ── Detail Window ─────────────────────────────────────────────────────

export const detailWindow = document.createElement("div");
detailWindow.className = "skill-detail-window";
detailWindow.hidden = true;
detailWindow.innerHTML = `
	<div class="skill-detail-window__backdrop" data-detail-close></div>
	<div class="skill-detail-window__panel" role="dialog" aria-modal="true">
		<button type="button" class="skill-detail-window__close" data-detail-close title="Close">✕</button>
		<p class="skill-detail-window__kicker">Node Details</p>
		<h2 class="skill-detail-window__title" id="skill-detail-title"></h2>
		<div class="skill-detail-window__media" id="skill-detail-media"></div>
		<div id="skill-detail-desc-section">
			<p class="skill-detail-window__desc-label">Description</p>
			<p class="skill-detail-window__desc" id="skill-detail-desc"></p>
		</div>
	</div>
`;

const detailTitle = detailWindow.querySelector("#skill-detail-title");
const detailMedia = detailWindow.querySelector("#skill-detail-media");
const detailDescSection = detailWindow.querySelector("#skill-detail-desc-section");
const detailDesc = detailWindow.querySelector("#skill-detail-desc");
const detailPanel = detailWindow.querySelector(".skill-detail-window__panel");

// Bind close targets directly so clicks never bubble to viewportFrame handlers
for (const el of detailWindow.querySelectorAll("[data-detail-close]")) {
	el.addEventListener("click", (event) => {
		event.stopPropagation();
		closeDetailWindow();
	});
}

// Stop clicks inside the panel from bubbling to the viewport
detailPanel.addEventListener("click", (event) => {
	event.stopPropagation();
});

// ── Description Popup ─────────────────────────────────────────────────

export const nodeDescPopup = document.createElement("div");
nodeDescPopup.className = "skill-node-desc";
nodeDescPopup.setAttribute("aria-live", "polite");
nodeDescPopup.innerHTML = `<p class="skill-node-desc__title"></p><p class="skill-node-desc__body"></p>`;

const nodeDescTitle = nodeDescPopup.querySelector(".skill-node-desc__title");
const nodeDescBody = nodeDescPopup.querySelector(".skill-node-desc__body");

export let activeDescNodeId = null;
let descHideTimer = null;

// ── Description long-press state (read/written by skill-interactions) ─
let _descLongPressTimer = null;
let _descLongPressActive = false;

export function getDescLongPressActive() { return _descLongPressActive; }
export function setDescLongPressActive(v) { _descLongPressActive = v; }
export function getDescLongPressTimer() { return _descLongPressTimer; }
export function setDescLongPressTimer(id) { _descLongPressTimer = id; }
export function clearDescLongPressTimer() {
	if (_descLongPressTimer) { clearTimeout(_descLongPressTimer); _descLongPressTimer = null; }
}

// ── Shared Helpers ────────────────────────────────────────────────────

export function isPopupActive() {
	return !renameDialog.hidden || !regionEditDialog.hidden || !detailWindow.hidden;
}

export function updateViewportCursor() {
	if (_viewportFrame) {
		_viewportFrame.classList.toggle("has-active-popup", isPopupActive());
	}
}

// ── Rename Dialog API ─────────────────────────────────────────────────

export function closeRenameDialog() {
	activeRenameNodeId = null;
	renameDialog.hidden = true;
	delete renameDialog.dataset.open;
	renameMediaStaged = { url: "", type: "" };
	renameMediaInput.value = "";
	renameMediaPreview.classList.remove("has-media");
	const existingEl = renameMediaPreview.querySelector("img, video");
	if (existingEl) existingEl.remove();
	renameMediaUploading.classList.remove("is-active");
	updateViewportCursor();
}

export function openRenameDialog(nodeId) {
	const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === nodeId);
	if (!node) return;

	activeRenameNodeId = node.id;
	renameInput.value = node.title;
	renameDescInput.value = node.description ?? "";

	renameMediaStaged = { url: node.mediaUrl ?? "", type: node.mediaType ?? "" };
	renameMediaInput.value = "";
	const existingMediaEl = renameMediaPreview.querySelector("img, video");
	if (existingMediaEl) existingMediaEl.remove();

	if (renameMediaStaged.url) {
		if (renameMediaStaged.type === "video") {
			const vid = document.createElement("video");
			vid.src = renameMediaStaged.url;
			vid.controls = true;
			vid.playsInline = true;
			renameMediaPreview.appendChild(vid);
		} else {
			const img = document.createElement("img");
			img.src = renameMediaStaged.url;
			img.alt = "Current media";
			img.draggable = false;
			renameMediaPreview.appendChild(img);
		}
		renameMediaPreview.classList.add("has-media");
	} else {
		renameMediaPreview.classList.remove("has-media");
	}

	renameDialog.hidden = false;
	renameDialog.dataset.open = "true";
	renameInput.focus();
	renameInput.select();
	updateViewportCursor();
}

export function saveRenameDialog() {
	if (!activeRenameNodeId) return;

	const nextTitle = String(renameInput.value ?? "").trim();
	if (!nextTitle) return;

	const nextDescription = String(renameDescInput.value ?? "").trim();
	const nextMediaUrl = renameMediaStaged.url;
	const nextMediaType = renameMediaStaged.type;

	const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === activeRenameNodeId);
	if (!node) { closeRenameDialog(); return; }

	const titleSame = node.title === nextTitle;
	const descSame = (node.description ?? "") === nextDescription;
	const mediaSame = (node.mediaUrl ?? "") === nextMediaUrl && (node.mediaType ?? "") === nextMediaType;

	if (titleSame && descSame && mediaSame) { closeRenameDialog(); return; }

	_pushHistorySnapshot(_captureTreeSnapshot());

	const updated = {
		...node,
		title: nextTitle,
		description: nextDescription,
		mediaUrl: nextMediaUrl,
		mediaType: nextMediaType,
		updatedAt: nowStamp(),
	};

	store.nodesSource = upsertNode(store.nodesSource, updated);
	_renderScene();
	_persistNode(updated);
	closeRenameDialog();
}

// ── Region Edit Dialog API ────────────────────────────────────────────

export function closeRegionEditDialog() {
	activeRegionEditId = null;
	regionEditDialog.hidden = true;
	updateViewportCursor();
}

export function openRegionEditDialog(regionId) {
	const region = normalizeRegions(store.regionsSource).find((entry) => entry.id === regionId);
	if (!region) return;

	activeRegionEditId = region.id;
	regionEditNameInput.value = region.title;
	regionEditStagedColor = region.color;
	updateRegionColorSwatches();
	regionEditDialog.hidden = false;
	regionEditNameInput.focus();
	regionEditNameInput.select();
	updateViewportCursor();
}

export function saveRegionEditDialog() {
	if (!activeRegionEditId) return;

	const nextTitle = String(regionEditNameInput.value ?? "").trim();
	if (!nextTitle) return;

	const region = normalizeRegions(store.regionsSource).find((entry) => entry.id === activeRegionEditId);
	if (!region) { closeRegionEditDialog(); return; }

	if (region.title === nextTitle && region.color === regionEditStagedColor) {
		closeRegionEditDialog();
		return;
	}

	_pushHistorySnapshot(_captureTreeSnapshot());

	const updated = { ...region, title: nextTitle, color: regionEditStagedColor };
	store.regionsSource = upsertRegion(store.regionsSource, updated);
	_renderScene();
	_persistRegion(updated);
	closeRegionEditDialog();
}

// ── Detail Window API ─────────────────────────────────────────────────

export function closeDetailWindow() {
	detailWindow.hidden = true;
	detailMedia.replaceChildren();
	updateViewportCursor();
}

export function openDetailWindow(nodeId) {
	const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === nodeId);
	if (!node) return;

	detailTitle.textContent = node.title;
	detailMedia.replaceChildren();

	if (node.mediaUrl) {
		if (node.mediaType === "video") {
			const vid = document.createElement("video");
			vid.src = node.mediaUrl;
			vid.controls = true;
			vid.playsInline = true;
			detailMedia.appendChild(vid);
		} else {
			const img = document.createElement("img");
			img.src = node.mediaUrl;
			img.alt = node.title;
			img.draggable = false;
			detailMedia.appendChild(img);
		}
	}

	const desc = (node.description ?? "").trim();
	if (desc) {
		detailDescSection.style.display = "";
		detailDesc.textContent = desc;
	} else if (!node.mediaUrl) {
		detailDescSection.style.display = "";
		detailDesc.textContent = "";
		const emptyMsg = document.createElement("p");
		emptyMsg.className = "skill-detail-window__empty";
		emptyMsg.textContent = "No description or media attached yet.";
		detailDesc.appendChild(emptyMsg);
	} else {
		detailDescSection.style.display = "none";
	}

	detailWindow.hidden = false;
	updateViewportCursor();
}

// ── Description Popup API ─────────────────────────────────────────────

export function showNodeDesc(nodeId) {
	const node = normalizeNodes(store.nodesSource).find((entry) => entry.id === nodeId);
	if (!node || !(node.description ?? "").trim()) return;

	if (descHideTimer) { clearTimeout(descHideTimer); descHideTimer = null; }

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

export function hideNodeDesc(immediate = false) {
	if (descHideTimer) { clearTimeout(descHideTimer); descHideTimer = null; }

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

// ── Media Upload Handlers ─────────────────────────────────────────────

renameMediaInput.addEventListener("change", async () => {
	const file = renameMediaInput.files?.[0];
	if (!file) return;

	renameMediaUploading.classList.add("is-active");
	renameMediaPreview.classList.remove("has-media");
	const existingEl = renameMediaPreview.querySelector("img, video");
	if (existingEl) existingEl.remove();

	try {
		const result = await uploadToCloudinary(file);
		renameMediaStaged = { url: result.url, type: result.resourceType };

		if (result.resourceType === "video") {
			const vid = document.createElement("video");
			vid.src = result.url;
			vid.controls = true;
			vid.playsInline = true;
			renameMediaPreview.appendChild(vid);
		} else {
			const img = document.createElement("img");
			img.src = result.url;
			img.alt = "Uploaded media";
			img.draggable = false;
			renameMediaPreview.appendChild(img);
		}
		renameMediaPreview.classList.add("has-media");
	} catch (err) {
		console.error("Media upload failed:", err);
		alert("Upload failed. Please try again.");
	} finally {
		renameMediaUploading.classList.remove("is-active");
	}
});

renameMediaRemoveBtn.addEventListener("click", () => {
	renameMediaStaged = { url: "", type: "" };
	renameMediaInput.value = "";
	renameMediaPreview.classList.remove("has-media");
	const el = renameMediaPreview.querySelector("img, video");
	if (el) el.remove();
});

// ── Dialog Event Bindings ─────────────────────────────────────────────

renameDialog.addEventListener("click", (event) => {
	if (event.target.closest("[data-rename-cancel]")) { closeRenameDialog(); return; }
	if (event.target.closest(".skill-rename-dialog__panel")) { event.stopPropagation(); }
});

regionEditDialog.addEventListener("click", (event) => {
	if (event.target.closest("[data-region-cancel]")) { closeRegionEditDialog(); return; }
	if (event.target.closest(".skill-region-dialog__panel")) { event.stopPropagation(); }
});

regionEditForm.addEventListener("submit", (event) => {
	event.preventDefault();
	saveRegionEditDialog();
});

renameForm.addEventListener("submit", (event) => {
	event.preventDefault();
	saveRenameDialog();
});

for (const cancelTarget of renameCancelTargets) {
	cancelTarget.addEventListener("click", () => closeRenameDialog());
}

renameInput.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		closeRenameDialog();
	}
});
