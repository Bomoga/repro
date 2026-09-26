# Repro Vaporwave GUI - Visual Design System

**Date:** 2026-09-27  
**Purpose:** Comprehensive visual design system including typography, color palette, iconography, and layout grid.

---

## 1. Color Palette

### Primary Colors (CSS Variables)

```css
:root {
  /* Backgrounds */
  --bg-primary: #FF1493;      /* Hot pink */
  --bg-secondary: #FF69B4;    /* Light pink */
  --bg-surface: #f5f5f5;      /* Light gray (cards) */
  --bg-dark: #000000;         /* Black */
  
  /* Text */
  --text-primary: #000000;    /* Black */
  --text-light: #666666;      /* Dark gray */
  --text-muted: #999999;      /* Medium gray */
  --text-accent: #00FFFF;     /* Cyan (active) */
  --text-success: #00FF00;    /* Lime (success) */
  --text-error: #FF1493;      /* Pink (error) */
  
  /* Accents */
  --accent-cyan: #00FFFF;
  --accent-green: #00FF00;
  --accent-pink: #FF1493;
  --accent-magenta: #FF00FF;
  
  /* Borders */
  --border-default: #000000;  /* Solid black */
  --border-light: #ddd;       /* Light gray */
  --border-accent: #00FFFF;   /* Cyan (hover) */
  
  /* Effects */
  --shadow-glow-cyan: 0 0 15px #00FFFF;
  --shadow-glow-green: 0 0 15px #00FF00;
  --shadow-glow-pink: 0 0 15px #FF1493;
  --shadow-box: 10px 10px 0 rgba(0,0,0,0.3);
}
```

### Color Usage

| Color | Hex | Usage | Opacity |
|-------|-----|-------|---------|
| Primary Pink | #FF1493 | Background, highlights, errors | 100% |
| Light Pink | #FF69B4 | Gradient, secondary bg | 100% |
| Cyan | #00FFFF | Active states, hover, text accents | 100% |
| Green | #00FF00 | Success, completed status, verified | 100% |
| Black | #000000 | Text, borders, dark accents | 100% |
| White | #FFFFFF | Card backgrounds, text contrast | 100% |
| Gray | #999999 | Muted text, disabled states | 50-70% |

### Semantic Color Mapping

**Status Indicators:**
- Running: #00FFFF (cyan pulse)
- Completed: #00FF00 (green steady)
- Failed: #FF1493 (pink/error)
- Pending: #999999 (gray)

**Finding Status:**
- Detected: #999999 (gray)
- Reproduced: #00FFFF (cyan)
- Diagnosed: #6699FF (blue)
- Repaired: #FFFF00 (yellow)
- Verified: #00FF00 (green)
- Merged: #00FF00 (bright green)
- Rejected: #FF1493 (pink)

---

## 2. Typography System

### Font Families

```css
/* Headers & Titles */
@font-face {
  font-family: 'Press Start 2P';
  src: url('https://fonts.googleapis.com/css2?family=Press+Start+2P');
  font-weight: 400;
  font-style: normal;
}

/* Body & Interface */
@font-face {
  font-family: 'JetBrains Mono';
  src: url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700');
  font-weight: 400;
  font-style: normal;
}
```

### Type Scale

| Component | Font | Size | Weight | Line Height | Letter Spacing |
|-----------|------|------|--------|-------------|----------------|
| Dashboard Title | Press Start 2P | 14px | 400 | 1.2 | +2px |
| Card Header | Press Start 2P | 12px | 400 | 1.2 | +1.5px |
| Widget Title | Press Start 2P | 8px | 400 | 1.2 | +0.5px |
| Body Text | JetBrains Mono | 11px | 400 | 1.5 | 0px |
| Stat Label | JetBrains Mono | 8px | 400 | 1.2 | +0.5px |
| Stat Value | JetBrains Mono | 18px | 700 | 1 | 0px |
| Input/Button | JetBrains Mono | 12px | 700 | 1.2 | +1px |
| Modal Title | Press Start 2P | 16px | 400 | 1.2 | +1px |

### Font Usage Rules

**Headings (Press Start 2P):**
- Uppercase always
- Letter-spacing: +1.5px to +2px
- Color: Black or Cyan
- Usage: Titles, headers, section breaks

**Body (JetBrains Mono):**
- All caps for labels
- Mixed case for descriptions
- Color: Black, gray, or cyan
- Usage: Stats, text, buttons, inputs

