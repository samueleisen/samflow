(function () {
	const pageRoutes = {
		index: "index.html",
		work: "work.html",
		skill: "skill.html",
	};

	const pageOrder = ["index", "work", "skill"];
	const swipeLockKey = "skillSwipeNavLocked";
	const body = document.body;
	const pageKey = body?.dataset.page;
	const desktopQuery = window.matchMedia("(min-width: 920px)");
	const DOUBLE_TAP_MS = 320;
	const DOUBLE_TAP_DISTANCE_PX = 24;
	const TAP_MOVE_THRESHOLD_PX = 12;

	if (!pageKey || !pageRoutes[pageKey]) {
		return;
	}

	let gestureCleanup = null;
	let skillTapCleanup = null;
	let arrowRoot = null;
	let swipeStatusDot = null;
	let skillSwipeNavLocked = false;

	function readSkillSwipeLock() {
		try {
			return localStorage.getItem(swipeLockKey) === "true";
		} catch {
			return false;
		}
	}

	function persistSkillSwipeLock(locked) {
		try {
			localStorage.setItem(swipeLockKey, locked ? "true" : "false");
		} catch {
			// Ignore storage failures; in-memory toggle still works this session.
		}
	}

	function shouldMountSwipeGesture() {
		if (pageKey !== "skill") {
			return true;
		}

		return !skillSwipeNavLocked;
	}

	function toggleSkillSwipeLock() {
		skillSwipeNavLocked = !skillSwipeNavLocked;
		persistSkillSwipeLock(skillSwipeNavLocked);
		updateSwipeStatusIndicator();
		applyNavigationMode();
	}

	function updateSwipeStatusIndicator() {
		if (!swipeStatusDot) {
			return;
		}

		const swipeEnabled = !skillSwipeNavLocked;
		swipeStatusDot.classList.toggle("is-unlocked", swipeEnabled);
		swipeStatusDot.classList.toggle("is-locked", !swipeEnabled);
		swipeStatusDot.setAttribute(
			"aria-label",
			swipeEnabled ? "Swipe navigation enabled" : "Swipe navigation blocked",
		);
		swipeStatusDot.title = swipeEnabled
			? "Swipe between tabs enabled. Double-tap empty space to block."
			: "Swipe between tabs blocked. Double-tap empty space to enable.";
	}

	function mountSwipeStatusIndicator() {
		if (swipeStatusDot) {
			swipeStatusDot.remove();
			swipeStatusDot = null;
		}

		if (pageKey !== "skill" || desktopQuery.matches) {
			return;
		}

		swipeStatusDot = document.createElement("div");
		swipeStatusDot.className = "swipe-nav-status";
		swipeStatusDot.setAttribute("role", "status");
		swipeStatusDot.setAttribute("aria-live", "polite");
		body.appendChild(swipeStatusDot);
		updateSwipeStatusIndicator();
	}

	function isEditableTarget(target) {
		return (
			target instanceof Element &&
			Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"))
		);
	}

	function isEmptySkillTapTarget(target) {
		if (!(target instanceof Element)) {
			return false;
		}

		if (isEditableTarget(target)) {
			return false;
		}

		if (target.closest(".skill-node, .skill-connection, .page-nav-arrow, .swipe-nav-status")) {
			return false;
		}

		return Boolean(target.closest("#viewport-frame, .skill-viewport, .skill-canvas, .skill-stage, .skill-shell"));
	}

	function mountSkillDoubleTapToggle() {
		let lastTapTime = 0;
		let lastTapX = 0;
		let lastTapY = 0;
		let touchStartX = 0;
		let touchStartY = 0;
		let touchMoved = false;
		let trackingEmptyTouch = false;

		const controller = new AbortController();
		const options = { passive: true, signal: controller.signal };

		body.addEventListener(
			"touchstart",
			(event) => {
				trackingEmptyTouch = false;
				touchMoved = false;

				if (event.touches.length !== 1 || !isEmptySkillTapTarget(event.target)) {
					return;
				}

				const touch = event.touches[0];
				touchStartX = touch.clientX;
				touchStartY = touch.clientY;
				trackingEmptyTouch = true;
			},
			options,
		);

		body.addEventListener(
			"touchmove",
			(event) => {
				if (!trackingEmptyTouch || event.touches.length !== 1 || touchMoved) {
					return;
				}

				const touch = event.touches[0];
				const deltaX = touch.clientX - touchStartX;
				const deltaY = touch.clientY - touchStartY;

				if (Math.hypot(deltaX, deltaY) > TAP_MOVE_THRESHOLD_PX) {
					touchMoved = true;
				}
			},
			options,
		);

		body.addEventListener(
			"touchend",
			(event) => {
				if (!trackingEmptyTouch || event.changedTouches.length !== 1 || touchMoved) {
					trackingEmptyTouch = false;
					return;
				}

				if (!isEmptySkillTapTarget(event.target)) {
					trackingEmptyTouch = false;
					return;
				}

				const touch = event.changedTouches[0];
				const now = Date.now();
				const deltaX = touch.clientX - lastTapX;
				const deltaY = touch.clientY - lastTapY;
				const elapsed = now - lastTapTime;

				trackingEmptyTouch = false;

				if (elapsed < DOUBLE_TAP_MS && Math.hypot(deltaX, deltaY) < DOUBLE_TAP_DISTANCE_PX) {
					lastTapTime = 0;
					toggleSkillSwipeLock();
					return;
				}

				lastTapTime = now;
				lastTapX = touch.clientX;
				lastTapY = touch.clientY;
			},
			options,
		);

		body.addEventListener(
			"touchcancel",
			() => {
				trackingEmptyTouch = false;
				touchMoved = false;
			},
			options,
		);

		return () => controller.abort();
	}

	function getNeighbor(delta) {
		const currentIndex = pageOrder.indexOf(pageKey);
		const nextKey = pageOrder[currentIndex + delta];
		return nextKey || null;
	}

	function navigate(delta) {
		const currentIndex = pageOrder.indexOf(pageKey);
		const nextKey = pageOrder[currentIndex + delta];

		if (!nextKey) {
			return;
		}

		window.location.href = pageRoutes[nextKey];
	}

	function mountDesktopArrows() {
		if (arrowRoot) {
			arrowRoot.remove();
		}

		const leftTarget = getNeighbor(-1);
		const rightTarget = getNeighbor(1);

		const root = document.createElement("div");
		root.className = "page-nav-arrows";

		const leftButton = document.createElement("button");
		leftButton.type = "button";
		leftButton.className = "page-nav-arrow page-nav-arrow--left";
		leftButton.textContent = "←";
		leftButton.setAttribute("aria-label", "Go to previous page");
		leftButton.disabled = !leftTarget;
		leftButton.addEventListener("click", () => navigate(-1));

		const rightButton = document.createElement("button");
		rightButton.type = "button";
		rightButton.className = "page-nav-arrow page-nav-arrow--right";
		rightButton.textContent = "→";
		rightButton.setAttribute("aria-label", "Go to next page");
		rightButton.disabled = !rightTarget;
		rightButton.addEventListener("click", () => navigate(1));

		root.append(leftButton, rightButton);
		body.appendChild(root);
		arrowRoot = root;
	}

	function mountSwipeGesture() {
		let startX = 0;
		let startY = 0;
		let startTime = 0;
		let tracking = false;

		const controller = new AbortController();
		const options = { passive: true, signal: controller.signal };

		body.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length !== 1 || isEditableTarget(event.target)) {
					tracking = false;
					return;
				}

				const touch = event.touches[0];
				startX = touch.clientX;
				startY = touch.clientY;
				startTime = Date.now();
				tracking = true;
			},
			options,
		);

		body.addEventListener(
			"touchend",
			(event) => {
				if (!tracking || event.changedTouches.length !== 1) {
					tracking = false;
					return;
				}

				const touch = event.changedTouches[0];
				const deltaX = touch.clientX - startX;
				const deltaY = touch.clientY - startY;
				const duration = Date.now() - startTime;

				tracking = false;

				if (duration > 500) {
					return;
				}

				if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.35) {
					return;
				}

				if (deltaX > 0) {
					navigate(1);
				} else {
					navigate(-1);
				}
			},
			options,
		);

		return () => controller.abort();
	}

	function applyNavigationMode() {
		if (gestureCleanup) {
			gestureCleanup();
			gestureCleanup = null;
		}

		if (skillTapCleanup) {
			skillTapCleanup();
			skillTapCleanup = null;
		}

		if (arrowRoot) {
			arrowRoot.remove();
			arrowRoot = null;
		}

		mountSwipeStatusIndicator();

		if (desktopQuery.matches) {
			mountDesktopArrows();
			return;
		}

		if (pageKey === "skill") {
			skillTapCleanup = mountSkillDoubleTapToggle();
		}

		if (shouldMountSwipeGesture()) {
			gestureCleanup = mountSwipeGesture();
		}
	}

	if (pageKey === "skill") {
		skillSwipeNavLocked = readSkillSwipeLock();
	}

	applyNavigationMode();
	desktopQuery.addEventListener("change", applyNavigationMode);
})();
