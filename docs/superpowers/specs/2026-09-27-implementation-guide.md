# Repro Vaporwave GUI - Implementation Guide

**Date:** 2026-09-27  
**Audience:** Frontend developers building the React components  
**Goal:** Turn design specs into production-ready code

---

## 1. Project Setup

### Required Dependencies

```bash
npm install react framer-motion axios zustand
npm install -D tailwindcss postcss autoprefixer sass
npm install google-fonts-webpack-plugin
```

### Directory Structure

```
packages/web/src/
├── components/
│   ├── Dashboard/
│   │   ├── Dashboard.tsx
│   │   ├── RunCard.tsx
│   │   ├── RunCardStack.tsx
│   │   └── index.ts
│   ├── Modal/
│   │   ├── ScanModal.tsx
│   │   ├── RunDetailModal.tsx
│   │   └── index.ts
│   ├── Widgets/
│   │   ├── ClockWidget.tsx
│   │   ├── StatsWidget.tsx
│   │   └── index.ts
│   ├── Common/
│   │   ├── ProgressBar.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── StagePipeline.tsx
│   │   ├── StatGrid.tsx
│   │   └── index.ts
│   └── Layout/
│       ├── GameOfLife.tsx
│       ├── Container.tsx
│       └── index.ts
├── styles/
│   ├── variables.css
│   ├── animations.css
│   ├── components.css
│   └── global.css
├── hooks/
│   ├── useRunData.ts
│   ├── useModalState.ts
│   ├── useAnimationTiming.ts
│   └── useResponsive.ts
├── store/
│   ├── runStore.ts
│   ├── modalStore.ts
│   └── index.ts
└── App.tsx
```

---

## 2. Component Implementation Order

### Phase 1: Foundation (Week 1)
```
1. Create design token file (CSS variables)
2. Build Layout wrapper component
3. Build GameOfLife canvas component
4. Create global animations (CSS)
5. Set up Zustand stores
```

### Phase 2: Core Components (Week 2)
```
1. RunCard component
2. ProgressBar component
3. StatusBadge component
4. StagePipeline component
5. StatGrid component
6. Dashboard container
```

### Phase 3: Widgets & Modals (Week 3)
```
1. ClockWidget component
2. StatsWidget component
3. ScanModal component
4. RunDetailModal component
5. Modal wrapper & overlay
```

### Phase 4: Integration & Polish (Week 4)
```
1. Connect API data to components
2. Implement real-time polling
3. Add keyboard shortcuts
4. Responsive design refinement
5. Performance optimization
6. Accessibility testing
```

---

## 3. Key Implementation Patterns

### 3.1 Design Tokens (CSS Variables)

**File: `styles/variables.css`**

```css
:root {
  /* Colors */
  --color-bg-primary: #FF1493;
  --color-bg-secondary: #FF69B4;
  --color-surface: #f5f5f5;
  --color-text: #000000;
  --color-accent-cyan: #00FFFF;
  --color-accent-green: #00FF00;
  --color-error: #FF1493;
  
  /* Spacing */
  --unit: 8px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  
  /* Typography */
  --font-header: 'Press Start 2P', cursive;
  --font-body: 'JetBrains Mono', monospace;
  --font-size-xs: 8px;
  --font-size-sm: 10px;
  --font-size-base: 11px;
  --font-size-lg: 14px;
  --font-size-xl: 18px;
  
  /* Timing & Easing */
  --duration-fast: 200ms;
  --duration-normal: 400ms;
  --duration-slow: 600ms;
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  
  /* Shadows */
  --shadow-md: 8px 8px 0 rgba(0,0,0,0.3);
  --shadow-lg: 15px 15px 0 rgba(0,0,0,0.4);
  --glow-cyan: 0 0 20px #00FFFF;
  --glow-green: 0 0 20px #00FF00;
}
```

### 3.2 Framer Motion Animations

**File: `styles/animations.ts` (JavaScript export)**

```typescript
import { Variants } from 'framer-motion';

export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: 0.6, ease: 'easeOut' }
};

export const slideInModal: Variants = {
  initial: { opacity: 0, y: -60, scale: 0.85 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 60, scale: 0.85 },
  transition: { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }
};

export const pulse: Variants = {
  animate: {
    opacity: [1, 0.6, 1],
    transition: { duration: 1, repeat: Infinity }
  }
};

export const glow: Variants = {
  animate: {
    boxShadow: [
      '0 0 10px #00FFFF',
      '0 0 20px #00FFFF',
      '0 0 10px #00FFFF'
    ],
    transition: { duration: 1.2, repeat: Infinity }
  }
};
```

### 3.3 Zustand Store Pattern

**File: `store/runStore.ts`**