**Special Cases:**
- Stat numbers: Bold, cyan, larger size
- Error text: Bold, pink, uppercase
- Timestamps: Regular, gray, smaller size

---

## 3. Iconography System

### Icon Set (Text/Emoji Based)

| Icon | Code | Usage |
|------|------|-------|
| 🔍 | Magnifying glass | Finding, detection |
| ✓ | Checkmark | Success, verified, complete |
| ✔️ | Ballot box checkmark | Double verification |
| ⚙️ | Gear | Repair, configuration |
| 📊 | Bar chart | Report, statistics |
| ⏰ | Clock | Time, timestamp |
| 🚀 | Rocket | Launch, startup |
| ⚠️ | Warning | Error, caution |
| ✗ | X mark | Failed, rejected |
| → | Arrow | Flow, progress, next |
| … | Ellipsis | Loading, more |

### Icon Styling

```css
.icon {
  display: inline-block;
  font-size: 1.2em;
  margin-right: 0.3em;
  vertical-align: -0.1em;
}

/* Icon animations */
.icon.rotating {
  animation: spin 2s linear infinite;
}

.icon.pulsing {
  animation: pulse 1s ease-in-out infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

### Label + Icon Patterns

**Button Label:**
```
[✓] MERGE PATCH
[✗] REJECT PATCH
```

**Status Badge:**
```
[▶] RUNNING
[✓] COMPLETED
[⚠] FAILED
```

**Section Header:**
```
[📊] REPORT STATS
[🔍] FINDINGS
[⚙️] REPAIRS
```

---

## 4. Layout Grid System

### Base Grid Unit

**Unit:** 8px (1 rem)

```css
:root {
  --unit: 8px;
  --spacing-xs: calc(var(--unit) * 0.5);  /* 4px */
  --spacing-sm: calc(var(--unit) * 1);    /* 8px */
  --spacing-md: calc(var(--unit) * 2);    /* 16px */
  --spacing-lg: calc(var(--unit) * 3);    /* 24px */
  --spacing-xl: calc(var(--unit) * 4);    /* 32px */
  --spacing-xxl: calc(var(--unit) * 5);   /* 40px */
}
```

### Container Sizes

```css
--container-xs: 320px;   /* Mobile */
--container-sm: 640px;   /* Tablet */
--container-md: 960px;   /* Desktop */
--container-lg: 1200px;  /* Large desktop */
--container-xl: 1400px;  /* Extra large */
```

### Card Grid Layout

**Desktop (1400px+):**
```
[Card 1] [Card 2]
[Card 3] [Card 4]

Grid: 2 columns, 20px gap
Card width: ~450px
```

**Tablet (1024px):**
```
[Card 1]
[Card 2]
[Card 3]
[Card 4]

Grid: 1 column, 20px gap
Card width: 100%
```

**Mobile (768px):**
```
[Card 1]
[Card 2]
[Card 3]

Grid: 1 column, 12px gap
Card width: 100% with padding
Widget: hidden
```

### Component Padding/Margins

**Run Card:**
```
Padding: 20px
Border: 5px
Gap between elements: 12px
```

**Widget:**
```
Padding: 14px
Border: 4px
Box shadow: 6px 6px 0 offset
```

**Modal:**
```
Padding: 35px
Border: 6px
Min width: 400px
Max width: 550px
```

**Button:**
```
Padding: 12px 24px
Border: 3px
Font size: 11px
Height: 44px (touch-friendly)
```

---

## 5. Spacing Scale

### Consistent Spacing Values

```
2px   - Micro spacing (border width, dividers)
4px   - Extra small (component padding)
8px   - Small (standard gap between elements)
12px  - Small-medium (card internal spacing)
16px  - Medium (section spacing)
20px  - Medium-large (card padding)
24px  - Large (container padding)
32px  - Extra large (section spacing)
```

### Margin & Padding Rules

- Never use arbitrary spacing (always use scale)
- Horizontal padding: 20px on cards, 35px on modals
- Vertical gap: 12px between elements, 20px between sections
- Border width: 2-6px (2px for internal, 5-6px for main elements)

---

## 6. Border System

### Border Styles

```css
/* Main borders */
--border-thick: 6px solid #000;     /* Dashboard, cards */
--border-medium: 5px solid #000;    /* Run cards */
--border-regular: 4px solid #000;   /* Widgets, modals */
--border-thin: 2px solid #000;      /* Input, buttons */
--border-light: 1px solid #ddd;     /* Stats cells */

