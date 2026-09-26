# Repro Vaporwave GUI Design Specification

**Date:** 2026-09-27  
**Vision:** A retro-futuristic, vaporwave-aesthetic code repair dashboard inspired by typesafe.ai's floating window UI. One main dashboard with modal popups, featuring particle effects, smooth animations, typing effects, and a fully animated "living" interface.

---

## 1. Visual Style & Color Palette

### Primary Colors
- **Background:** Hot pink/magenta (`#FF1493` or `#FF69B4`) with subtle dotted/stipple texture overlay
- **Window Borders:** Pure black (`#000000`)
- **Window Background:** Off-white/light gray (`#F5F5F5`) with slight noise/grain
- **Text Primary:** Black (`#000000`)
- **Accent Text:** Cyan (`#00FFFF`) for status/active states
- **Success:** Lime green (`#00FF00`)
- **Error/Warning:** Hot pink (`#FF1493`)

### Texture Layer
- **Dotted stipple pattern** across entire background (like the reference image)
- **Scanline effect** optional on windows (subtle horizontal lines)
- **Pixel art borders** around all major elements (3-5px solid black)

---

## 2. Layout Architecture

### 2.1 Main Container
```
┌─────────────────────────────────────────────────────┐
│  PINK BACKGROUND WITH STIPPLE TEXTURE + PARTICLES  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ [MAIN DASHBOARD WINDOW - RUNS LIST]          │  │
│  │                                              │  │
│  │  - Active runs at top (flowing down)         │  │
│  │  - Past runs below                           │  │
│  │  - Global stats (top right corner)           │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  [FLOATING DECORATIVE WIDGETS]                      │
│  - Clock (top right)                               │
│  - Stats cards (scattered)                         │
│  - Animation particles (background)                │
│                                                     │
│  [MODAL POPUP - OVERLAID] (when triggered)         │
│  - Start new scan modal                            │
│  - Run detail modal                                │
│  - Report modal                                    │
└─────────────────────────────────────────────────────┘
```

### 2.2 Main Dashboard Window
- **Border:** 4-6px solid black
- **Title bar:** Black background, white text, pixel font
- **Size:** ~90% viewport width/height, centered
- **Content:** 
  - Header row with "REPRO DASHBOARD 1.1" and stats
  - Grid/list of run cards
  - Bottom section with aggregate metrics

---

## 3. Run Cards (Main Dashboard Content)

### Layout: Compact Retro Card Grid
```
┌──────────────────────────────────────────────────┐
│ [ACTIVE RUN CARD]                                │
├──────────────────────────────────────────────────┤
│ ID: 7f2a1b9c  Status: RUNNING  Stage: REPAIR   │
├──────────────────────────────────────────────────┤
│ Target: repo/main                                │
│                                                  │
│ Progress Flow: [===>    ] 65%                   │
│                                                  │
│ Stats Row:                                       │
│  Findings: 24 | Reproduced: 18 | Verified: 5    │
│                                                  │
│ [Stage Pipeline Visualization]                   │
│ ingest ✓ | detect ✓ | diagnose ✓ | repair ▶    │
└──────────────────────────────────────────────────┘
```

### Card Features
- **Hover state:** Border color shifts to cyan, slight glow
- **Click:** Opens run detail modal
- **Animations:**
  - Progress bar fills smoothly
  - Stats numbers count up/animate
  - Stage indicator pulses/glows at current stage
  - Text slides in on first load (typing effect)

### Card Types
1. **Active Run Card** (top, highlighted)
   - Progress bar (animated fill)
   - Current stage highlighted in cyan
   - Real-time stats

2. **Past Run Card** (collapsed/minimal)
   - Final status (✓ completed, ✗ failed)
   - Summary stats
   - Click to expand or open modal

---

## 4. Modal System

### 4.1 Start Scan Modal
```
┌─────────────────────────┐
│ ┌───────────────────┐   │
│ │ NEW SCAN 1.1      │   │ (black bg, white text, pixel font)
│ └───────────────────┘   │
│                         │
│ Target Repository:      │
│ [text input field]      │
│                         │
│ [SCAN] [CANCEL]         │
│                         │
└─────────────────────────┘
```
- Centered on screen
- Semi-transparent dark overlay behind modal
- Border: 4px solid black
- Input field with retro styling

