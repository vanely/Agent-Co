# PROTOTYPE-FIRST DEVELOPMENT
## Build the Full UI Before Writing a Single Line of Framework Code

A practitioner's guide to using HTML/CSS/JS prototypes as the foundation
for frontend development — not as throwaway mockups, but as the authoritative
spec, design review, and component blueprint that the production app
translates from mechanically.

This guide is a companion to **PATTERNS.md**, **FRONTEND-GUIDE.md**,
**UI-DESIGN-GUIDE.md**, **BACKEND-GUIDE.md**, and **INFRA.md**.

---

## 0. THE CORE PRINCIPLE

> Build the entire frontend as a navigable, interactive HTML/CSS/JS site
> before writing any React, Vue, Svelte, or framework code.

The prototype is not a throwaway. It is three things simultaneously:

1. **The design review** — stakeholders click through the full app and
   evaluate UX before a single framework component exists
2. **The component spec** — every CSS class becomes a CSS Module, every
   HTML structure becomes a component, every JS handler becomes a hook
3. **The token system** — the `:root` variables in the prototype ARE the
   production tokens, moved directly into the app with zero translation

---

## 1. WHY PROTOTYPE FIRST

### The speed argument

HTML/CSS iteration is 10x faster than framework iteration for layout and
styling. No build step. No hot reload lag. No component tree to navigate.
No props to wire. No state management. Save the file, refresh the browser.

A designer or developer can build and iterate on a full page layout in
minutes. The same page in React — with routing, data fetching, state
management, and component composition — takes hours before you can even
evaluate whether the layout works.

### The design argument

Design decisions should be made in the cheapest possible medium. HTML/CSS
is that medium. When you prototype in React, the cost of changing a layout
is entangled with the cost of changing component APIs, state flows, and
data dependencies. In HTML/CSS, changing a layout is changing CSS. That's it.

This means:
- You experiment more freely (low cost of change)
- You evaluate the full flow (every page is navigable)
- You catch UX problems before they're buried in framework abstractions
- You iterate with non-technical stakeholders who can't read JSX

### The translation argument

The gap between a well-built prototype and production React is mechanical,
not creative. Every decision has already been made:
- Layout: decided and proven in CSS
- Component boundaries: visible in the HTML structure
- Visual states: hover, active, disabled, loading, empty, error — all styled
- Responsive behavior: media queries written and tested
- Accessibility: focus rings, semantic HTML, ARIA attributes in place
- Data shape: mock data in the HTML reveals the props each component needs
- API dependencies: documented in comments

The React translation is a series of predictable steps, not a design exercise.

---

## 2. THE PROCESS

### Phase 1: Foundation (do this first, completely)

**Step 1 — Design tokens** (`tokens.css`)

Define every visual decision as a CSS custom property. This file is the
single source of truth for the entire application's visual language.

```css
:root {
  /* Colors — backgrounds, borders, text, accent, semantic */
  --color-bg: #0B0D11;
  --color-surface: #12141A;
  --color-text: #E8E9ED;
  --color-accent: #4B8BF5;
  /* ... full palette */

  /* Spacing — 4px base grid */
  --space-1: 4px;
  --space-2: 8px;
  /* ... full scale */

  /* Typography — families, sizes, weights, line heights */
  /* Radius, shadows, transitions, focus, layout, z-index */
}
```

This file moves to `src/styles/tokens.css` in production unchanged.

**Step 2 — CSS reset** (`reset.css`)

Normalize browser defaults. Apply token-based body styles. Define scrollbar
styling, selection colors, focus-visible behavior. This file moves to
production unchanged.

**Step 3 — Global styles** (`global.css`)

The app shell layout (sidebar + content), responsive breakpoints, grid
systems, flex utilities, spacing utilities, text utilities, animations.
These become production utilities or layout components.

**Step 4 — Component library** (`components.css`)

Every reusable UI pattern as a CSS class. This is the most important file —
it defines the visual vocabulary of the entire application:

