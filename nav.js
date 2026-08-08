import { signInWithGoogle, signOutUser, subscribeAuthError, subscribeAuthState } from "./auth.js";

(function () {
	// ── Route & Environment Setup ──────────────────────────────────────
	const pageRoutes = {
		index: "/",
		work: "/work/",
		time: "/time/",
	};

	const pageOrder = ["time", "index", "work"];
	const swipeLockKey = "skillSwipeNavLocked";
	const body = document.body;
	const rawPageKey = body?.dataset.page;
	const pagePath = window.location.pathname;
	const desktopQuery = window.matchMedia("(min-width: 920px)");
	const DOUBLE_TAP_MS = 320;
	const DOUBLE_TAP_DISTANCE_PX = 24;
	const DOUBLE_TAP_DISTANCE_SQ = DOUBLE_TAP_DISTANCE_PX * DOUBLE_TAP_DISTANCE_PX;
	const TAP_MOVE_THRESHOLD_PX = 12;
	const TAP_MOVE_THRESHOLD_SQ = TAP_MOVE_THRESHOLD_PX * TAP_MOVE_THRESHOLD_PX;

	/**
	 * Resolves active page key from body data attribute or URL pathname.
	 */
	function resolvePageKey(key, pathname) {
		if (key === "skill") return "index";
		if (pathname.startsWith("/work")) return "work";
		if (pathname.startsWith("/time")) return "time";
		if (key && pageRoutes[key]) return key;
		if (pathname === "/" || pathname.endsWith("/index.html")) return "index";
		return null;
	}

	const pageKey = resolvePageKey(rawPageKey, pagePath);
	if (!pageKey || !pageRoutes[pageKey]) return;

	// Global controller & auth state
	let gestureCleanup = null;
	let skillTapCleanup = null;
	let arrowRoot = null;
	let swipeStatusDot = null;
	let skillSwipeNavLocked = false;

	let authRoot = null;
	let authButton = null;
	let authDetail = null;
	let authUnsubscribers = [];
	let authState = {
		ready: false,
		user: null,
		errorMessage: "",
	};
	let authBusy = false;

	// ── Swipe Lock State & Storage ──────────────────────────────────────

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
			// Storage failure fallback: state remains in memory for active session
		}
	}

	function shouldMountSwipeGesture() {
		if (pageKey !== "index") return true;
		return !skillSwipeNavLocked;
	}

	function toggleSkillSwipeLock() {
		skillSwipeNavLocked = !skillSwipeNavLocked;
		persistSkillSwipeLock(skillSwipeNavLocked);
		updateSwipeStatusIndicator();
		applyNavigationMode();
	}

	// ── Swipe Status Indicator UI ───────────────────────────────────────

	function updateSwipeStatusIndicator() {
		if (!swipeStatusDot) return;

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

		if (pageKey !== "index" || desktopQuery.matches) return;

		swipeStatusDot = document.createElement("div");
		swipeStatusDot.className = "swipe-nav-status";
		swipeStatusDot.setAttribute("role", "status");
		swipeStatusDot.setAttribute("aria-live", "polite");
		body.appendChild(swipeStatusDot);
		updateSwipeStatusIndicator();
	}

	// ── Google Auth Controls UI ──────────────────────────────────────────

	function getAuthLabel() {
		if (authState.errorMessage) return authState.errorMessage;
		if (!authState.ready) return "Connecting to Google";
		if (!authState.user) return "Sign in to sync your workspace";
		return authState.user.displayName || authState.user.email || "Google account";
	}

	function updateAuthControls() {
		if (!authRoot || !authButton || !authDetail) return;

		authRoot.classList.toggle("is-authenticated", Boolean(authState.user));
		authRoot.classList.toggle("is-loading", !authState.ready);
		authButton.disabled = authBusy || !authState.ready;
		authButton.textContent = authState.user ? "Sign out" : authState.ready ? "Sign in with Google" : "Connecting...";
		authDetail.textContent = getAuthLabel();
		authDetail.title = authState.errorMessage || getAuthLabel();
		authButton.title = authState.user ? `Signed in as ${authState.user.uid}` : "Use Google sign-in to unlock sync.";
		authRoot.title = authState.user ? `Signed in as ${authState.user.uid}` : "";
	}

	function mountAuthControls() {
		if (authRoot) {
			authRoot.remove();
		}

		// Clean up existing auth listeners to avoid duplicate subscriptions
		authUnsubscribers.forEach((unsubscribe) => unsubscribe());
		authUnsubscribers = [];

		authRoot = document.createElement("div");
		authRoot.className = "auth-shell";

		const panel = document.createElement("div");
		panel.className = "auth-chip";

		const copy = document.createElement("div");
		copy.className = "auth-chip__copy";

		const eyebrow = document.createElement("span");
		eyebrow.className = "auth-chip__eyebrow";
		eyebrow.textContent = "Google account";

		authDetail = document.createElement("span");
		authDetail.className = "auth-chip__detail";

		copy.append(eyebrow, authDetail);

		authButton = document.createElement("button");
		authButton.type = "button";
		authButton.className = "auth-chip__button";
		authButton.addEventListener("click", async () => {
			if (authBusy || !authState.ready) return;

			authBusy = true;
			updateAuthControls();

			try {
				if (authState.user) {
					await signOutUser();
				} else {
					await signInWithGoogle();
				}
			} catch (error) {
				window.alert(error?.message || "Unable to update Google sign-in right now.");
			} finally {
				authBusy = false;
				updateAuthControls();
			}
		});

		panel.append(copy, authButton);
		authRoot.appendChild(panel);
		body.appendChild(authRoot);

		authUnsubscribers.push(
			subscribeAuthState((state) => {
				authState = state;
				updateAuthControls();
			}),
			subscribeAuthError((message) => {
				authState.errorMessage = message;
				updateAuthControls();
			})
		);
	}

	// ── Target & Gesture Filtering ─────────────────────────────────────

	function isEditableTarget(target) {
		return (
			target instanceof Element &&
			Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"))
		);
	}

	function isEmptySkillTapTarget(target) {
		if (!(target instanceof Element)) return false;
		if (isEditableTarget(target)) return false;

		if (target.closest(".skill-node, .skill-connection, .page-nav-arrow, .swipe-nav-status")) {
			return false;
		}

		return Boolean(target.closest("#viewport-frame, .skill-viewport, .skill-canvas, .skill-stage, .skill-shell"));
	}

	// ── Double Tap Gesture Listener ────────────────────────────────────

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
				if (!trackingEmptyTouch || event.touches.length !== 1 || touchMoved) return;

				const touch = event.touches[0];
				const deltaX = touch.clientX - touchStartX;
				const deltaY = touch.clientY - touchStartY;

				if (deltaX * deltaX + deltaY * deltaY > TAP_MOVE_THRESHOLD_SQ) {
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

				if (elapsed < DOUBLE_TAP_MS && (deltaX * deltaX + deltaY * deltaY < DOUBLE_TAP_DISTANCE_SQ)) {
					lastTapTime = 0;
					queueMicrotask(() => toggleSkillSwipeLock());
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

	// ── Page Navigation & Desktop Controls ──────────────────────────────

	function getNeighbor(delta) {
		const currentIndex = pageOrder.indexOf(pageKey);
		const nextKey = pageOrder[currentIndex + delta];
		return nextKey || null;
	}

	function navigate(delta) {
		const currentIndex = pageOrder.indexOf(pageKey);
		const nextKey = pageOrder[currentIndex + delta];
		if (!nextKey) return;
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

	// ── Mobile Swipe Gesture Listener ───────────────────────────────────

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

				if (duration > 500) return;
				if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.35) return;

				if (deltaX > 0) {
					navigate(-1);
				} else {
					navigate(1);
				}
			},
			options,
		);

		return () => controller.abort();
	}

	// ── Navigation Controller & Lifecycle ──────────────────────────────

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

		if (pageKey === "index") {
			skillTapCleanup = mountSkillDoubleTapToggle();
		}

		if (shouldMountSwipeGesture()) {
			gestureCleanup = mountSwipeGesture();
		}
	}

	// ── Initialization ──────────────────────────────────────────────────

	if (pageKey === "index") {
		skillSwipeNavLocked = readSkillSwipeLock();
	}

	if (pageKey === "time") {
		mountAuthControls();
	}

	applyNavigationMode();
	desktopQuery.addEventListener("change", applyNavigationMode);
})();
