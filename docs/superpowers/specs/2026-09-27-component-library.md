# Repro Vaporwave GUI - Component Library & Animation Spec

**Date:** 2026-09-27  
**Purpose:** Detailed specification of all UI components, animation timings, and interaction states for the vaporwave Repro GUI.

---

## 1. Animation Timing System

### Base Timing Values (Global Standards)
```
Fast:    200ms  (hover states, micro-interactions)
Normal:  400ms  (most transitions)
Slow:    600ms  (major page transitions)
Glacial: 1200ms (dramatic reveals)

Easing Functions:
- Entrance:  cubic-bezier(0.34, 1.56, 0.64, 1)   // Bounce/spring
- Exit:      cubic-bezier(0.25, 0.46, 0.45, 0.94) // Smooth ease-out
- Looping:   ease-in-out (for infinite animations)
- Text:      steps() (for typewriter effects)
```

---

## 2. Core Components

### 2.1 Main Dashboard Container

**Entrance Animation:**
```css
animation: slideIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);

@keyframes slideIn {
  0%: translateY(-50px) scale(0.95), opacity 0
  100%: translateY(0) scale(1), opacity 1
}
```

**Border & Shadow:**
```
Border: 6px solid #000
Box-shadow: 15px 15px 0 rgba(0,0,0,0.4), 
            inset 0 0 20px rgba(0,0,0,0.05)
```

**Header Styling:**
- Background: solid black
- Text color: #00FF00 with text-shadow: 0 0 10px #00FF00
- Font: Press Start 2P, 12px, uppercase, letter-spacing +2px
- Animation: typeWriter 1.2s steps(12)

---

### 2.2 Run Card Component

#### Structure:
```
┌─ Animated top bar (gradient) ─────────────────┐
│ [Header: RUN #N]                              │
│ [Meta: ID | Status Badge]                     │
│ [Meta: Target | Current Stage]                │
│ [Progress Bar + Shimmer]                      │
│ [Stats Grid: 2x2]                             │
│ [Stage Pipeline: 5 stages]                    │
└───────────────────────────────────────────────┘
```

#### Animations:

**Entrance (Staggered):**
```
animation: fadeInUp 0.6s ease-out backwards;
animation-delay: calc(0.1s * var(--card-index));

@keyframes fadeInUp {
  0%: translateY(30px), opacity 0
  100%: translateY(0), opacity 1
}
```

**Top Bar (Always Playing):**
```
animation: slideBar 3s ease-in-out infinite;

@keyframes slideBar {
  0%, 100%: translateX(-100%)
  50%: translateX(100%)
}
```

**Hover State:**
```
Border color: #00FFFF
Box-shadow: 
  0 0 20px #00FFFF,
  inset 0 0 15px rgba(0,255,255,0.1),
  8px 8px 0 rgba(0,255,255,0.3)
Transform: translateY(-8px) scale(1.02)
Transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)
```

**Active Card (Currently Running):**
```
Border color: #00FF00
Border width: 6px
Box-shadow: 0 0 20px #00FF00
Top bar animation speed: 1.5s (faster)
```

**Click State:**
```
Transform: translateY(-2px)
Duration: 0.1s
Effect: Reduced box-shadow, slight depression
```

---

### 2.3 Progress Bar

