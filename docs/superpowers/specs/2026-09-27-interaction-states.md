# Repro Vaporwave GUI - Interaction States & Data Flow

**Date:** 2026-09-27  
**Purpose:** Define all interaction states, transitions, and data flow through the UI.

---

## 1. Run Card State Machine

```
┌─────────────────────────────────────────────────────────────┐
│                    RUN CARD STATES                           │
└─────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   CREATED    │ (card enters DOM)
                    └──────┬───────┘
                           │
                    animation: fadeInUp
                           │
                    ┌──────▼───────┐
                    │   IDLE/RESTING │ (no interaction)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         [HOVER]    [CLICK/FOCUS]  [RUNNING]
              │            │            │
         ┌────▼─┐    ┌─────▼──┐   ┌────▼────┐
         │HOVERED│    │SELECTED│   │ACTIVE  │
         └────┬─┘    └─────┬──┘   └────┬────┘
              │            │           │
              │       [OPEN MODAL]  [PROGRESS BAR]
              │            │    │      │
              │       ┌─────▼─┐│      │
         [UNHOVER]    │MODAL ││      │
              │       │OPEN  ││      │
         ┌────▼─┐     └──┬───┘│      │
         │RESTING  │    │      │
         └────────┘  [CLOSE]  [100%]
                     └──┬────┘│  │
                        │     │  │
                   ┌────▼─────▼──▼──┐
                   │   IDLE/RESTING  │
                   └────────────────┘
```

### State Transitions & Animations

**CREATED → IDLE:**
- Trigger: Card mounts in DOM
- Animation: fadeInUp 0.6s with stagger delay
- Progress: 0%
- Visual: Opacity 0 → 1, translateY 30px → 0

**IDLE → HOVERED:**
- Trigger: Mouse enters card
- Animation: 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)
- Visual changes:
  - Border: #000 → #00FFFF
  - Box-shadow: small → large glow
  - Transform: scale(1) → scale(1.02), translateY(0) → translateY(-8px)

**HOVERED → IDLE:**
- Trigger: Mouse leaves card
- Animation: 0.3s ease-out
- Reverse all transformations

**IDLE → SELECTED:**
- Trigger: Click on card
- Animation: 0.2s ease-out
- Action: Open run detail modal

**IDLE → ACTIVE (Running):**
- Trigger: Run status changes to "running"
- Visual changes:
  - Border: #000 → #00FF00 (6px)
  - Top bar: slower slideBar animation (1.5s)
  - Box-shadow: green glow effect
- Progress bar animation starts (0% → current %)
- Stage indicator highlights current stage with cyan glow

**ACTIVE → COMPLETED:**
- Trigger: Run reaches 100% or final status
- Animation: 0.5s ease-out
- Final visual:
  - Progress bar: 100% filled
  - All stages: green checkmarks
  - Status badge: COMPLETED
  - Border glow: Green steady (not pulsing)

---

## 2. Progress Bar State Machine

```
CREATED (0%)
    │
    ├→ animation: expandWidth
    │  duration: 2.5s ease-out
    │  target: var(--progress)
    │
ANIMATING
    │
    ├→ shimmer overlay: continuous
    │  duration: 2s infinite
    │
HALFWAY (50%)
    │
    ├→ color shift possible
    │  #00FFFF → #00FF00 gradient
    │
FINAL (100%)
    │
    └→ settle with steady glow

Progress Value Flow:
- 0-25%:   Detect phase (cyan dominant)
- 25-50%:  Diagnose phase (cyan → green shift)
- 50-75%:  Repair phase (green dominant)
- 75-100%: Verify phase (green intense)
```

---

## 3. Status Badge State Machine

```
CREATED
    │
    animation: pop 0.4s
    │
DISPLAY
    │
    ├→ RUNNING:
    │   animation: pulse 1s infinite
    │   glow effect: 0 0 10px #00FFFF
    │   color: #00FFFF
    │
    ├→ COMPLETED:
    │   animation: none (static)
    │   glow effect: 0 0 10px #00FF00
    │   color: #00FF00
    │
    └→ FAILED:
        color: #FF1493
        glow effect: 0 0 10px #FF1493
```

---

## 4. Modal State Machine

