import { database, ref, set, onValue } from "./firebase-config.js";
import { subscribeAuthState } from "./auth.js";

const taskInput = document.getElementById("task-input");
const taskForm = document.getElementById("task-form");
const taskList = document.getElementById("task-list");
const taskEmpty = document.getElementById("task-empty");

const tasks = [];
let nextTaskId = 1;
const openProjectIds = new Set();
let projectsRef = null;
let projectsUnsubscribe = null;
let currentUserId = null;
let lastWrittenDigest = "";

let activeDeletePopup = null;
let touchTimer = null;
let holdActive = false;
let startTouchX = 0;
let startTouchY = 0;
let ignoreNextClick = false;
const HOLD_DURATION_MS = 600;
const TOUCH_MOVE_THRESHOLD = 10;

function closeDeletePopup() {
	if (activeDeletePopup) {
		activeDeletePopup.remove();
		activeDeletePopup = null;
		document.removeEventListener("click", onOutsideClick);
	}
}

function onOutsideClick(event) {
	closeDeletePopup();
}

let activeEditModal = null;

function closeEditModal() {
	if (activeEditModal) {
		activeEditModal.remove();
		activeEditModal = null;
	}
}

function showEditTitleModal(taskId) {
	closeEditModal();
	const task = tasks.find((t) => t.id === taskId);
	if (!task) {
		return;
	}

	const modalOverlay = document.createElement("div");
	modalOverlay.className = "edit-modal-overlay";

	const modalContainer = document.createElement("div");
	modalContainer.className = "edit-modal-container";

	const titleLabel = document.createElement("h3");
	titleLabel.className = "edit-modal-title";
	titleLabel.textContent = "Edit Project Title";

	const inputField = document.createElement("input");
	inputField.type = "text";
	inputField.className = "edit-modal-input";
	inputField.value = task.title;

	const buttonGroup = document.createElement("div");
	buttonGroup.className = "edit-modal-buttons";

	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.className = "edit-modal-btn edit-modal-btn--cancel";
	cancelBtn.textContent = "Cancel";
	cancelBtn.addEventListener("click", closeEditModal);

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "edit-modal-btn edit-modal-btn--save";
	saveBtn.textContent = "Save";

	const submitEdit = () => {
		const trimmed = inputField.value.trim();
		if (trimmed) {
			task.title = trimmed;
			task.lastSeen = nowStamp();
			updateTaskRow(task);
			persistTasks();
			closeEditModal();
		}
	};

	saveBtn.addEventListener("click", submitEdit);

	inputField.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			submitEdit();
		} else if (e.key === "Escape") {
			closeEditModal();
		}
	});

	buttonGroup.append(cancelBtn, saveBtn);
	modalContainer.append(titleLabel, inputField, buttonGroup);
	modalOverlay.appendChild(modalContainer);
	document.body.appendChild(modalOverlay);

	activeEditModal = modalOverlay;

	setTimeout(() => {
		inputField.focus();
		inputField.select();
	}, 50);

	modalOverlay.addEventListener("click", (e) => {
		if (e.target === modalOverlay) {
			closeEditModal();
		}
	});
}

function showDeletePopup(taskId, x, y) {
	closeDeletePopup();

	const popup = document.createElement("div");
	popup.className = "task-context-menu";

	popup.style.position = "fixed";
	popup.style.zIndex = "1000";

	const editBtn = document.createElement("button");
	editBtn.type = "button";
	editBtn.className = "context-menu-edit-btn";
	editBtn.textContent = "✏️ Edit Title";
	editBtn.addEventListener("click", () => {
		showEditTitleModal(taskId);
		closeDeletePopup();
	});

	const deleteBtn = document.createElement("button");
	deleteBtn.type = "button";
	deleteBtn.className = "context-menu-delete-btn";
	deleteBtn.textContent = "🗑 Delete Project";
	deleteBtn.addEventListener("click", () => {
		deleteTask(taskId);
	});

	popup.append(editBtn, deleteBtn);
	document.body.appendChild(popup);

	// Adjust position to stay in viewport bounds
	const rect = popup.getBoundingClientRect();
	let posX = x;
	let posY = y;

	if (posX + rect.width > window.innerWidth) {
		posX = window.innerWidth - rect.width - 8;
	}
	if (posY + rect.height > window.innerHeight) {
		posY = window.innerHeight - rect.height - 8;
	}
	if (posX < 8) posX = 8;
	if (posY < 8) posY = 8;

	popup.style.left = `${posX}px`;
	popup.style.top = `${posY}px`;

	activeDeletePopup = popup;

	setTimeout(() => {
		document.addEventListener("click", onOutsideClick);
	}, 0);
}