- Buttons (variants, sizes, states)
- Cards (standard, interactive, compact)
- Badges (status, tier, semantic)
- Form elements (inputs, selects, checkboxes, toggles, textareas)
- Tables (data rows, headers, responsive)
- Modals (overlay, dialog, sizes)
- Tabs, dropdowns, tooltips, toasts
- Domain-specific patterns (stat cards, progress bars, etc.)

Each CSS class maps 1:1 to a React component + CSS Module in production.

**Step 5 — Shared JavaScript** (`shared.js`)

Interactive behavior that spans pages: modal open/close, tab switching,
mobile nav toggle, toast notifications, confirm dialogs, dropdown toggles.
These become React hooks and components.

### Phase 2: Pages (build every screen)

Build every page the user will see. Not wireframes. Not partial layouts.
Complete, navigable pages with:

- Real navigation between pages (anchor tags, onclick redirects)
- Real data shapes (hardcoded but realistic mock data)
- All visual states (loading, empty, error, populated)
- Responsive behavior (test at mobile, tablet, desktop)
- Interactive elements (modals open, tabs switch, forms validate visually)

Every page follows the same structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="../css/tokens.css">
  <link rel="stylesheet" href="../css/reset.css">
  <link rel="stylesheet" href="../css/global.css">
  <link rel="stylesheet" href="../css/components.css">
  <!-- Page-specific styles in <style> block -->
</head>
<body>
  <!-- App shell (sidebar + content) copied from template -->
  <!-- Page-specific content -->
  <!-- Modals -->
  <script src="../js/shared.js"></script>
</body>
</html>
```

### Phase 3: Annotation (prepare for translation)

Decorate every significant element with comments that map to production:

```html
<!--
  [REACT] src/routes/_auth/projects/index.tsx
  [REACT] Route loader: queryClient.ensureQueryData(projectListOptions())
  [API] GET trpc/project.list — returns projects for current tenant
  [STATE] Filter tabs → URL search params (survives refresh)
  [A11Y] All interactive elements have focus-visible
  [UX] Empty state when no projects exist
-->
```

**Comment tags:**
- `[REACT]` — which component/file this becomes
- `[API]` — which endpoint this calls, what it sends/receives
- `[STATE]` — where this state lives (URL, Query cache, Zustand)
- `[A11Y]` — accessibility requirements
- `[UX]` — interaction behavior and design decisions
- `[SPLIT]` — where to extract into a separate component

### Phase 4: Review and iterate

Open the prototype in a browser. Click through every flow. Evaluate:
- Does the navigation feel natural?
- Are the visual states complete? (loading → populated → empty → error)
- Does the mobile layout work?
- Does the hierarchy guide the eye correctly?
- Can anything be removed? (restraint test from UI-DESIGN-GUIDE.md)
- Does every screen serve the product's emotional register?

Iterate in HTML/CSS. This is the cheapest place to change anything.

### Phase 5: Translate to production

The translation is mechanical:

| Prototype | Production |
|-----------|-----------|
| `tokens.css` | `src/styles/tokens.css` (unchanged) |
| `reset.css` | `src/styles/reset.css` (unchanged) |
| `components.css` classes | `src/components/ui/ComponentName.module.css` |
| HTML structure | TSX component with typed props |
| `shared.js` functions | React hooks and event handlers |
| Mock data | tRPC queryOptions + useSuspenseQuery |
| Page HTML | Route component with loader |
| `[API]` comments | tRPC procedure calls |
| `[STATE]` comments | Zustand store or URL search params |
| Inline `<style>` | Page-level CSS Module |

---

## 3. PROTOTYPE STRUCTURE

### File organization

```
prototype/
  css/
    tokens.css        ← design tokens (moves to production unchanged)
    reset.css         ← browser reset (moves unchanged)
    global.css        ← app shell, utilities, animations
    components.css    ← full component library
    nav.css           ← sidebar + mobile navigation
    themes.css        ← theme palettes (if theming supported)
  js/
    shared.js         ← modal, tab, toast, dropdown, confirm systems
    theme-switcher.js ← theme management (if theming supported)
  pages/
    login.html        ← auth pages
    register.html
    projects.html     ← main dashboard (establishes app shell pattern)
    clients.html
    project-new.html  ← multi-step wizard
    project-detail.html
    ...               ← every page the user will see
  assets/             ← placeholder images, icons