```
┌─────────────────────────────────────────┐
│           MODAL STATES                   │
└─────────────────────────────────────────┘

HIDDEN
    │
    └→ [User presses N or clicks "New Scan"]
            │
       ┌────▼─────────────┐
       │  OVERLAY FADE-IN  │
       │  duration: 0.3s   │
       └────┬─────────────┘
            │
       ┌────▼──────────────┐
       │  MODAL SLIDE-IN    │
       │  duration: 0.5s    │
       │  transform: rotate(X)
       └────┬──────────────┘
            │
       ┌────▼───────────────┐
       │  OPEN/FOCUSED       │
       │  input auto-focus   │
       │  [User types]       │
       └────┬───────────────┘
            │
       ┌────┴────┬─────────┐
       │          │         │
    [ENTER]   [CANCEL]  [ESCAPE]
       │          │         │
       │      ┌───▼──┐  ┌───▼──┐
       │      │Revert│  │Close │
       │      └──────┘  └──────┘
       │                    │
       │          ┌─────────▼─────┐
       │          │ OVERLAY FADE   │
       │          │ duration: 0.3s │
       │          └─────────┬──────┘
       │                    │
       │          ┌─────────▼──────┐
       │          │ MODAL SLIDE-OUT │
       │          │ duration: 0.4s  │
       │          └─────────┬──────┘
       │                    │
       │          ┌─────────▼──────┐
       │          │ HIDDEN         │
       │          └────────────────┘
       │
       └→ [Form submitted, scan starts]
            │
       ┌────▼─────────────┐
       │  LOADING STATE    │
       │  (brief loading   │
       │   animation)      │
       └────┬─────────────┘
            │
       ┌────▼──────────────┐
       │  AUTO-CLOSE       │
       │  duration: 0.4s   │
       └────┬──────────────┘
            │
       ┌────▼──────────┐
       │  HIDDEN       │
       │  (scan queue  │
       │   success)    │
       └───────────────┘
```

---

## 5. Dashboard Data Flow

```
┌─────────────────────────────────────────────┐
│         REAL-TIME DATA UPDATES              │
└─────────────────────────────────────────────┘

API (tRPC)
    │
    ├→ listRuns() [5s poll]
    │   └→ Card list re-render
    │       ├→ New runs: fadeInUp animation
    │       ├→ Updated runs: progress bar expansion
    │       └→ Completed runs: status change animation
    │
    ├→ getRun(runId) [2s poll for active runs]
    │   └→ Run detail modal
    │       ├→ Progress: smooth bar fill
    │       ├→ Stats: countUp animation
    │       └→ Stage: glow shift to next stage
    │
    └→ getReport(runId) [on demand]
        └→ Report modal/tab
            ├→ Stats cards: countUp animation
            ├→ Charts: smooth transitions
            └→ Finding journey: timeline animation

Polling Strategy:
- Idle dashboard: 5000ms poll (less aggressive)
- Active run viewing: 2000ms poll (faster updates)
- Modal open: 1000ms poll (realtime feel)
- Run completed: stop polling (final state)
```

---

## 6. Interaction Event Handlers

### Run Card Events

**Click Event:**
```javascript
runCard.addEventListener('click', () => {
  // 1. Apply SELECTED state animations
  // 2. Fetch run detail
  // 3. Open modal with animateIn: slideInModal
  // 4. Set modal data
});
```

**Mouseenter Event:**
```javascript
runCard.addEventListener('mouseenter', () => {
  // 1. Apply HOVERED state
  // 2. Box-shadow increase
  // 3. Scale and translateY transform
  // 4. Border color shift to cyan
});
```

**Mouseleave Event:**
```javascript
runCard.addEventListener('mouseleave', () => {
  // 1. Revert to IDLE state
  // 2. All transforms reverse
  // 3. Border color reverts
});
```

### Modal Events

**Open Trigger (Click "New Scan" or press N):**
```javascript
document.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') {
    modal.classList.remove('hidden');
    // Trigger OVERLAY FADE-IN
    // Trigger MODAL SLIDE-IN
    // Auto-focus input
  }
});
```

**Close Trigger (Click Cancel, press ESC, or submit):**
```javascript
closeButton.addEventListener('click', () => {
  // Trigger MODAL SLIDE-OUT
  // Trigger OVERLAY FADE-OUT
  // Remove 'hidden' class after animation
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Same close logic
  }
});
```

