# PURE CSS COMPONENT ARCHITECTURE
## Build Frontends Without Component Libraries

A practitioner's guide to building production React applications with an
internal component library using pure TSX + CSS Modules — achieving better
design quality, smaller bundles, and faster iteration than any external
component framework can provide.

This guide is a companion to **PROTOTYPE-FIRST.md**, **PATTERNS.md**,
**FRONTEND-GUIDE.md**, **UI-DESIGN-GUIDE.md**, **BACKEND-GUIDE.md**,
and **INFRA.md**.

---

## 0. THE CORE PRINCIPLE

> If you can build it in an HTML/CSS prototype without a library,
> you can build it in React without a library.

Most UI components in a web application are visually rich but structurally
simple. Buttons, cards, badges, tables, modals, tabs, tooltips, toasts,
form fields — these are CSS patterns with thin JavaScript behavior layers.
They do not need Mantine, Chakra, Radix, or shadcn/ui. They need
well-typed React components with CSS Modules that reference a shared
token system.

The prototype (see PROTOTYPE-FIRST.md) reveals which components are
structurally simple and which genuinely need complex interaction handling.
This guide teaches how to build the simple ones yourself and when to
reach for external packages for the hard ones.

---

## 1. THE ARCHITECTURE

### Token layer

All visual decisions live in CSS custom properties. One file, shared
between the prototype and production. Never duplicated into JavaScript.

```css
/* src/styles/tokens.css */
:root {
  --color-bg: #0B0D11;
  --color-surface: #12141A;
  --color-accent: #4B8BF5;
  --space-4: 16px;
  --text-sm: 13px;
  --radius-md: 6px;
  --ease-fast: 120ms cubic-bezier(0.25, 0, 0.3, 1);
  /* ... full token set */
}
```

### Component layer

Each component is a pair: `ComponentName.tsx` + `ComponentName.module.css`.
The CSS Module references tokens exclusively. The TSX exports a typed
component with the exact props the application needs.

```
src/components/ui/
  Button.tsx + Button.module.css
  Card.tsx + Card.module.css
  Modal.tsx + Modal.module.css
  Select.tsx + Select.module.css
  ...
```

### Feature layer

Domain-specific components compose the UI components:

```
src/features/project/components/
  ProjectCard.tsx + ProjectCard.module.css    (uses Card, Badge, Avatar)
  PhaseProgress.tsx + PhaseProgress.module.css
```

### Theme layer

Theme switching is pure CSS. Zustand stores the active theme/accent.
The root layout applies it as data attributes. Zero re-renders on theme change.

```tsx
// __root.tsx
const { theme, accent } = useUIStore(s => s.theme);
return <html data-theme={theme} data-accent={accent}>...</html>
```

```css
/* themes.css — overrides only color tokens */
[data-theme="cream"] {
  --color-bg: #F5F2EC;
  --color-surface: #FFFFFF;
  --color-text: #1C1915;
}
[data-accent="mint"] {
  --color-accent: #2DD4BF;
}
```

---

## 2. THE COMPONENT PATTERNS

### Pattern: Simple visual component

The majority of components follow this pattern. The CSS does the visual
work. The TSX provides typing and composition.

```tsx
// Button.tsx
import styles from './Button.module.css';
import clsx from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  fullWidth,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        styles.btn,
        styles[variant],
        styles[size],
        loading && styles.loading,
        fullWidth && styles.full,
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {children}
    </button>
  );
}
```

```css
/* Button.module.css */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-md);
  transition: all var(--ease-fast);
  cursor: pointer;
  border: none;
}

.primary { background: var(--color-accent); color: #fff; }
.primary:hover { background: var(--color-accent-hover); }

.secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text);
}
.secondary:hover { background: var(--color-surface-2); }

/* ... danger, ghost, sizes, loading, full */
```

The CSS is identical to the prototype's `components.css` — just scoped
to a module.

### Pattern: Component with managed behavior

For components that need JavaScript behavior (modals, selects, dropdowns),
the behavior is inline — not imported from a library.

```tsx
// Modal.tsx — focus trapping is ~50 lines, not a dependency
import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  confirmRequired?: boolean;  // prevents ESC/overlay close
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ open, onClose, title, size = 'md', confirmRequired, children, footer }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Focus trapping — ~50 lines total
  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';

    const modal = modalRef.current;
    if (!modal) return;

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = modal.querySelectorAll<HTMLElement>(focusableSelector);
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmRequired) {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previousFocus.current?.focus();
    };
  }, [open, onClose, confirmRequired]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={confirmRequired ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={modalRef}
        className={clsx(styles.modal, styles[size])}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {!confirmRequired && (
            <button className={styles.close} onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
```

50 lines of focus trapping code. No `focus-trap-react` dependency. No
`@mantine/core` import. Full accessibility. Full control.

### Pattern: Keyboard-navigable Select