window.addEventListener("scroll", closeDeletePopup, { passive: true });
window.addEventListener("resize", closeDeletePopup);


const timeFormatter = new Intl.DateTimeFormat(undefined, {
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

const staleThresholdMs = 7 * 24 * 60 * 60 * 1000;
const descriptionMaxHeightPx = 240;

function nowStamp() {
	return Date.now();
}

function formatRelativeTime(timestamp) {
	const deltaMs = Math.max(0, nowStamp() - timestamp);
	const minutes = Math.floor(deltaMs / 60000);

	if (minutes < 1) {
		return "Updated just now";
	}

	if (minutes < 60) {
		return `Updated ${minutes}m ago`;
	}

	const hours = Math.floor(minutes / 60);

	if (hours < 24) {
		return `Updated ${hours}h ago`;
	}

	const days = Math.floor(hours / 24);

	return `Updated ${days}d ago`;
}

function isStale(task) {
	return task.status === "active" && nowStamp() - task.lastSeen > staleThresholdMs;
}

function coerceTask(candidate, fallbackId) {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const title = String(candidate.title ?? candidate.text ?? "").trim();

	if (!title) {
		return null;
	}

	const parsedId = Number(candidate.id ?? fallbackId);

	return {
		id: Number.isFinite(parsedId) ? parsedId : nextTaskId++,
		title,
		status: candidate.status === "archived" ? "achieved" : (["active", "hibernating", "achieved"].includes(candidate.status) ? candidate.status : "active"),
		description: String(candidate.description ?? ""),
		lastSeen: Number.isFinite(Number(candidate.lastSeen)) ? Number(candidate.lastSeen) : nowStamp(),
	};
}

function normalizeTasks(source) {
	if (!source) {
		return [];
	}

	if (Array.isArray(source)) {
		return source.map((task, index) => coerceTask(task, index + 1)).filter(Boolean);
	}

	return Object.entries(source).map(([key, task]) => coerceTask(task, key)).filter(Boolean);
}

function syncNextTaskId() {
	nextTaskId = tasks.reduce((maxId, task) => {
		const parsedId = Number(task.id);
		return Number.isFinite(parsedId) && parsedId > maxId ? parsedId : maxId;
	}, 0) + 1;
}

function exportSnapshot() {
	return tasks.map((task) => ({
		id: task.id,
		title: task.title,
		status: task.status,
		description: task.description,
		lastSeen: task.lastSeen,
	}));
}

function persistTasks() {
	if (!projectsRef) {
		return;
	}

	const snapshot = exportSnapshot();
	lastWrittenDigest = JSON.stringify(snapshot);
	set(projectsRef, snapshot);
}

function connectFirebaseSync() {
	if (!projectsRef) {
		return;
	}

	if (typeof projectsUnsubscribe === "function") {
		projectsUnsubscribe();
	}

	projectsUnsubscribe = onValue(projectsRef, (snapshot) => {
		const incoming = normalizeTasks(snapshot.val());
		const incomingDigest = JSON.stringify(incoming.map((task) => ({
			id: task.id,
			title: task.title,
			status: task.status,
			description: task.description,
			lastSeen: task.lastSeen,
		})));

		if (incomingDigest === lastWrittenDigest) {
			return;
		}

		hydrateFromRemote(incoming);
	});
}

function disconnectFirebaseSync() {
	if (typeof projectsUnsubscribe === "function") {
		projectsUnsubscribe();
	}

	projectsUnsubscribe = null;
	projectsRef = null;
	currentUserId = null;
	lastWrittenDigest = "";
}

function resetWorkspaceState() {
	tasks.length = 0;
	nextTaskId = 1;
	openProjectIds.clear();
	renderTasks();
	updateEmptyState();
}

function connectWorkspaceForUser(user) {
	disconnectFirebaseSync();

	if (!user) {
		resetWorkspaceState();
		return;
	}

	currentUserId = user.uid;
	projectsRef = ref(database, `users/${user.uid}/workspace/projects`);
	connectFirebaseSync();
}

function updateEmptyState() {
	taskEmpty.hidden = tasks.length > 0;
}

function getStatusLabel(status) {
	return "";
}

function nextStatus(status) {
	if (status === "active") {
		return "hibernating";
	}

	if (status === "hibernating") {
		return "achieved";
	}

	return "active";
}

function touchTask(task) {
	if (!task) {
		return;
	}

	task.lastSeen = nowStamp();
	updateTaskRow(task);
	if (openProjectIds.has(task.id)) {
		persistTasks();
	}
}

function autosizeDescriptionField(field) {
	if (!field) {
		return;
	}

	field.style.height = "auto";
	const nextHeight = Math.min(field.scrollHeight, descriptionMaxHeightPx);
	field.style.height = `${nextHeight}px`;
}

function updateTaskRow(task) {
	const row = taskList.querySelector(`[data-task-id="${task.id}"]`);

	if (!row) {
		return;
	}

	row.className = `task-row is-${task.status}${openProjectIds.has(task.id) ? " is-open" : ""}`;

	const statusButton = row.querySelector(".task-status");
	if (statusButton) {
		statusButton.textContent = getStatusLabel(task.status);
		statusButton.setAttribute("aria-label", `Status ${task.status} for ${task.title}`);
	}

	const titleNode = row.querySelector(".task-text");
	if (titleNode) {
		titleNode.textContent = task.title;
	}

	const timeNode = row.querySelector(".task-time");
	if (timeNode) {
		timeNode.dateTime = new Date(task.lastSeen).toISOString();
		timeNode.textContent = formatRelativeTime(task.lastSeen);
	}

	const staleNode = row.querySelector(".task-stale");
	if (staleNode) {
		staleNode.hidden = !isStale(task);
	}

	const descriptionField = row.querySelector(".task-description textarea");
	if (descriptionField && document.activeElement !== descriptionField) {
		descriptionField.value = task.description;
		autosizeDescriptionField(descriptionField);
	}
}

function renderTasks() {
	taskList.replaceChildren();

	const fragment = document.createDocumentFragment();

	for (const task of tasks) {
		const row = document.createElement("li");
		row.className = `task-row is-${task.status}${openProjectIds.has(task.id) ? " is-open" : ""}`;
		row.dataset.taskId = String(task.id);

		const statusButton = document.createElement("button");
		statusButton.type = "button";
		statusButton.className = "task-status";
		statusButton.dataset.action = "cycle-status";
		statusButton.textContent = getStatusLabel(task.status);
		statusButton.setAttribute("aria-label", `Change status for ${task.title}`);

		const text = document.createElement("p");
		text.className = "task-text";
		text.textContent = task.title;

		const meta = document.createElement("div");
		meta.className = "project-meta";

		const stale = document.createElement("span");
		stale.className = "task-stale";
		stale.textContent = "STALLED";
		stale.hidden = !isStale(task);

		const time = document.createElement("time");
		time.className = "task-time";
		time.dateTime = new Date(task.lastSeen).toISOString();
		time.textContent = formatRelativeTime(task.lastSeen);

		meta.append(stale, time);

		const descriptionPanel = document.createElement("div");
		descriptionPanel.className = "task-description";

		const descriptionField = document.createElement("textarea");
		descriptionField.value = task.description;
		descriptionField.placeholder = "Add a short description...";
		descriptionField.setAttribute("aria-label", `Description for ${task.title}`);
		descriptionField.addEventListener("input", () => {
			task.description = descriptionField.value;
			autosizeDescriptionField(descriptionField);
			task.lastSeen = nowStamp();
			updateTaskRow(task);
		});
		descriptionField.addEventListener("blur", () => {
			task.lastSeen = nowStamp();
			updateTaskRow(task);
			persistTasks();
		});

		descriptionPanel.append(descriptionField);

		row.append(statusButton, text, meta, descriptionPanel);
		fragment.appendChild(row);
	}

	taskList.appendChild(fragment);
	updateEmptyState();

	// Autosize textareas now that they are attached to the DOM
	taskList.querySelectorAll(".task-description textarea").forEach(autosizeDescriptionField);
}

function addTask(title) {
	const value = title.trim();

	if (!value) {
		return;
	}

	tasks.unshift({
		id: nextTaskId++,
		title: value,
		status: "active",
		description: "",
		lastSeen: nowStamp(),
	});

	renderTasks();
	persistTasks();
	updateEmptyState();
}

function cycleStatus(taskId) {
	const task = tasks.find((entry) => entry.id === taskId);

	if (!task) {
		return;
	}

	task.status = nextStatus(task.status);
	touchTask(task);
	renderTasks();
	persistTasks();
	updateEmptyState();
}

function deleteTask(taskId) {
	const taskIndex = tasks.findIndex((entry) => entry.id === taskId);

	if (taskIndex < 0) {
		return;
	}

	tasks.splice(taskIndex, 1);

	openProjectIds.delete(taskId);

	renderTasks();
	persistTasks();
	updateEmptyState();
}

function toggleProjectPanel(taskId) {
	if (openProjectIds.has(taskId)) {
		openProjectIds.delete(taskId);
	} else {
		openProjectIds.add(taskId);
	}

	renderTasks();
	updateEmptyState();
}

function hydrateFromRemote(source) {
	tasks.length = 0;
	tasks.push(...normalizeTasks(source));
	syncNextTaskId();
	for (const id of openProjectIds) {
		if (!tasks.some((task) => task.id === id)) {
			openProjectIds.delete(id);
		}
	}
	renderTasks();
	updateEmptyState();
}

taskForm.addEventListener("submit", (event) => {
	event.preventDefault();
	addTask(taskInput.value);
	taskInput.value = "";
	taskInput.focus();
});

taskList.addEventListener("click", (event) => {
	if (ignoreNextClick) {
		ignoreNextClick = false;
		return;
	}

	const row = event.target.closest(".task-row");

	if (!row) {
		return;
	}

	const taskId = Number(row.dataset.taskId);

	if (!Number.isFinite(taskId)) {
		return;
	}

	if (event.target.closest(".task-status")) {
		cycleStatus(taskId);
		return;
	}

	if (event.target.closest("textarea")) {
		return;
	}

	toggleProjectPanel(taskId);
});

taskList.addEventListener("contextmenu", (event) => {
	const row = event.target.closest(".task-row");
	if (!row) {
		return;
	}

	if (event.target.closest(".task-status") || event.target.closest("textarea")) {
		return;
	}

	event.preventDefault();
	const taskId = Number(row.dataset.taskId);
	if (Number.isFinite(taskId)) {
		showDeletePopup(taskId, event.clientX, event.clientY);
	}
});

taskList.addEventListener("touchstart", (event) => {
	const row = event.target.closest(".task-row");
	if (!row) {
		return;
	}

	if (event.target.closest(".task-status") || event.target.closest("textarea")) {
		return;
	}

	if (event.touches.length !== 1) {
		return;
	}

	const touch = event.touches[0];
	startTouchX = touch.clientX;
	startTouchY = touch.clientY;
	holdActive = false;

	const taskId = Number(row.dataset.taskId);
	if (!Number.isFinite(taskId)) {
		return;
	}

	if (touchTimer) {
		clearTimeout(touchTimer);
	}

	touchTimer = setTimeout(() => {
		holdActive = true;
		ignoreNextClick = true;
		showDeletePopup(taskId, touch.clientX, touch.clientY);
		if (navigator.vibrate) {
			navigator.vibrate(50);
		}
	}, HOLD_DURATION_MS);
}, { passive: true });

taskList.addEventListener("touchmove", (event) => {
	if (!touchTimer) {
		return;
	}

	if (event.touches.length !== 1) {
		clearTimeout(touchTimer);
		touchTimer = null;
		return;
	}

	const touch = event.touches[0];
	const deltaX = touch.clientX - startTouchX;
	const deltaY = touch.clientY - startTouchY;

	if (Math.hypot(deltaX, deltaY) > TOUCH_MOVE_THRESHOLD) {
		clearTimeout(touchTimer);
		touchTimer = null;
	}
}, { passive: true });

taskList.addEventListener("touchend", (event) => {
	if (touchTimer) {
		clearTimeout(touchTimer);
		touchTimer = null;
	}
	if (holdActive) {
		event.preventDefault();
		holdActive = false;
	}
});

taskList.addEventListener("touchcancel", () => {
	if (touchTimer) {
		clearTimeout(touchTimer);
		touchTimer = null;
	}
	holdActive = false;
});

renderTasks();

subscribeAuthState((state) => {
	if (!state.ready) {
		return;
	}

	if (!state.user) {
		connectWorkspaceForUser(null);
		return;
	}

	if (currentUserId === state.user.uid && projectsRef) {
		return;
	}

	connectWorkspaceForUser(state.user);
});

window.WorkTracker = {
	addTask,
	hydrateFromRemote,
	exportSnapshot,
	persistTasks,
	cycleStatus,
	deleteTask,
	toggleProjectPanel,
	connectFirebaseSync,
};
