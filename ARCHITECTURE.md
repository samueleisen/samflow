## Verified Anti-Patterns

### 1. Fragmented Gesture Systems (3 Separate Touch Handlers)

- **Where**:
  - [nav.js](file:///c:/Users/sam/Code/samflow/nav.js) L17–21 — `TouchEvent` double-tap tracking (`DOUBLE_TAP_MS = 320`, `TAP_MOVE_THRESHOLD_PX = 12`)
  - [work.js](file:///c:/Users/sam/Code/samflow/work.js) L22–23 — `TouchEvent` long-press timer (`HOLD_DURATION_MS = 600`, `ignoreNextClick`)
  - [skill.js](file:///c:/Users/sam/Code/samflow/skill.js) L2459–2499 — 2-finger pinch-to-zoom math via `camera.activePinch` (delegates to `ViewportCamera`)
- **Note**: `viewport-camera.js` itself does **not** own gesture math — it only exposes `beginPan` / `cancelActivePanForPinch`. The pinch loop lives in `skill.js`. The original doc's claim of "4 competing systems" overcounts by 1.
- **Impact**: Gesture collision bugs on mobile (double-tap swipe lock vs. canvas pinch).
- **Fix**: Consolidate into a single `PointerEvent` gesture controller.

---

### 2. `JSON.stringify` Digest Loop Guard

- **Where** (confirmed):
  - [script.js](file:///c:/Users/sam/Code/samflow/script.js) L128, L155 — stringifies weekly schedules on every Firebase `onValue` callback
  - [work.js](file:///c:/Users/sam/Code/samflow/work.js) L279, L294 — stringifies task snapshots on every Firebase update
  - [skill.js](file:///c:/Users/sam/Code/samflow/skill.js) L587, L606, L619 — 3 separate digest helpers for nodes, connections, regions
- **Impact**: CPU overhead during drag/sync operations as data trees grow.
- **Fix**: Use reference equality or explicit write-version tokens instead of serialized string comparison.

---

### 3. Duplicated Firebase Auth Subscriptions (4 Call Sites)

- **Where** (confirmed — `subscribeAuthState` called in):
  - [script.js](file:///c:/Users/sam/Code/samflow/script.js) L601
  - [work.js](file:///c:/Users/sam/Code/samflow/work.js) L839
  - [skill-sync.js](file:///c:/Users/sam/Code/samflow/skill-sync.js) L29
  - [nav.js](file:///c:/Users/sam/Code/samflow/nav.js) L196
- **Note**: `auth.js` is the **correct single source** — it wraps `onAuthStateChanged` and exposes `subscribeAuthState`. The subscription pattern itself is not broken, but each module independently wires its own full Firebase RTDB listener on auth change rather than sharing a central reactive store.
- **`localStorage`**: Only used in `nav.js` L60–68 (swipe-lock preference). The original doc's claim of a broad 3-way desync (`let` arrays + `localStorage` + Firebase) overstates it — `localStorage` is scoped to a single UI preference.
- **Fix**: A shared `sync-store.js` would centralize RTDB listener wiring.

---

### 4. Fragmented UI Construction Patterns

- **Where** (confirmed):
  - [index.html](file:///c:/Users/sam/Code/samflow/index.html) — static hardcoded structure
  - [skill.js](file:///c:/Users/sam/Code/samflow/skill.js) L214, L274, L338, L377 — `innerHTML = \`...\`` template injection for dialogs/popups
  - [work.js](file:///c:/Users/sam/Code/samflow/work.js) L54–594 — extensive `document.createElement` chains for modals and task list rows
  - [script.js](file:///c:/Users/sam/Code/samflow/script.js) L309–386 — mixed `createElement` + `innerHTML` for timeline cards
- **Impact**: No shared component abstraction; event binding is scattered; memory leak risk from uncleaned listeners.
- **Fix**: Standardize on one construction pattern per UI category (e.g., `createElement` for dynamic lists, `<template>` elements for dialogs).

---

### 5. Breakpoint & Z-Index Coordination Clashes

- **Where** (confirmed):
  - [nav.js](file:///c:/Users/sam/Code/samflow/nav.js) L16 — `window.matchMedia("(min-width: 920px)")` for JS desktop layout detection
  - [skill.js](file:///c:/Users/sam/Code/samflow/skill.js) L43 — same `920px` query (consistent between these two ✅)
  - [skill.css](file:///c:/Users/sam/Code/samflow/skill.css) L363 — `@media (min-width: 920px)` (also consistent ✅)
  - [style.css](file:///c:/Users/sam/Code/samflow/style.css) L17 — `@media (max-width: 768px)`, L180 — `@media (max-width: 640px)`
  - [work.css](file:///c:/Users/sam/Code/samflow/work.css) L438 — `@media (max-width: 640px)` *(not in original docs)*
  - **Z-index**: `skill.css` uses `40`, `50`, `80` (L85, L294, L126, L911); `style.css` uses `5000`, `5001` (L347, L362)
- **Note**: The original doc's claim that `nav.js` uses a different breakpoint from `skill.css` is **inaccurate** — both use `920px`. The real split is `style.css`/`work.css` using `640px`/`768px` while JS and `skill.css` use `920px`.
- **Impact**: Viewport widths 768–920px get Desktop JS logic but Mobile CSS layout.
- **Fix**: Define breakpoints as CSS custom properties; establish a `z-index` scale token system.

---

## File-by-File Status

| File | Size | Anti-Patterns | Priority |
|------|------|---------------|----------|
| [skill.js](file:///c:/Users/sam/Code/samflow/skill.js) | **77.9 KB** | #1, #2, #4 | 🔴 Highest |
| [work.js](file:///c:/Users/sam/Code/samflow/work.js) | 21.6 KB | #1, #2, #3, #4 | 🔴 High |
| [script.js](file:///c:/Users/sam/Code/samflow/script.js) | 19.1 KB | #2, #3, #4 | 🟠 Medium |
| [nav.js](file:///c:/Users/sam/Code/samflow/nav.js) | 13.4 KB | #1, #3, #5 | 🟠 Medium |
| [skill.css](file:///c:/Users/sam/Code/samflow/skill.css) | 25.0 KB | #5 (z-index) | 🟡 Low |
| [style.css](file:///c:/Users/sam/Code/samflow/style.css) | 17.9 KB | #5 (breakpoints) | 🟡 Low |
| [work.css](file:///c:/Users/sam/Code/samflow/work.css) | 9.3 KB | #5 (breakpoints) | 🟡 Low |
| [skill-sync.js](file:///c:/Users/sam/Code/samflow/skill-sync.js) | 5.0 KB | Well-structured — model for #3 fix | ✅ Good |
| [auth.js](file:///c:/Users/sam/Code/samflow/auth.js) | 2.5 KB | Single `onAuthStateChanged`, pub/sub pattern | ✅ Good |
| [viewport-camera.js](file:///c:/Users/sam/Code/samflow/viewport-camera.js) | 4.7 KB | Inline `--grid-size`/`--dot-size` style injection in `updateCanvasTransform()` | 🟡 Minor |
| [firebase-config.js](file:///c:/Users/sam/Code/samflow/firebase-config.js) | 1.4 KB | None | ✅ Fine |

---

## Simplification Roadmap

- [ ] **Step 1** — Clean [viewport-camera.js](file:///c:/Users/sam/Code/samflow/viewport-camera.js): move `--grid-size`/`--dot-size` CSS variable writes out of the camera transform loop into a separate observer/callback. (Smallest scope, easiest win.)
- [ ] **Step 2** — Unify breakpoints: extract `640px`, `768px`, `920px` into CSS custom property tokens; align `style.css` and `work.css` to cover the 768–920px gap.
- [ ] **Step 3** — Centralize z-index: define a z-index scale in `:root` (e.g. `--z-overlay`, `--z-modal`, `--z-toast`) and replace raw numbers in `skill.css` and `style.css`.
- [ ] **Step 4** — Create `sync-store.js`: consolidate RTDB listener wiring from `script.js`, `work.js`, and `skill-sync.js` using the auth pub/sub already in `auth.js`. (`skill-sync.js` is the reference implementation.)
- [ ] **Step 5** — Simplify [nav.js](file:///c:/Users/sam/Code/samflow/nav.js): replace `swipeStatusDot.remove()` + `createElement` rebuild pattern with a single persistent element toggled by CSS classes.
- [ ] **Step 6** — Split [skill.js](file:///c:/Users/sam/Code/samflow/skill.js) (77.9 KB) into focused sub-modules: `skill-render.js`, `skill-gestures.js`, `skill-dialogs.js`, keeping `skill.js` as an orchestrator.