The most commonly cited reason for using a component library. Here's the
reality: a keyboard-navigable select is ~120 lines of code.

```tsx
// Select.tsx — the "hard" component that isn't actually hard
// Handles: arrow keys, enter, escape, type-ahead search, focus management
// ~120 lines including all keyboard logic
```

The keyboard behavior:
- ArrowDown/ArrowUp: move highlight through options
- Enter: select highlighted option
- Escape: close dropdown, restore focus to trigger
- Type characters: jump to matching option (type-ahead)
- Tab: close dropdown and move focus naturally

Each of these is a `switch` case in an `onKeyDown` handler. Not a library.

### Pattern: Toast notifications

Portal-based, auto-dismiss, stackable. ~80 lines.

```tsx
// Toast.tsx
// Uses createPortal to render in a fixed container
// Auto-dismiss via setTimeout
// Stack management via a simple array in Zustand
// Exit animation via CSS transition + onTransitionEnd cleanup
```

---

## 3. THE DECISION FRAMEWORK

### When to build yourself

The component's full behavior can be implemented with:
- CSS for visual presentation
- A single `onKeyDown` handler for keyboard interaction
- A single `useEffect` for lifecycle management (focus, scroll lock)
- A single `useState` for internal state (open/close, selected index)

This covers: Button, Card, Badge, FormField, Input, Textarea, Checkbox,
Toggle, Modal, Select, Dropdown, Tabs, Tooltip, Toast, Table, Avatar,
Skeleton, EmptyState, ProgressBar, SearchBar, Breadcrumbs, Banner,
StarRating, PhotoGrid, and most domain-specific components.

### When to use an external package

The interaction requires one or more of:
- **Complex date math and locale handling** — calendar rendering, date range
  selection, timezone awareness, internationalized month/day names
  → `react-day-picker` (8KB, unstyled)
- **Rich text editing** — cursor management, formatting commands, paste
  handling, collaborative editing, plugin architecture
  → `tiptap` or `@lexical/react`
- **Complex drag-and-drop** — gesture recognition, drop targets, reorder
  animations, accessibility announcements during drag
  → `@dnd-kit/core`
- **Virtualized rendering** — 10K+ row lists where only visible items
  should be in the DOM
  → `@tanstack/react-virtual`

### The test

> Can you build the component's full behavior in an HTML/CSS prototype
> with less than 30 lines of JavaScript?

- **Yes** → build it yourself. The React version is a typed wrapper around
  the same CSS + JS behavior.
- **No, but it's under 150 lines of focused JS** → still build it yourself.
  A Modal with focus trapping, a Select with keyboard nav, a Toast system —
  all fall in this range.
- **No, and the interaction involves domain-specific complexity** (date math,
  rich text, gesture recognition, virtual scrolling) → use a focused,
  unstyled package. Style it with your tokens.

---

## 4. WHAT YOU GAIN

### Bundle size

| Approach | Size |
|----------|------|
| Mantine core + hooks + dates + notifications | ~200-250KB |
| Chakra UI | ~150-200KB |
| Your internal library (28 components) | ~15-20KB |
| `react-day-picker` (only external UI dep) | ~8KB |
| **Total with internal library** | **~25KB** |

That's a 10x reduction in UI framework weight.

### Iteration speed

When you own the component:
- Change the button border radius → edit one CSS variable
- Add a new badge variant → add one CSS class
- Modify the modal animation → edit one CSS transition
- Adjust the table row height → change one token value

When a library owns the component:
- Change the button border radius → find the correct theme key, check if
  it cascades correctly, verify it doesn't break other components
- Add a new badge variant → check if the library supports custom variants,
  if not, override with CSS specificity hacks or `styles` API
- Modify the modal animation → check if the library's animation system
  supports your requirement, if not, fight the default transition

### Maintainability

Zero library version upgrades to manage. No breaking changes from v6 to v7.
No migration guides. No compatibility matrices. Your components change when
you decide to change them.

### Design fidelity

The prototype is the source of truth. The production component is a direct
translation. There is no library default standing between your design
intent and what the user sees. No `unstyled` prop needed. No theme
configuration to align. No specificity overrides. The CSS you wrote in the
prototype IS the CSS that ships.

---

## 5. THE INTERNAL COMPONENT LIBRARY

### Structure