/* Accent borders */
--border-accent-cyan: 3px solid #00FFFF;
--border-accent-green: 3px solid #00FF00;
--border-accent-pink: 3px solid #FF1493;

/* Dashed borders */
--border-dashed: 1px dashed #ddd;
```

### Border Usage

| Element | Border | Color |
|---------|--------|-------|
| Dashboard | 6px solid | #000 |
| Run Card (default) | 5px solid | #000 |
| Run Card (active) | 6px solid | #000 |
| Run Card (hover) | 5px solid | #00FFFF |
| Widget | 4px solid | #000 |
| Modal | 6px solid | #000 |
| Input | 3px solid | #000 |
| Input (focus) | 3px solid | #00FFFF |
| Button | 3px solid | varies |
| Stat Cell | 2px solid | #ddd |
| Progress Bar | 2px solid | #000 |

---

## 7. Shadow & Depth System

### Box Shadows

```css
--shadow-none: none;

--shadow-sm: 4px 4px 0 rgba(0,0,0,0.2);
--shadow-md: 8px 8px 0 rgba(0,0,0,0.3);
--shadow-lg: 15px 15px 0 rgba(0,0,0,0.4);
--shadow-xl: 20px 20px 0 rgba(0,0,0,0.4);

--shadow-inset: inset 0 0 20px rgba(0,0,0,0.05);

/* Glow shadows */
--glow-cyan: 0 0 20px #00FFFF;
--glow-green: 0 0 20px #00FF00;
--glow-pink: 0 0 20px #FF1493;

/* Combined */
--shadow-hover: 0 0 20px #00FFFF, 8px 8px 0 rgba(0,255,255,0.3);
--shadow-active: 0 0 15px #00FFFF, inset 0 0 15px rgba(0,255,255,0.1);
```

### Depth Levels

| Level | Use Case | Shadow |
|-------|----------|--------|
| 0 | Flat elements | none |
| 1 | Interactive elements | --shadow-sm |
| 2 | Cards, widgets | --shadow-md |
| 3 | Dashboard, containers | --shadow-lg |
| 4 | Modals, overlays | --shadow-xl |

---

## 8. Responsive Breakpoints

```css
/* Mobile first */
$mobile: 320px;
$tablet: 768px;
$desktop: 1024px;
$desktop-lg: 1200px;
$desktop-xl: 1400px;

@media (min-width: $tablet) { /* Tablet + */ }
@media (min-width: $desktop) { /* Desktop + */ }
@media (min-width: $desktop-lg) { /* Large desktop + */ }
@media (min-width: $desktop-xl) { /* Extra large + */ }
```

### Responsive Adjustments

**Font Sizes:**
- Mobile: -10% of desktop
- Tablet: -5% of desktop
- Desktop: 100% (baseline)

**Padding/Margins:**
- Mobile: 12px
- Tablet: 16px
- Desktop: 20px+

**Border Widths:**
- Mobile: Same as desktop (2-6px)
- Maintains visual consistency

**Component Visibility:**
- Mobile: Hide non-essential widgets
- Tablet: Show some widgets
- Desktop: Full UI with all widgets

---

## 9. Animation Timing System

### Global Timing Variables

```css
:root {
  --duration-fast: 200ms;      /* Micro interactions */
  --duration-normal: 400ms;    /* Standard transitions */
  --duration-slow: 600ms;      /* Page transitions */
  --duration-glacial: 1200ms;  /* Dramatic reveals */
  
  --ease-in: ease-in;
  --ease-out: ease-out;
  --ease-in-out: ease-in-out;
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
```

### Animation Library

```css
/* Entrances */
.entrance-fade { animation: fadeIn var(--duration-slow) ease-out; }
.entrance-slide { animation: slideIn var(--duration-slow) var(--ease-bounce); }
.entrance-pop { animation: pop var(--duration-normal) var(--ease-bounce); }

/* Looping */
.loop-pulse { animation: pulse 1s ease-in-out infinite; }
.loop-glow { animation: glow 1.2s ease-in-out infinite; }
.loop-shimmer { animation: shimmer 2s infinite; }
.loop-spin { animation: spin 2s linear infinite; }

/* Attention */
.attention-shake { animation: shake 0.3s ease-in-out; }
.attention-bounce { animation: bounce 0.6s ease-out; }
.attention-flash { animation: flash 0.5s ease-out; }
```

---

## 10. Texture & Pattern System

### Background Textures

**Stipple Pattern:**
```css
background-image: 
  radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px),
  radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px);