```typescript
import create from 'zustand';
import type { Run } from '@repro/contracts';

interface RunState {
  runs: Run[];
  selectedRunId: string | null;
  loading: boolean;
  error: string | null;
  
  setRuns: (runs: Run[]) => void;
  selectRun: (id: string) => void;
  updateRun: (id: string, updates: Partial<Run>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useRunStore = create<RunState>((set) => ({
  runs: [],
  selectedRunId: null,
  loading: false,
  error: null,
  
  setRuns: (runs) => set({ runs }),
  selectRun: (id) => set({ selectedRunId: id }),
  updateRun: (id, updates) =>
    set((state) => ({
      runs: state.runs.map((run) =>
        run.id === id ? { ...run, ...updates } : run
      ),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
```

### 3.4 Custom Hook Pattern

**File: `hooks/useRunData.ts`**

```typescript
import { useEffect } from 'react';
import { useRunStore } from '../store/runStore';
import { api } from '../api';

export function useRunData(pollInterval = 5000) {
  const { setRuns, setLoading, setError } = useRunStore();

  useEffect(() => {
    let mounted = true;
    const timer = setInterval(async () => {
      if (!mounted) return;
      
      try {
        setLoading(true);
        const runs = await api.listRuns();
        if (mounted) {
          setRuns(runs);
          setError(null);
        }
      } catch (error) {
        if (mounted) {
          setError(error instanceof Error ? error.message : 'Unknown error');
        }
      } finally {
        setLoading(false);
      }
    }, pollInterval);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [pollInterval, setRuns, setLoading, setError]);
}
```

### 3.5 Component Template

**File: `components/RunCard.tsx`**

```typescript
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Run } from '@repro/contracts';
import { fadeInUp } from '../styles/animations';
import { ProgressBar } from './Common/ProgressBar';
import { StatusBadge } from './Common/StatusBadge';
import { StagePipeline } from './Common/StagePipeline';
import { StatGrid } from './Common/StatGrid';
import './RunCard.css';

interface RunCardProps {
  run: Run;
  index: number;
  isActive: boolean;
  onSelect: (runId: string) => void;
}

export function RunCard({ run, index, isActive, onSelect }: RunCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      className={`run-card ${isActive ? 'active' : ''} ${isHovered ? 'hovered' : ''}`}
      variants={fadeInUp}
      initial="initial"
      animate="animate"
      transition={{ delay: index * 0.1 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(run.id)}
    >
      {/* Top gradient bar */}
      <div className="run-card-top-bar" />

      {/* Header */}
      <div className="run-card-header">RUN #{index + 1}</div>

      {/* Meta info */}
      <div className="run-card-meta">
        <span>ID: {run.id.slice(0, 8)}</span>
        <StatusBadge status={run.status} />
      </div>

      {/* Target and stage */}
      <div className="run-card-meta">
        <span>Target: {run.target.ref}</span>
        <span style={{ color: '#00FFFF' }}>⚙️ {run.stage.toUpperCase()}</span>
      </div>

      {/* Progress bar (only for running) */}
      {run.status === 'running' && (
        <ProgressBar progress={75} /> {/* Replace with actual progress */}
      )}

      {/* Stats grid */}
      <StatGrid stats={{
        findings: 24,
        reproduced: 18,
        verified: 7,
        success: 64
      }} />

      {/* Stage pipeline */}
      <StagePipeline currentStage={run.stage} />
    </motion.div>
  );
}
```

---

## 4. CSS Structure

**File: `components/RunCard.css`**

```css
.run-card {
  background: var(--color-surface);
  border: 5px solid var(--color-text);
  padding: 20px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  
  /* Animation variables */
  --progress: 0%;
  
  /* Transitions */
  transition: all var(--duration-normal) var(--ease-smooth);
}

/* Top gradient bar animation */
.run-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, #00FFFF, #00FF00, #FF1493);
  animation: slideBar 3s ease-in-out infinite;
  animation-play-state: paused;
}

.run-card.active::before {
  animation-play-state: running;
  animation-duration: 1.5s;
}

.run-card:hover {
  border-color: var(--color-accent-cyan);
  box-shadow: var(--glow-cyan), 8px 8px 0 rgba(0,255,255,0.3);
  transform: translateY(-8px) scale(1.02);
}

.run-card.active {
  border-color: var(--color-accent-green);
  box-shadow: var(--glow-green);
}

/* Animations */
@keyframes slideBar {
  0%, 100% { transform: translateX(-100%); }
  50% { transform: translateX(100%); }
}
```

---

## 5. Real-Time Data Updates

### Polling Strategy

```typescript
// Active run: 2000ms (faster)
// Idle dashboard: 5000ms (slower)
// Modal open: 1000ms (realtime)

const POLL_INTERVALS = {
  ACTIVE: 2000,
  IDLE: 5000,
  MODAL: 1000,
} as const;

function useAdaptivePolling() {
  const [interval, setInterval] = useState(POLL_INTERVALS.IDLE);
  
  // Adjust based on UI state
  useEffect(() => {
    if (modalOpen) setInterval(POLL_INTERVALS.MODAL);
    else if (hasActiveRuns) setInterval(POLL_INTERVALS.ACTIVE);
    else setInterval(POLL_INTERVALS.IDLE);
  }, [modalOpen, hasActiveRuns]);

  return interval;
}
```