```
src/
  components/
    ui/
      Button.tsx + Button.module.css
      Card.tsx + Card.module.css
      Badge.tsx + Badge.module.css
      FormField.tsx + FormField.module.css
      Input.tsx + Input.module.css
      Select.tsx + Select.module.css      (~120 lines — keyboard nav)
      Checkbox.tsx + Checkbox.module.css
      Toggle.tsx + Toggle.module.css
      Modal.tsx + Modal.module.css         (~50 lines — focus trapping)
      ConfirmModal.tsx                     (extends Modal)
      Toast.tsx + Toast.module.css         (~80 lines — portal + stack)
      Table.tsx + Table.module.css
      Tabs.tsx + Tabs.module.css
      Dropdown.tsx + Dropdown.module.css
      Tooltip.tsx + Tooltip.module.css
      Avatar.tsx + Avatar.module.css
      Skeleton.tsx + Skeleton.module.css
      EmptyState.tsx + EmptyState.module.css
      SearchBar.tsx + SearchBar.module.css
      ProgressBar.tsx + ProgressBar.module.css
      Banner.tsx + Banner.module.css
      StarRating.tsx + StarRating.module.css
      ReviewGate.tsx + ReviewGate.module.css
      PhaseStepper.tsx + PhaseStepper.module.css
      StatCard.tsx + StatCard.module.css
      TierColumns.tsx + TierColumns.module.css
      PhotoGrid.tsx + PhotoGrid.module.css
      FloorPlanCanvas.tsx + FloorPlanCanvas.module.css
  styles/
    tokens.css          ← from prototype (unchanged)
    reset.css           ← from prototype (unchanged)
    global.css          ← app shell, utilities (from prototype)
    themes.css          ← theme overrides (from prototype)
```

### Translating from prototype

For each component in `prototype/css/components.css`:

1. Create `ComponentName.tsx` with typed props derived from the HTML usage
2. Create `ComponentName.module.css` by copying the relevant CSS classes
   from `components.css`, scoped to the module
3. Replace class name strings with `styles.className`
4. Replace prototype JS behavior with React hooks/handlers
5. Add `[REACT]` comment props as actual TypeScript props

The CSS is a copy-paste with scope. The TSX is a typed wrapper around
the HTML structure. The behavior is a React translation of the prototype JS.

---

## 6. THEMING WITHOUT A LIBRARY

Component libraries sell theming as a feature. CSS custom properties give
you the same capability with zero runtime overhead.

### How it works

1. Tokens defined in `:root` (the defaults)
2. Theme overrides in `[data-theme="name"]` selectors
3. Accent overrides in `[data-accent="name"]` selectors
4. Applied via data attributes on `<html>`
5. Zustand stores the selection, persists to localStorage
6. Components reference `var(--color-*)` — they don't know which theme is active

### What changes between themes

**Only colors change.** Typography, spacing, radius, transitions, layout —
everything that defines the product's structural identity — stays constant.
A theme changes the palette, not the personality.

### Theme-aware components

Most components need zero theme-specific code. They use `var(--color-*)` and
the browser resolves to the active theme's value automatically.

The few that need explicit attention:
- Light mode may need different shadow values (lighter on light backgrounds)
- Light mode may need different scrollbar colors
- Light mode skeleton shimmer gradient direction may differ
- Accent colors on light backgrounds need darker variants for contrast

These are handled in `themes.css` with targeted selectors:
```css
[data-theme="cream"] .skeleton {
  background: linear-gradient(90deg, var(--color-surface-2) 0%, ...);
}
```

---

## 7. ACCESSIBILITY WITHOUT A LIBRARY

The accessibility features that component libraries provide are:
- Focus trapping in modals (50 lines)
- Keyboard navigation in selects/menus (120 lines)
- ARIA attributes on dynamic elements
- Focus-visible styling

All of these are straightforward to implement:

### Focus trapping

Query focusable elements, cycle Tab between first and last, restore focus
on close. 50 lines in a `useEffect`.

### Keyboard navigation

`onKeyDown` handler with a `switch` on `e.key`. ArrowDown, ArrowUp, Enter,
Escape, Tab. Maintain a `highlightedIndex` in state. 120 lines.

### ARIA attributes

Apply directly in JSX:
```tsx
<div role="dialog" aria-modal="true" aria-label={title}>
<button aria-expanded={open} aria-haspopup="listbox">
<ul role="listbox" aria-activedescendant={`option-${highlightedIndex}`}>
<li role="option" aria-selected={selected} id={`option-${index}`}>
```

### Focus-visible

Global CSS, already in the reset:
```css
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
```

---

## THE UNDERLYING TRUTH

Component libraries exist because building UI components from scratch
used to be slow. CSS was harder to manage, browser inconsistencies were
rampant, and accessibility was poorly understood.

None of those things are true anymore. CSS custom properties eliminated
theming complexity. CSS Modules eliminated scoping problems. Modern
browsers are consistent. Accessibility patterns are well-documented
and straightforward to implement.

What remains true: some interaction problems are genuinely hard (date
pickers, rich text editors, drag-and-drop, virtual scrolling). Use
focused packages for those. Build everything else yourself.

The result: a frontend that is lighter, faster, more maintainable,
and more precisely designed than anything a component library can produce.
Because every line of CSS and every line of component code was written
for this specific application, by someone who understands exactly what
it needs to do.
