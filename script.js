const DAY_START = 0 * 60;
const DAY_END = 24 * 60;
const SLOT_MINUTES = 15;
const DEFAULT_DURATION = 30;
const MIN_DURATION = SLOT_MINUTES;

const DAYS = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];

const weeklySchedules = {
    M: [
        { id: 1, title: "Coding", startTime: "08:00", endTime: "09:30", accent: "#4dd8ff" },
        { id: 2, title: "Design review", startTime: "11:15", endTime: "12:00", accent: "#7cf6c0" },
        { id: 3, title: "Deep work", startTime: "14:00", endTime: "16:30", accent: "#8ea6ff" },
    ],
    Tu: [
        { id: 4, title: "Gym", startTime: "06:45", endTime: "07:30", accent: "#ffb86b" },
        { id: 5, title: "Feature build", startTime: "09:00", endTime: "11:45", accent: "#4dd8ff" },
    ],
    W: [
        { id: 6, title: "Research", startTime: "10:00", endTime: "12:15", accent: "#8ea6ff" },
        { id: 7, title: "Planning", startTime: "19:00", endTime: "20:00", accent: "#ffb86b" },
    ],
    Th: [
        { id: 8, title: "Call", startTime: "13:15", endTime: "14:00", accent: "#7cf6c0" },
        { id: 9, title: "Writing", startTime: "20:15", endTime: "21:45", accent: "#4dd8ff" },
    ],
    F: [
        { id: 10, title: "Weekly review", startTime: "16:00", endTime: "17:30", accent: "#8ea6ff" },
    ],
    Sa: [
        { id: 11, title: "Side project", startTime: "09:45", endTime: "11:00", accent: "#4dd8ff" },
    ],
    Su: [
        { id: 12, title: "Reset", startTime: "18:00", endTime: "19:00", accent: "#ffb86b" },
    ],
};

let activeDay = DAYS[0];
let activeEditorItem = null;
let activeEditorDay = null;

const clockHands = {
    hour: document.getElementById("hour"),
    minute: document.getElementById("min"),
    second: document.getElementById("sec"),
};

const timelineBoard = document.getElementById("timeline-board");
const timelineLabels = document.getElementById("timeline-labels");
const timelineEvents = document.getElementById("timeline-events");
const daySwitch = document.getElementById("day-switch");
const clearDaySchedulesButton = document.getElementById("clear-day-schedules");
const scheduleModal = document.getElementById("schedule-modal");
const scheduleForm = document.getElementById("schedule-form");
const scheduleTitleInput = document.getElementById("schedule-title");
const scheduleStartInput = document.getElementById("schedule-start");
const scheduleEndInput = document.getElementById("schedule-end");
const scheduleSaveButton = document.getElementById("schedule-save");
const scheduleDeleteButton = document.getElementById("schedule-delete");
const scheduleModalKicker = document.getElementById("schedule-modal-kicker");
const scheduleModalTitle = document.getElementById("schedule-modal-title");
const cardById = new Map();

document.documentElement.style.setProperty("--slots-per-day", String((DAY_END - DAY_START) / SLOT_MINUTES));

function getDayItems(day = activeDay) {
    return weeklySchedules[day] || [];
}

function getAllScheduleItems() {
    return DAYS.flatMap((day) => getDayItems(day));
}

function getNextId() {
    return getAllScheduleItems().reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1;
}

function timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
    const safeMinutes = Math.max(0, Math.min(DAY_END, Math.round(totalMinutes)));
    const hours = String(Math.floor(safeMinutes / 60)).padStart(2, "0");
    const minutes = String(safeMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function snapToSlot(minutes) {
    return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function clampToDay(minutes) {
    return Math.max(DAY_START, Math.min(DAY_END, minutes));
}

function getSlotHeight() {
    const rawValue = getComputedStyle(document.documentElement).getPropertyValue("--slot-height");
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isFinite(parsedValue) ? parsedValue : 18;
}

function updateClock() {
    const now = new Date();
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;

    clockHands.second.style.transform = `rotate(${seconds * 6}deg)`;
    clockHands.minute.style.transform = `rotate(${minutes * 6}deg)`;
    clockHands.hour.style.transform = `rotate(${hours * 30}deg)`;
}

function buildDaySwitch() {
    daySwitch.innerHTML = "";

    DAYS.forEach((day) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "day-btn";
        if (day === activeDay) {
            button.classList.add("is-active");
        }
        button.textContent = day;
        button.addEventListener("click", () => {
            if (activeDay === day) {
                return;
            }
            activeDay = day;
            buildDaySwitch();
            renderTimeline();
        });
        daySwitch.appendChild(button);
    });
}

function buildTimelineLabels() {
    timelineLabels.innerHTML = "";

    for (let hour = DAY_START / 60; hour <= DAY_END / 60; hour += 1) {
        const label = document.createElement("div");
        label.className = "timeline-label";
        if (hour === DAY_START / 60) {
            label.classList.add("is-first");
        }
        if (hour === DAY_END / 60) {
            label.classList.add("is-last");
        }

        label.textContent = `${String(hour).padStart(2, "0")}:00`;
        label.style.top = `${((hour * 60 - DAY_START) / SLOT_MINUTES) * getSlotHeight()}px`;
        timelineLabels.appendChild(label);
    }
}

function syncCard(card, item) {
    const startMinutes = timeToMinutes(item.startTime);
    const endMinutes = timeToMinutes(item.endTime);
    const slotHeight = getSlotHeight();
    const top = ((startMinutes - DAY_START) / SLOT_MINUTES) * slotHeight;
    const height = ((endMinutes - startMinutes) / SLOT_MINUTES) * slotHeight;
    const compactThreshold = slotHeight * 2;

    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.zIndex = String(startMinutes);
    card.style.setProperty("--accent", item.accent || "#4dd8ff");
    card.dataset.startMinutes = String(startMinutes);
    card.dataset.endMinutes = String(endMinutes);

    card.classList.toggle("is-compact", height <= compactThreshold);

    const titleLabel = card.querySelector(".event-card__title");
    const timeLabel = card.querySelector(".event-card__time");

    titleLabel.textContent = item.title || "";
    timeLabel.textContent = `${item.startTime} - ${item.endTime}`;
}

function renderTimeline() {
    buildTimelineLabels();
    timelineEvents.innerHTML = "";
    cardById.clear();

    getDayItems().forEach((item) => {
        const card = document.createElement("article");
        card.className = "event-card";
        card.dataset.id = String(item.id);
        card.innerHTML = `
            <div class="event-card__content">
                <p class="event-card__title"></p>
                <p class="event-card__time"></p>
            </div>
            <button class="event-card__resize" type="button" aria-label="Resize ${item.title || "schedule block"}"></button>
        `;

        card.addEventListener("click", (event) => {
            if (event.target.closest(".event-card__resize")) {
                return;
            }
            openEditor(item, false);
        });

        const resizeHandle = card.querySelector(".event-card__resize");
        resizeHandle.addEventListener("pointerdown", (pointerEvent) => {
            pointerEvent.preventDefault();
            pointerEvent.stopPropagation();

            const startPointerY = pointerEvent.clientY;
            const initialEndMinutes = timeToMinutes(item.endTime);
            const slotHeight = getSlotHeight();

            card.classList.add("is-resizing");
            document.body.classList.add("is-resizing");

            resizeHandle.setPointerCapture(pointerEvent.pointerId);

            const handleMove = (moveEvent) => {
                const deltaMinutes = ((moveEvent.clientY - startPointerY) / slotHeight) * SLOT_MINUTES;
                const nextEndMinutes = snapToSlot(clampToDay(initialEndMinutes + deltaMinutes));
                const nextStartMinutes = timeToMinutes(item.startTime);
                const clampedEnd = Math.max(nextStartMinutes + MIN_DURATION, nextEndMinutes);

                item.endTime = minutesToTime(clampedEnd);
                syncCard(card, item);
            };

            const handleFinish = () => {
                card.classList.remove("is-resizing");
                document.body.classList.remove("is-resizing");
                resizeHandle.removeEventListener("pointermove", handleMove);
                resizeHandle.removeEventListener("pointerup", handleFinish);
                resizeHandle.removeEventListener("pointercancel", handleFinish);
            };

            resizeHandle.addEventListener("pointermove", handleMove);
            resizeHandle.addEventListener("pointerup", handleFinish);
            resizeHandle.addEventListener("pointercancel", handleFinish);
        });

        timelineEvents.appendChild(card);
        cardById.set(item.id, card);
        syncCard(card, item);
    });
}

function refreshLayout() {
    buildTimelineLabels();
    getDayItems().forEach((item) => {
        const card = cardById.get(item.id);
        if (card) {
            syncCard(card, item);
        }
    });
}

function getDayFromItem(item) {
    return DAYS.find((day) => getDayItems(day).includes(item)) || activeDay;
}

function createDraftAt(day, startMinutes) {
    const start = clampToDay(snapToSlot(startMinutes));
    const maxStart = DAY_END - DEFAULT_DURATION;
    const boundedStart = Math.max(DAY_START, Math.min(maxStart, start));
    const draft = {
        id: getNextId(),
        title: "",
        startTime: minutesToTime(boundedStart),
        endTime: minutesToTime(boundedStart + DEFAULT_DURATION),
        accent: "#4dd8ff",
        isDraft: true,
    };

    weeklySchedules[day].push(draft);
    return draft;
}

function removeItemFromDay(day, item) {
    weeklySchedules[day] = getDayItems(day).filter((existingItem) => existingItem.id !== item.id);
}

function openEditor(item, isNew) {
    activeEditorItem = item;
    activeEditorDay = getDayFromItem(item);

    scheduleModal.hidden = false;
    scheduleModal.dataset.open = "true";
    scheduleModalKicker.textContent = isNew ? "New schedule" : "Edit schedule";
    scheduleModalTitle.textContent = isNew ? "Create block" : "Update block";
    scheduleDeleteButton.hidden = isNew;

    scheduleTitleInput.value = item.title || "";
    scheduleStartInput.value = item.startTime;
    scheduleEndInput.value = item.endTime;
    scheduleSaveButton.disabled = !scheduleTitleInput.value.trim();

    scheduleTitleInput.focus();
    scheduleTitleInput.select();
}

function clearActiveDay() {
    const items = getDayItems();

    if (!items.length) {
        return;
    }

    if (!window.confirm(`Delete all schedules for ${activeDay}?`)) {
        return;
    }

    if (activeEditorDay === activeDay) {
        closeEditor();
    }

    weeklySchedules[activeDay] = [];
    renderTimeline();
}

function closeEditor({ discardDraft = false } = {}) {
    if (discardDraft && activeEditorItem?.isDraft) {
        removeItemFromDay(activeEditorDay, activeEditorItem);
        renderTimeline();
    }

    activeEditorItem = null;
    activeEditorDay = null;
    scheduleModal.hidden = true;
    delete scheduleModal.dataset.open;
}

function commitEditor() {
    if (!activeEditorItem) {
        return;
    }

    const title = scheduleTitleInput.value.trim();

    if (!title) {
        if (activeEditorItem.isDraft) {
            closeEditor({ discardDraft: true });
        }
        return;
    }

    const startMinutes = clampToDay(snapToSlot(timeToMinutes(scheduleStartInput.value)));
    let endMinutes = clampToDay(snapToSlot(timeToMinutes(scheduleEndInput.value)));

    if (endMinutes <= startMinutes) {
        endMinutes = Math.min(DAY_END, startMinutes + DEFAULT_DURATION);
    }

    if (endMinutes - startMinutes < MIN_DURATION) {
        endMinutes = Math.min(DAY_END, startMinutes + MIN_DURATION);
    }

    activeEditorItem.title = title;
    activeEditorItem.startTime = minutesToTime(startMinutes);
    activeEditorItem.endTime = minutesToTime(endMinutes);
    activeEditorItem.isDraft = false;

    renderTimeline();
    openEditor(activeEditorItem, false);
}

function deleteEditorItem() {
    if (!activeEditorItem) {
        return;
    }

    removeItemFromDay(activeEditorDay, activeEditorItem);
    closeEditor();
    renderTimeline();
}

function getClickedMinutes(boardEvent) {
    const rect = timelineBoard.getBoundingClientRect();
    const offsetY = boardEvent.clientY - rect.top;
    const minutes = DAY_START + (offsetY / getSlotHeight()) * SLOT_MINUTES;
    return clampToDay(minutes);
}

timelineBoard.addEventListener("click", (event) => {
    if (scheduleModal.dataset.open === "true") {
        return;
    }

    const card = event.target.closest(".event-card");
    const resizeHandle = event.target.closest(".event-card__resize");

    if (card || resizeHandle) {
        return;
    }

    const minutes = getClickedMinutes(event);
    const draft = createDraftAt(activeDay, minutes);
    renderTimeline();
    openEditor(draft, true);
});

scheduleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    commitEditor();
});

scheduleDeleteButton.addEventListener("click", deleteEditorItem);
clearDaySchedulesButton.addEventListener("click", clearActiveDay);

scheduleModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-modal]")) {
        closeEditor({ discardDraft: true });
    }
});

scheduleTitleInput.addEventListener("input", () => {
    scheduleSaveButton.disabled = !scheduleTitleInput.value.trim();
});

scheduleStartInput.addEventListener("change", () => {
    scheduleStartInput.value = minutesToTime(snapToSlot(timeToMinutes(scheduleStartInput.value)));
});

scheduleEndInput.addEventListener("change", () => {
    scheduleEndInput.value = minutesToTime(snapToSlot(timeToMinutes(scheduleEndInput.value)));
});

updateClock();
setInterval(updateClock, 1000);
buildDaySwitch();
renderTimeline();

scheduleSaveButton.disabled = true;

window.addEventListener("resize", refreshLayout, { passive: true });