---

## 6. Performance Optimization

### Code Splitting

```typescript
const Dashboard = lazy(() => import('./components/Dashboard'));
const Modal = lazy(() => import('./components/Modal'));

export function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Dashboard />
      <Modal />
    </Suspense>
  );
}
```

### Memoization

```typescript
export const RunCard = memo(
  function RunCard({ run, index, isActive, onSelect }: RunCardProps) {
    // Component code
  },
  (prev, next) => {
    // Prevent re-render if props haven't changed significantly
    return (
      prev.run.id === next.run.id &&
      prev.isActive === next.isActive &&
      prev.index === next.index
    );
  }
);
```

### Image/Animation Optimization

```typescript
// Disable particle effects on low-end devices
function shouldEnableParticles() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator.deviceMemory || 4) * 1024; // in MB
  return cores >= 4 && memory >= 8192;
}

// Reduce animation frame rate on low FPS
function useAdaptiveFrameRate() {
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    
    const measureFPS = () => {
      frameCount++;
      const currentTime = performance.now();
      
      if (currentTime >= lastTime + 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        if (fps < 30) {
          // Disable non-essential animations
          document.documentElement.style.setProperty(
            '--animation-enabled',
            'false'
          );
        }
        frameCount = 0;
        lastTime = currentTime;
      }
      
      requestAnimationFrame(measureFPS);
    };
    
    measureFPS();
  }, []);
}
```

---

## 7. Accessibility Implementation

### ARIA Labels & Live Regions

```typescript
export function Dashboard() {
  return (
    <div
      role="main"
      aria-label="Repro code repair dashboard"
    >
      {/* Live region for real-time updates */}
      <div
        aria-live="polite"
        aria-label="Run status updates"
        className="sr-only"
      >
        {statusMessage}
      </div>

      {/* Run cards */}
      <div role="list" className="run-list">
        {runs.map((run) => (
          <div
            key={run.id}
            role="listitem"
            tabIndex={0}
            onKeyDown={handleKeyPress}
          >
            <RunCard run={run} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Focus Management

```typescript
function useFocusManagement() {
  const focusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus first interactive element when modal opens
    if (modalOpen && focusRef.current) {
      focusRef.current.focus();
    }
  }, [modalOpen]);

  return focusRef;
}
```

### Keyboard Shortcuts

```typescript
function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl + K: Focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        // Focus logic
      }
      
      // N: New scan
      if (e.key === 'n' || e.key === 'N') {
        openModal();
      }
      
      // Escape: Close modal
      if (e.key === 'Escape') {
        closeModal();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

---

## 8. Testing Strategy

### Component Testing

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunCard } from './RunCard';

describe('RunCard', () => {
  it('animates on hover', async () => {
    const user = userEvent.setup();
    render(<RunCard run={mockRun} isActive={false} />);
    
    const card = screen.getByRole('article');
    expect(card).toHaveClass('hovered');
    
    await user.hover(card);
    expect(card).toHaveClass('hovered');
  });

  it('opens modal on click', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    render(<RunCard run={mockRun} onSelect={onSelect} />);
    
    await user.click(screen.getByRole('article'));
    expect(onSelect).toHaveBeenCalledWith(mockRun.id);
  });
});
```

### Visual Regression Testing

```bash
# Use Percy or Chromatic for visual regression
npm install -D @percy/cli
percy snapshot
```

---

## 9. Deployment Checklist

- [ ] All components build without errors
- [ ] TypeScript strict mode passes
- [ ] ESLint/Prettier formatting enforced
- [ ] All animations 60fps on target devices
- [ ] Bundle size < 500KB (gzipped)
- [ ] Lighthouse score > 90
- [ ] WCAG AA accessibility compliance
- [ ] Mobile responsive tested (375px, 768px, 1440px)
- [ ] Cross-browser tested (Chrome, Safari, Firefox)
- [ ] Performance profiling done
- [ ] Dark mode tested (if supported)
- [ ] Keyboard navigation fully tested
- [ ] Screen reader tested

---

## 10. Documentation Requirements

- [ ] Component Storybook stories written
- [ ] Props documentation complete
- [ ] Animation timing documented
- [ ] Color palette exported as JSON
- [ ] Icon usage guide created
- [ ] Responsive behavior documented
- [ ] API integration documented
- [ ] Error handling documented

---

**This guide provides everything needed to implement the vaporwave design in production-ready React.**

**Start with Phase 1 (foundation & tokens), then move systematically through phases 2-4 for a smooth implementation.**
