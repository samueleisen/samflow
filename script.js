const DAY_START = 6 * 60;
const DAY_END = 24 * 60;
const SLOT_MINUTES = 30;
const MIN_DURATION = SLOT_MINUTES;

const scheduleItems = [
    { id: 1, title: "Coding", startTime: "08:00", endTime: "09:30", accent: "#4dd8ff" },
    { id: 2, title: "Design review", startTime: "11:00", endTime: "12:00", accent: "#7cf6c0" },
    { id: 3, title: "Deep work", startTime: "14:00", endTime: "16:30", accent: "#8ea6ff" },
    { id: 4, title: "Planning", startTime: "19:00", endTime: "20:00", accent: "#ffb86b" },
];

const clockHands = {
    hour: document.getElementById("hour"),
    minute: document.getElementById("min"),
    second: document.getElementById("sec"),
};

const timelineLabels = document.getElementById("timeline-labels");
const timelineEvents = document.getElementById("timeline-events");
const cardById = new Map();

function timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
    const safeMinutes = Math.max(0, Math.round(totalMinutes));
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
    return Number.isFinite(parsedValue) ? parsedValue : 48;
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
        label.style.top = `${(hour * 60 - DAY_START) / SLOT_MINUTES * getSlotHeight()}px`;
        timelineLabels.appendChild(label);
    }
}

function syncCard(card, item) {
    const startMinutes = timeToMinutes(item.startTime);
    const endMinutes = timeToMinutes(item.endTime);
    const slotHeight = getSlotHeight();
    const top = ((startMinutes - DAY_START) / SLOT_MINUTES) * slotHeight;
    const height = ((endMinutes - startMinutes) / SLOT_MINUTES) * slotHeight;

    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.setProperty("--accent", item.accent);
    card.dataset.startMinutes = String(startMinutes);
    card.dataset.endMinutes = String(endMinutes);

    const timeLabel = card.querySelector(".event-card__time");
    timeLabel.textContent = `${item.startTime} - ${item.endTime}`;
}

function renderTimeline() {
    buildTimelineLabels();
    timelineEvents.innerHTML = "";
    cardById.clear();

    scheduleItems.forEach((item) => {
        const card = document.createElement("article");
        card.className = "event-card";
        card.dataset.id = String(item.id);
        card.innerHTML = `
            <div class="event-card__content">
                <p class="event-card__title">${item.title}</p>
                <p class="event-card__time"></p>
            </div>
            <button class="event-card__resize" type="button" aria-label="Resize ${item.title}"></button>
        `;

        const resizeHandle = card.querySelector(".event-card__resize");
        resizeHandle.addEventListener("pointerdown", (pointerEvent) => {
            pointerEvent.preventDefault();

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
    scheduleItems.forEach((item) => {
        const card = cardById.get(item.id);
        if (card) {
            syncCard(card, item);
        }
    });
}

updateClock();
setInterval(updateClock, 1000);
renderTimeline();

window.addEventListener("resize", refreshLayout, { passive: true });