### 4.2 Run Detail Modal
- Shows report stats (finding flow, patches, success %)
- Tabs: Report | Findings | Diagnoses | Patches
- Each content section animated in on reveal
- Close button (X) in top right

### 4.3 Animation Details
- **Entrance:** Modal slides in from top, slight bounce
- **Exit:** Modal slides out downward
- **Content reveal:** Text types in character-by-character
- **Transitions:** Smooth easing (0.3s cubic-bezier)

---

## 5. Floating Decorative Widgets

### 5.1 Clock Widget
```
┌──────────────────┐
│ Clock Tool 1.1   │
├──────────────────┤
│ Sunday, Sep 27   │
│ 00:22:59        │
└──────────────────┘
```
- Top right corner
- 4px black border
- Updates in real-time
- Pixel font

### 5.2 Stats Cards (Scattered)
- Placed around the main window (top left, bottom left, etc.)
- Show aggregate stats:
  - Total runs completed
  - Total findings fixed
  - Average success rate
  - Total cost saved
- Border: 2-3px black
- Numbers animate on load

### 5.3 Game of Life Animation
- **Background layer** behind everything
- Conway's Game of Life particles
- Pink and darker shades of pink
- Subtle, doesn't distract from main content
- Spawns new cells at ~30% chance each tick
- Continuous animation loop

---

## 6. Animations & Effects

### 6.1 Particle Effects
- **Game of Life background:** Continuous, subtle, living grid
- **Sparkle particles:** Appear when milestones hit (patch verified, run complete)
- **Glitch effect:** Optional, brief (100ms) on errors
- **Glow effect:** Around active elements (cyan/green)

### 6.2 Typing Animations
- **Card headers:** Text appears letter-by-letter (50-100ms per char)
- **Modal content:** Typing speed adjusts based on content length
- **Stats numbers:** Count from 0 to final value (500-800ms duration)

### 6.3 Smooth Transitions
- **Stage progression:** Current stage indicator glows/pulses
- **Progress bars:** Smooth linear fill
- **Window positions:** Slide/fade on enter/exit
- **Hover states:** Color shift (0.2s), slight scale (1.05x)
- **Status changes:** Flash (50ms white overlay) then settle

### 6.4 Real-Time Updates
- **Live run stats:** Update without page reload
- **Progress animation:** Progress bar advances as run progresses
- **Stage transitions:** Smooth visual shift to next stage
- **Notification flash:** Brief highlight when new data arrives

---

## 7. Typography & Text Styling

### Font Stack
1. **Headers:** Pixel/Retro font (e.g., `Press Start 2P`, `JetBrains Mono Bold`, monospace)
2. **Body text:** Monospace (e.g., `JetBrains Mono`, `Courier New`)
3. **Labels:** Uppercase, pixel font, letter-spacing +1-2px

### Text Styles
- **Window titles:** `Bold 14px, all caps, black bg, white text, pixel font`
- **Card headers:** `Bold 12px, uppercase, monospace`
- **Body text:** `Regular 11px, monospace, dark gray`
- **Metrics/numbers:** `Bold 16px, monospace, color varies by metric`
- **Status text:** `Bold 10px, uppercase, cyan when active`

---

## 8. Interactive Elements

### 8.1 Buttons
- **Style:** Black border (3px), white/black text, uppercase, pixel font
- **Hover:** Border color → cyan, slight glow, cursor pointer
- **Active/Pressed:** Invert colors (black bg, white text)
- **Disabled:** Gray border, 50% opacity

### 8.2 Input Fields
- **Border:** 2px solid black
- **Background:** Light gray with subtle grain
- **Text:** Black, monospace
- **Focus state:** Cyan border, glow, cursor visible
- **Placeholder:** Gray text, subtle

### 8.3 Status Indicators
- **Dot indicators:** Colored circles (green=success, red=error, yellow=pending, cyan=in-progress)
- **Text labels:** E.g., "RUNNING", "VERIFIED", "REJECTED"
- **Glow effect:** Active status pulses with matching color

---

## 9. Main Dashboard Data Display