**Form Submit:**
```javascript
scanForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const target = inputField.value.trim();
  if (!target) return;
  
  // 1. Show loading state
  // 2. Call api.createRun(target)
  // 3. On success: auto-close modal (0.4s delay)
  // 4. Navigate to new run card
  // 5. Highlight new card
});
```

---

## 7. Keyboard Shortcuts

| Key | Action | Behavior |
|-----|--------|----------|
| `N` | New Scan | Open modal (auto-focus input) |
| `ESC` | Close Modal | Reverse animations, remove modal |
| `ENTER` | Submit Form | Same as clicking SCAN button |
| `TAB` | Navigate | Move focus through interactive elements |

---

## 8. Responsive State Adaptations

### Mobile (< 768px)

**Cards:**
- Single column instead of grid
- Reduced padding: 15px → 12px
- Font sizes: -10%
- Animations: Same, no reduction

**Widgets:**
- Clock and stats hidden
- Free up screen space
- Cards take full width (minus padding)

**Modal:**
- Full width with small margins (5%)
- Increased padding (for touch targets)
- Input height: 44px (touch-friendly)
- Button height: 44px (touch-friendly)

**Animations:**
- Entrance animations still 0.6s (smooth, not jarring)
- Hover states disabled (use active/focus instead)
- Shimmer effects subtle (lower FPS on mobile)

---

## 9. Error States

### Run Card Error

```
Visual feedback:
- Border color: #FF1493 (error pink)
- Status badge: "ERROR"
- Progress bar: Stops at current %
- Stage indicator: Current stage flashes red

Action:
- Show error message in modal
- Provide retry option
- Log error details
```

### Failed Scan

```
Modal shows:
- Error icon
- Error message
- Retry button
- Timestamp of failure

Animation:
- Modal entrance still uses slideInModal
- Error badge: Red glow pulse
- Background: Optional slight red tint
```

---

## 10. Loading States

### Fetching Run Data

```
Visual:
- Card shows "LOADING" indicator
- Progress bar: Skeleton animation (pulse)
- Stats: Skeleton states (gray boxes)

Animation:
- Skeleton pulse: 1s ease-in-out infinite
- Opacity: 0.6 → 1 → 0.6
```

### Scanning in Progress

```
Visual:
- Multiple cards in ACTIVE state
- Progress bars all animating
- Live stat counters incrementing

Real-time updates:
- Poll every 1-2s
- Smooth transitions on data changes
- No jarring rerenders
```

---

## 11. Performance Monitoring

### FPS Throttling

```javascript
// Detect low FPS
let frameCount = 0;
let lastTime = performance.now();
const fpsMeasure = () => {
  frameCount++;
  const currentTime = performance.now();
  if (currentTime >= lastTime + 1000) {
    const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
    if (fps < 30) {
      // Disable particle effects
      // Reduce animation quality
      // Disable shimmer overlays
      disableNonEssentialAnimations();
    }
    frameCount = 0;
    lastTime = currentTime;
  }
  requestAnimationFrame(fpsMeasure);
};
fpsMeasure();
```

### Memory Management

```javascript
// Clean up DOM nodes after animations
setTimeout(() => {
  particle.remove();
}, animationDuration + 100);
```

---

## 12. Accessibility Focus States

### Keyboard Focus Indicator

```css
:focus-visible {
  outline: 3px solid #00FFFF;
  outline-offset: 2px;
}

.run-card:focus-visible {
  border-color: #00FFFF;
  box-shadow: 0 0 20px #00FFFF;
}
```

### Screen Reader Announcements

```html
<!-- Live region for dynamic updates -->
<div aria-live="polite" aria-label="Run status updates">
  <div>Run #1 is now at 65% progress in Repair stage</div>
  <div>Run #2 has completed with 83% success rate</div>
</div>
```

---

## 13. Animation Disable (prefers-reduced-motion)

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  
  /* Instant state changes instead of animations */
  .run-card {
    animation: none;
    transition: border-color 0.01ms;
  }
}
```

---

**Summary:**
- Clear state machines for all major components
- Smooth transitions between states
- Real-time data flow with optimized polling
- Accessibility-first keyboard shortcuts
- Performance monitoring and optimization
- Mobile-responsive state adaptations

**Next:** Implement state machines in React with custom hooks and context for global state management.
