import { database, ref, set, onValue } from "./firebase-config.js";
import { subscribeAuthState } from "./auth.js";

const taskInput = document.getElementById("task-input");
const taskForm = document.getElementById("task-form");
const taskList = document.getElementById("task-list");
const taskEmpty = document.getElementById("task-empty");

const tasks = [];
let nextTaskId = 1;
let openProjectId = null;
let projectsRef = null;
let projectsUnsubscribe = null;
let currentUserId = null;
let lastWrittenDigest = "";

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
		status: ["active", "hibernating", "archived"].includes(candidate.status) ? candidate.status : "active",
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
	openProjectId = null;
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
	if (status === "archived") {
		return "✓";
	}

	return "";
}

function nextStatus(status) {
	if (status === "active") {
		return "hibernating";
	}

	if (status === "hibernating") {
		return "archived";
	}

	return "active";
}

function touchTask(task) {
	if (!task) {
		return;
	}

	task.lastSeen = nowStamp();
	updateTaskRow(task);
	if (task.id === openProjectId) {
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
	field.style.overflowY = field.scrollHeight > descriptionMaxHeightPx ? "auto" : "hidden";
}

function updateTaskRow(task) {
	const row = taskList.querySelector(`[data-task-id="${task.id}"]`);

	if (!row) {
		return;
	}

	row.className = `task-row is-${task.status}${openProjectId === task.id ? " is-open" : ""}`;

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
		row.className = `task-row is-${task.status}${openProjectId === task.id ? " is-open" : ""}`;
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
		stale.textContent = "Stale";
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
		autosizeDescriptionField(descriptionField);
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

		const deleteButton = document.createElement("button");
		deleteButton.type = "button";
		deleteButton.className = "task-delete";
		deleteButton.textContent = "Delete project";
		deleteButton.setAttribute("aria-label", `Delete ${task.title}`);

		descriptionPanel.append(descriptionField, deleteButton);

		row.append(statusButton, text, meta, descriptionPanel);
		fragment.appendChild(row);
	}

	taskList.appendChild(fragment);
	updateEmptyState();
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

	openProjectId = null;
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

	if (openProjectId === taskId) {
		openProjectId = null;
	}

	renderTasks();
	persistTasks();
	updateEmptyState();
}

function toggleProjectPanel(taskId) {
	openProjectId = openProjectId === taskId ? null : taskId;
	const task = tasks.find((entry) => entry.id === taskId);

	if (task) {
		touchTask(task);
	}

	renderTasks();
	persistTasks();
	updateEmptyState();
}

function hydrateFromRemote(source) {
	tasks.length = 0;
	tasks.push(...normalizeTasks(source));
	syncNextTaskId();
	if (!tasks.some((task) => task.id === openProjectId)) {
		openProjectId = null;
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

	if (event.target.closest(".task-delete")) {
		deleteTask(taskId);
		return;
	}

	if (event.target.closest("textarea")) {
		return;
	}

	toggleProjectPanel(taskId);
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