### 9.1 Run List Layout
```
┌─────────────────────────────────────────────────────┐
│ REPRO 1.1 - LIVE DASHBOARD              [Runs: 12]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [ACTIVE RUN #1] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │
│  └─ Progress & stats (animated)                    │
│                                                     │
│  [ACTIVE RUN #2] ━━━━━━━━━━━━━━━━━━━━━           │
│  └─ Progress & stats (animated)                    │
│                                                     │
│  ┌─ PAST RUNS (Collapsed) ────────────────────────┐│
│  │ [Run #3] ✓ Success | 28 findings → 7 fixed     ││
│  │ [Run #4] ✓ Success | 15 findings → 4 fixed     ││
│  │ [Run #5] ✗ Failed  | 22 findings → 0 fixed     ││
│  └────────────────────────────────────────────────┘│
│                                                     │
│  [GLOBAL STATS]                                    │
│  Total Fixed: 47 | Success Rate: 87% | Cost: $2.34 │
└─────────────────────────────────────────────────────┘
```

### 9.2 Aggregate Stats (Bottom of Dashboard)
- **Total runs:** Current session count
- **Findings fixed:** Cumulative count
- **Success rate:** Percentage
- **Estimated cost:** Total API cost for session
- **Time elapsed:** Session duration
- All stats update in real-time with animations

---

## 10. Color Coding & Status System

### Finding Status
- **Detected:** Gray
- **Reproduced:** Cyan
- **Diagnosed:** Light blue
- **Repaired:** Yellow
- **Verified:** Lime green
- **Merged:** Bright green
- **Rejected:** Hot pink

### Run Status
- **Queued:** Gray
- **Running:** Cyan (pulsing)
- **Completed:** Green
- **Failed:** Red/Hot pink

### Stage Indicators
- **Ingest:** Gray → Cyan (in progress) → Green (complete)
- **Detect:** Same flow
- **Diagnose:** Same flow
- **Repair:** Same flow
- **Verify:** Same flow

---

## 11. Responsive Behavior

### Viewport Handling
- **Large screens (1440+):** Full card grid layout, multiple columns
- **Medium screens (1024-1440):** 2-column layout, cards may be slightly smaller
- **Small screens (768-1024):** Single column, cards adapt
- **Mobile:** Collapse to modal-centric view, hide decorative widgets

### Scale Notes
- Maintain 3-5px border thickness across all sizes
- Font sizes scale slightly on mobile
- Decorative widgets may hide on very small screens
- Particle effect intensity reduces on lower-end devices

---

## 12. Implementation Tech Stack

### Frontend
- **Framework:** React (existing)
- **Animation library:** Framer Motion (for smooth transitions, particle effects)
- **Game of Life:** Canvas API or Three.js (background layer)
- **Styling:** CSS-in-JS (Emotion/Styled Components) or Tailwind with custom layers
- **Fonts:** Google Fonts (Press Start 2P for headers, JetBrains Mono for body)

### Key Libraries
- `framer-motion` - Animations, transitions, particle effects
- `react-use-measure` - Dynamic sizing for responsive layout
- `canvas-based-game-of-life` or custom implementation
- Real-time data updates via existing tRPC client

---

## 13. MVP Scope

### Phase 1 (This Design Session)
- ✅ Finalize visual style & color palette
- ✅ Define layout & window system
- ✅ Specify main dashboard card design
- ✅ Define modal system
- ✅ Detail all animations
- ✅ Create comprehensive component spec

### Phase 2 (Implementation)
- Build React component structure
- Implement Game of Life background
- Add Framer Motion animations
- Build main dashboard with live run cards
- Build modal system (start scan, run detail)
- Wire to tRPC API for real-time updates
- Add decorative widgets (clock, stats)
- Test animations & performance
- Polish & optimize

---

## 14. Design Principles

1. **Retro aesthetics** don't compromise usability
2. **Animations** enhance, not distract (keep performance in mind)
3. **Information hierarchy** is clear despite the visual style
4. **Accessibility:** High contrast, readable fonts, no animation-only feedback
5. **Personality:** The interface should feel alive, playful, and engaging
6. **Consistency:** All windows/cards follow the same border/styling rules
7. **Performance:** Particle effects and animations don't tank FPS

---

## 15. Decorative Elements & Easter Eggs

- **Game of Life:** Living background that evolves
- **Clock widget:** Always-visible time display (unnecessary but delightful)
- **Random stat cards:** Different positions on each load
- **Glitch text:** Rare animation errors that look intentional
- **Status sparkles:** Celebratory particles on successful actions

---

**Next Steps:** Build interactive mockup showcasing:
1. Main dashboard with sample run cards
2. Modal animations
3. Real-time stat updates
4. Game of Life background
5. Hover/interaction states
