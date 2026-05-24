(function () {
    const pageRoutes = {
        index: "index.html",
        work: "work.html",
        storage: "storage.html",
    };

    const pageOrder = ["index", "work", "storage"];
    const body = document.body;
    const pageKey = body?.dataset.page;

    if (!pageKey || !pageRoutes[pageKey]) {
        return;
    }

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    function isEditableTarget(target) {
        return target instanceof Element && Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"));
    }

    function navigate(delta) {
        const currentIndex = pageOrder.indexOf(pageKey);
        const nextKey = pageOrder[currentIndex + delta];

        if (!nextKey) {
            return;
        }

        window.location.href = pageRoutes[nextKey];
    }

    body.addEventListener("touchstart", (event) => {
        if (event.touches.length !== 1 || isEditableTarget(event.target)) {
            tracking = false;
            return;
        }

        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        startTime = Date.now();
        tracking = true;
    }, { passive: true });

    body.addEventListener("touchend", (event) => {
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
    }, { passive: true });
})();