**Structure:**
- Outer container: 14px height, 2px black border
- Fill: linear-gradient(90deg, #00FFFF, #00FF00)
- Shimmer overlay: Moving light effect

**Animations:**

**Fill Expansion:**
```
animation: expandWidth 2.5s ease-out forwards;

@keyframes expandWidth {
  0%: width 0%
  100%: width var(--progress)
}
```

**Shimmer Effect (On top of fill):**
```
animation: shimmer 2s infinite;

@keyframes shimmer {
  0%: translateX(-100%)
  100%: translateX(100%)
}
Overlay: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)
```

**Box Shadow:**
```
box-shadow: 0 0 12px #00FFFF;
Glow intensity pulses subtly with pulse animation
```

---

### 2.4 Statistics Grid (2x2 per Card)

**Cell Structure:**
```
┌─────────────────┐
│ Label (8px)     │
│ Value (18px)    │ ← Cyan, bold, glowing
└─────────────────┘
```

**Styling:**
- Border: 2px solid #ddd
- Background: linear-gradient(135deg, #fafafa, #fff)
- Padding: 12px

**Animations:**

**Entrance:**
```
animation: countUp 1.5s ease-out;

@keyframes countUp {
  0%: opacity 0, translateY(10px), color #FF1493
  100%: opacity 1, translateY(0), color #00FFFF
}
```

**Hover State:**
```
Border color: #00FFFF
Box-shadow: 0 0 8px rgba(0,255,255,0.2)
Transition: all 0.3s ease
```

**Number Animation:**
- Font size: 18px, bold, monospace
- Color: #00FFFF with text-shadow: 0 0 5px rgba(0,255,255,0.5)
- Numbers count from 0 to final value (not instant)

---

### 2.5 Stage Pipeline

**Structure (5 stages):**
```
[Ingest] [Detect] [Diagnose] [Repair] [Verify]
```

**Stage States:**

**Completed:**
```
Background: #00FF00
Color: #000
Border: 2px solid #000
Box-shadow: 0 0 8px #00FF00
```

**Active (Current):**
```
Background: #00FFFF
Color: #000
Border: 2px solid #000
Animation: pulse 1.2s ease-in-out infinite
Box-shadow: 0 0 15px #00FFFF
```

**Pending:**
```
Background: #eee
Color: #333
Border: 2px solid #ddd
```

**Shimmer on Active:**
```
::before element with radial-gradient shine effect
Animates across the active stage
```

---

### 2.6 Status Badge

**Styling:**
```
Display: Inline-block
Padding: 4px 10px
Background: #000
Border: 2px solid (color varies)
Font: 9px, bold, uppercase, letter-spacing +1px
```

**States:**

**Running:**
```
Color: #00FFFF
Border color: #00FFFF
Animation: pulse 1s infinite
Box-shadow: 0 0 10px #00FFFF
```

**Completed:**
```
Color: #00FF00
Border color: #00FF00
Box-shadow: 0 0 10px #00FF00
```

**Entrance:**
```
animation: pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);

@keyframes pop {
  0%: scale(0.8), opacity 0
  50%: scale(1.1)
  100%: scale(1), opacity 1
}
```

---

## 3. Floating Widgets

### 3.1 Clock Widget

**Position:** Top-right (25px from edges)  
**Size:** 220px wide  
**Border:** 4px solid #000  
**Background:** linear-gradient(135deg, #fff, #fafafa)

**Components:**
- Title: Press Start 2P, 8px, uppercase
- Date: 9px, letter-spacing +0.5px
- Time: 24px, JetBrains Mono, bold, cyan, glowing

**Animations:**

**Float:**
```
animation: float 10s ease-in-out infinite;

@keyframes float {
  0%, 100%: translateY(0) rotate(0deg)
  50%: translateY(-12px) rotate(0.5deg)
}
```

**Time Display Pulse:**
```
animation: pulse 2s infinite;
Color glow effect that intensifies and fades
```

---

### 3.2 Statistics Widget

**Position:** Top-left (25px from edges)  
**Size:** 200px wide  
**Title:** With optional glitch effect

**Content:**
- Active runs
- Completed runs
- Total fixed
- Success rate

**Row Animation:**
```
Hover state:
  Color: #00FFFF
  Border-bottom: 1px solid #00FFFF
  Transition: all 0.3s ease
```

---

## 4. Modal Components

### 4.1 Modal Overlay

**Styling:**
```
Background: rgba(0, 0, 0, 0.7)
Backdrop-filter: blur(2px)
Z-index: 100
```

**Entrance:**
```
animation: fadeIn 0.3s ease;

@keyframes fadeIn {
  0%: opacity 0
  100%: opacity 1
}
```

---

### 4.2 Modal Content

**Structure:**
```
┌─ Gradient top bar ──────────────────────┐
│ Title (Press Start 2P, 16px)            │
├─────────────────────────────────────────┤
│ Description text (11px)                 │
│ [Input field]                           │
│ [Cancel] [Scan Button]                  │
└─────────────────────────────────────────┘
```

**Styling:**
```
Border: 6px solid #000
Box-shadow: 20px 20px 0 rgba(0,0,0,0.4),
            0 0 30px rgba(0,255,255,0.3)
Padding: 35px
Max-width: 550px
```

**Entrance:**
```
animation: slideInModal 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);

@keyframes slideInModal {
  0%: translateY(-60px) scale(0.85) rotateX(-10deg), opacity 0
  100%: translateY(0) scale(1) rotateX(0), opacity 1
}
```

**Top Gradient Bar:**
```
Height: 4px
Background: linear-gradient(90deg, #00FFFF, #00FF00, #FF1493)
animation: slideBar 2s ease-in-out infinite
```

---

### 4.3 Input Fields

**Styling:**
```
Width: 100%
Padding: 14px
Border: 3px solid #000
Font: JetBrains Mono, 12px, letter-spacing +0.5px
Background: #fafafa
Margin: 18px 0
```

**Focus State:**
```
Outline: none
Border color: #00FFFF
Box-shadow: 0 0 15px #00FFFF,
            inset 0 0 10px rgba(0,255,255,0.1)
Background: #fff
Transition: all 0.3s ease
```

**Placeholder:**
```
Color: #bbb
```

---

### 4.4 Buttons

**Base Button:**
```
Padding: 12px 24px
Border: 3px solid #000
Font: JetBrains Mono, 11px, bold, uppercase, letter-spacing +1px
Transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)
Position: relative
Overflow: hidden
```

**Default Button:**
```
Background: #000
Color: #fff
Hover: 
  Background: #fff
  Color: #000
  Box-shadow: 0 0 20px rgba(0,0,0,0.5)
  Transform: translateY(-2px)
```

**Primary Button:**
```
Background: #00FF00
Color: #000
Border-color: #000
Hover:
  Background: #00FFFF
  Border-color: #00FFFF
  Box-shadow: 0 0 20px rgba(0,255,255,0.5)
  Transform: translateY(-2px)
```

---

## 5. Glitch Effects

### 5.1 Text Glitch Animation

**Used on:** Widget titles, accent text

```css
.glitch {
  position: relative;
  color: #000;
}

.glitch::before,
.glitch::after {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.glitch::before {
  animation: glitch 0.3s ease infinite;
  color: #00FF00;
  z-index: -1;
  text-shadow: -2px 0 #00FFFF;
}

.glitch::after {
  animation: glitch 0.3s ease infinite reverse;
  color: #FF1493;
  z-index: -2;
  text-shadow: 2px 0 #00FFFF;
}

@keyframes glitch {
  0%:   clip-path: inset(40% 0 61% 0), transform: translate(-2px, -2px)
  20%:  clip-path: inset(92% 0 1% 0), transform: translate(2px, 2px)
  40%:  clip-path: inset(43% 0 1% 0), transform: translate(-2px, 2px)
  60%:  clip-path: inset(25% 0 58% 0), transform: translate(2px, -2px)
  80%:  clip-path: inset(54% 0 7% 0), transform: translate(-2px, -2px)
  100%: clip-path: inset(58% 0 43% 0), transform: translate(2px, 2px)
}
```

**Intensity:** Subtle, should feel intentional (retro 80s computer glitch)  
**Frequency:** Occasional accent elements only

---

## 6. Particle System

### 6.1 Success Sparkles

**When Triggered:**
- Patch verified
- Run completed
- Milestone reached

**Effect:**
```
5-10 particles burst from the triggering element
Particles: Small circles or stars
Colors: #00FFFF, #00FF00, #FF1493 (random)
Duration: 600ms per particle
Path: Radial expansion with gravity
Opacity fade from 1 to 0
```

**Implementation:**
```javascript
function createSparkle(x, y) {
  const particle = document.createElement('div');
  particle.className = 'particle';
  const angle = Math.random() * Math.PI * 2;
  const velocity = 4 + Math.random() * 4;
  
  particle.style.left = x + 'px';
  particle.style.top = y + 'px';
  particle.style.animation = `explode 0.6s ease-out forwards`;
  particle.style.setProperty('--angle', angle);
  particle.style.setProperty('--velocity', velocity);
}
```

---

## 7. Color Animations

### 7.1 Pulsing Glow

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Applied to active elements */
animation: pulse 1s infinite;
```

### 7.2 Color Shift (Cyan ↔ Green)

```css
@keyframes colorShift {
  0%, 100% { color: #00FFFF; text-shadow: 0 0 10px #00FFFF; }
  50% { color: #00FF00; text-shadow: 0 0 10px #00FF00; }
}

animation: colorShift 2s ease-in-out infinite;
```

---

## 8. Responsive Breakpoints

### Mobile (< 768px)
- Single column cards
- Hide clock and stats widgets
- Reduce font sizes by 10%
- Modal takes full width (90%)
- Reduce padding/gaps by 20%

### Tablet (768px - 1024px)
- 1-column or 2-column card grid (depending on content)
- Keep widgets visible
- Adjust dashboard height (80vh instead of 85vh)
- Slightly reduced padding

### Desktop (1024px+)
- Full responsive grid layout
- All widgets visible
- Full animations and effects
- Optimized spacing

---

## 9. Performance Optimization

### GPU Acceleration
```css
/* Apply to animated elements */
transform: translateZ(0);
will-change: transform;
/* Remove after animation ends */
```

### Particle Limits
- Max 20 active particles at once
- Clean up DOM nodes after animation completes
- Throttle new particle creation

### Animation Frame Rate
- Target 60fps
- Reduce particle count on low-end devices
- Disable non-essential animations if frame rate drops below 30fps

---

## 10. Accessibility Considerations

### Color Contrast
- All text meets WCAG AA standards (4.5:1 minimum)
- Primary text: Black on light backgrounds
- Status indicators: Color + text label (not just color)

### Motion Sensitivity
- Respect `prefers-reduced-motion` media query
- Provide static fallback for essential animations
- Never use rapidly flashing animations (> 3 flashes per second)

### Keyboard Navigation
- All interactive elements focusable
- Tab order: logical flow (left → right, top → bottom)
- Focus indicators: Visible cyan border
- Keyboard shortcuts (N = new scan, ESC = close modal)

### Screen Readers
- Semantic HTML elements
- ARIA labels on dynamic content
- Live regions for real-time updates
- Form labels properly associated with inputs

---

## 11. Browser Support & Fallbacks

### Required Features
- CSS Grid
- CSS Custom Properties (--variables)
- CSS Animations
- CSS Transforms
- Canvas API (for Game of Life)

### Graceful Degradation
- Static layout if Grid not supported
- Solid colors if gradients not supported
- Game of Life disabled on low-end devices
- Animations converted to instant transitions if `prefers-reduced-motion` enabled

---

## 12. Implementation Checklist

- [ ] Finalize color palette (CSS variables)
- [ ] Create base animation library (keyframes)
- [ ] Build component system (React components)
- [ ] Implement Game of Life canvas
- [ ] Wire up real-time data updates
- [ ] Test animations on 60fps
- [ ] Add keyboard shortcuts
- [ ] Implement responsive layouts
- [ ] Test accessibility (WCAG AA)
- [ ] Performance optimization pass
- [ ] Cross-browser testing

---

**Next:** Build React component library and implement animations in actual codebase.