```

### The app shell pattern

The first authenticated page (usually the dashboard) establishes the app
shell: sidebar, mobile header, mobile tab bar, content area. Every
subsequent page copies this shell and replaces the content. This ensures
consistency and makes translation to a shared layout component trivial.

### Mock data conventions

Use realistic data that reveals the shape of what the API will return:

```html
<!-- Good: realistic data reveals component needs -->
<div class="project-card">
  <div class="project-card-name">Meridian Office Tower — Full System</div>
  <div class="project-card-client">Meridian Property Group</div>
  <span class="badge badge-info">Assessment</span>
  <div class="phase-dots"><!-- 7 dots, 2 completed, 1 current --></div>
  <span class="project-card-meta">6 zones · Jake Torres · Apr 3</span>
</div>

<!-- Bad: lorem ipsum reveals nothing -->
<div class="card">
  <div class="title">Lorem Ipsum</div>
  <div class="subtitle">Dolor sit amet</div>
</div>
```

Realistic data:
- Reveals what props the component needs
- Tests whether the layout handles real content lengths
- Makes the prototype useful for stakeholder review
- Exposes edge cases (long names, empty states, zero values)

---

## 4. WHAT THE PROTOTYPE REPLACES

### Figma/Sketch mockups

The prototype IS the mockup — but interactive, responsive, and navigable.
You don't need a separate design tool for application UI. The browser is
the design tool.

**Exception:** Brand identity work (logos, illustrations, marketing pages)
still benefits from vector design tools. Application UI does not.

### Component library documentation

The prototype IS the documentation. Each page demonstrates how components
compose, how they respond to data, and how they behave at different
viewport sizes. A developer looking at `projects.html` knows exactly what
the ProjectCard component looks like, what data it needs, and how it
behaves on mobile.

### Wireframes

There are no wireframes. There is the prototype. Wireframes are a
low-fidelity approximation of what you could instead build at full
fidelity in the same amount of time using CSS you'll actually ship.

---

## 5. WHEN NOT TO PROTOTYPE FIRST

- **Trivial CRUD screens** with no custom design — if it's a basic admin
  table, build it directly in the framework
- **Real-time interactive features** (collaborative editing, drag-and-drop
  canvas) where the behavior IS the design — prototype the static states,
  but the interaction needs to be built in the framework
- **Incremental features** on an existing app — if the component library
  and design system already exist, new features can be built directly

The prototype-first pattern is most valuable for:
- New applications (greenfield)
- Major redesigns
- Complex multi-page flows
- Products where the UI IS the product (dashboards, tools, editors)

---

## 6. THE TRANSLATION CHECKLIST

Before translating any page to production:

- [ ] Every visual state is represented (loading, empty, error, populated)
- [ ] Responsive layout tested at 390px, 768px, 1024px, 1440px
- [ ] All interactive elements work (modals, tabs, dropdowns, form validation)
- [ ] Navigation between pages is complete and logical
- [ ] `[REACT]`, `[API]`, `[STATE]`, `[A11Y]` comments are in place
- [ ] Mock data shapes match the expected API response structure
- [ ] The design self-critique tests pass (UI-DESIGN-GUIDE.md Section 14):
  inevitability, subtraction, hierarchy blur, stranger test
- [ ] Accessibility: focus-visible, semantic HTML, labels, contrast ratios

After this checklist passes, the translation to production is a mechanical
process, not a design process. Every creative decision is already made.

---

## THE UNDERLYING PRINCIPLE

The cheapest time to change a design is before you've built the machinery
around it. HTML/CSS is the cheapest medium for UI design. React is expensive
because every visual change is entangled with component APIs, state management,
data fetching, and type systems.

Prototype first. Get the design right in the cheap medium. Then translate to
the expensive medium once, correctly, without iteration cycles that cost 10x
what they would have cost in HTML.

The prototype is not extra work. It is the work — done in the right order.
