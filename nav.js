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

	if (!pageKey || !pageRoutes[pageKey]) {
		return;
	}

	let gestureCleanup = null;
	let arrowRoot = null;
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

	function updateSwipeLockButton() {
		const swipeLockBtn = document.getElementById("swipe-lock-btn");

		if (!swipeLockBtn) {
			return;
		}

		swipeLockBtn.hidden = desktopQuery.matches;
		swipeLockBtn.setAttribute("aria-pressed", skillSwipeNavLocked ? "true" : "false");
		swipeLockBtn.textContent = skillSwipeNavLocked ? "Swipe Nav: OFF" : "Swipe Nav: ON";
	}

	function mountSwipeLockButton() {
		const swipeLockBtn = document.getElementById("swipe-lock-btn");

		if (!swipeLockBtn) {
			return;
		}

		updateSwipeLockButton();
		swipeLockBtn.addEventListener("click", () => {
			skillSwipeNavLocked = !skillSwipeNavLocked;
			persistSkillSwipeLock(skillSwipeNavLocked);
			updateSwipeLockButton();
			applyNavigationMode();
		});
	}

	if (pageKey === "skill") {
		skillSwipeNavLocked = readSkillSwipeLock();
		mountSwipeLockButton();
	}

	function getNeighbor(delta) {
		const currentIndex = pageOrder.indexOf(pageKey);
		const nextKey = pageOrder[currentIndex + delta];
		return nextKey || null;
	}

	function isEditableTarget(target) {
		return (
			target instanceof Element &&
			Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"))
		);
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

		if (arrowRoot) {
			arrowRoot.remove();
			arrowRoot = null;
		}

		if (pageKey === "skill") {
			updateSwipeLockButton();
		}

		if (desktopQuery.matches) {
			mountDesktopArrows();
			return;
		}

		if (shouldMountSwipeGesture()) {
			gestureCleanup = mountSwipeGesture();
		}
	}

	applyNavigationMode();
	desktopQuery.addEventListener("change", applyNavigationMode);
})();