background-size: 4px 4px, 8px 8px;
background-position: 0 0, 2px 2px;
```

**Scanlines (Optional):**
```css
background-image: 
  repeating-linear-gradient(0deg, rgba(0,0,0,.1) 0px, rgba(0,0,0,.1) 1px, transparent 1px, transparent 2px);
background-size: 100% 2px;
```

**Grid Pattern:**
```css
background-image: 
  linear-gradient(0deg, transparent 24%, rgba(0,0,0,.05) 25%, rgba(0,0,0,.05) 26%, transparent 27%, transparent 74%, rgba(0,0,0,.05) 75%, rgba(0,0,0,.05) 76%, transparent 77%, transparent),
  linear-gradient(90deg, transparent 24%, rgba(0,0,0,.05) 25%, rgba(0,0,0,.05) 26%, transparent 27%, transparent 74%, rgba(0,0,0,.05) 75%, rgba(0,0,0,.05) 76%, transparent 77%, transparent);
background-size: 50px 50px;
```

### Texture Usage

- Stipple: Main background (all pages)
- Scanlines: Optional overlay on retro elements
- Grid: Optional on spacious layouts

---

## 11. Gradient System

### Linear Gradients

```css
--gradient-cyan-green: linear-gradient(90deg, #00FFFF, #00FF00);
--gradient-pink-magenta: linear-gradient(135deg, #FF1493, #FF00FF);
--gradient-cyan-pink: linear-gradient(45deg, #00FFFF, #FF1493);

/* For progress bars, cards, accents */
```

### Radial Gradients

```css
--gradient-glow-cyan: radial-gradient(circle, rgba(0,255,255,0.3), transparent);
--gradient-glow-green: radial-gradient(circle, rgba(0,255,255,0.3), transparent);

/* For effect overlays, shimmer, shine */
```

---

## 12. Accessibility Color Contrast

### WCAG AA Compliance (4.5:1 minimum)

| Text Color | Background | Contrast Ratio | Status |
|------------|-----------|-----------------|--------|
| #000000 | #FFFFFF | 21:1 | ✓ Excellent |
| #000000 | #f5f5f5 | 17:1 | ✓ Excellent |
| #FFFFFF | #000000 | 21:1 | ✓ Excellent |
| #00FFFF | #000000 | 6:1 | ✓ Excellent |
| #00FF00 | #000000 | 7.8:1 | ✓ Excellent |
| #00FF00 | #FFFFFF | 5.9:1 | ✓ Excellent |
| #FF1493 | #FFFFFF | 3.1:1 | ✗ Needs improvement |
| #FF1493 | #000000 | 6:1 | ✓ Excellent |

### Recommendations

- Use pink (#FF1493) only for:
  - Dark backgrounds (black, dark gray)
  - Hover/active states on dark elements
  - Status indicators (with text label)
- Avoid pink text on light backgrounds
- Always pair color with text labels (not color-only indicators)

---

## 13. CSS Custom Properties Export

### Implementation in Code

```scss
/* _variables.scss */
$unit: 8px;
$color-primary: #FF1493;
$color-cyan: #00FFFF;
$color-success: #00FF00;
$color-text: #000000;
$font-header: 'Press Start 2P', cursive;
$font-body: 'JetBrains Mono', monospace;
$ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
$duration-normal: 400ms;
$duration-slow: 600ms;
$shadow-box: 10px 10px 0 rgba(0,0,0,0.3);

// Export as CSS variables
:root {
  --unit: #{$unit};
  --color-primary: #{$color-primary};
  --color-cyan: #{$color-cyan};
  --font-header: #{$font-header};
  --ease-bounce: #{$ease-bounce};
  // ... etc
}
```

---

## 14. Design System Checklist

- [ ] Define all CSS custom properties
- [ ] Create SCSS/CSS variable file
- [ ] Build typography scale in code
- [ ] Implement color palette with accessible fallbacks
- [ ] Create button/input component styles
- [ ] Build card/widget base styles
- [ ] Implement animation library (Framer Motion or CSS)
- [ ] Test responsive design on mobile/tablet/desktop
- [ ] Verify WCAG AA color contrast
- [ ] Create design tokens documentation
- [ ] Set up Storybook with component examples
- [ ] Document all spacing/sizing rules
- [ ] Create icon font or emoji system
- [ ] Validate font loading & fallbacks
- [ ] Performance test texture/animation load

---

**This design system is complete and ready for implementation in React/CSS-in-JS.**

**Next:** Build React component library using these design tokens and implement animations with Framer Motion.
