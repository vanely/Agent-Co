# UI DESIGN — A THINKING FRAMEWORK
## For Claude Code — How to Think, Then Build

Read this entire document before writing a single line of code or CSS.
Not for the recipes. For the reasoning.

This guide is part of the skill document family:
- **PATTERNS.md** — how to think about structure and resolve conflicts
- **FRONTEND-GUIDE.md** — how to build the client (data, state, routing)
- **BACKEND-GUIDE.md** — how to build the server (contracts, auth, queues)
- **INFRA.md** — how to run both (containers, deployment, operations)
- **This guide** — how to think about what the user *sees and feels*
- **TESTING-GUIDE.md** — how to discover what you missed (systemic testing, security)

The connection between this guide and the others:
- **Restraint** (this guide) = **extraction test** (PATTERNS.md) — remove
  everything that isn't earning its place
- **Design tokens** (this guide) = **CSS token system** (FRONTEND-GUIDE.md
  Section 10) — the same `:root` variables, governed by the same principle
- **Logo-to-system** (this guide) = **centralize data, not logic**
  (PATTERNS.md Section 3) — one source of truth propagated everywhere
- **The three questions** (this guide) = **the core principle** (PATTERNS.md
  Section 0) — understand what the thing *is* before deciding how to build it

---

## 0. THE CORE PRINCIPLE

> Design is not the application of aesthetics to a product.
> Design is the product of thinking clearly about what something *is*.

The best interfaces feel inevitable — not clever, not decorated, not styled.
Inevitable. Every spacing decision, every weight choice, every moment of
whitespace either earned its place by serving the thing, or it didn't.

This document covers three distinct product contexts:

- **Websites** — presentation, brand communication, first impression.
  The job is to make someone feel something true about the product
  before they've read a single word of copy.

- **Web apps** — dashboards, analytics, forms, complex flows.
  The job is to make sophisticated functionality feel effortless —
  to take something genuinely hard and make it feel like it was
  always going to be this simple.

- **Mobile apps** — everything a web app does, compressed into a
  hand, navigated with a thumb, felt in a second.
  The job is to make a small space feel complete, not cramped.

The design thinking is the same across all three. Only the
constraints change. The questions below apply everywhere.

### The three questions — answer before writing a single line

**1. What is this thing, really?**
Not its category. Not its feature set. The fundamental nature
of the experience it creates for the person using it.

The answer always sounds less like a product description and
more like a feeling or a relationship. Here is what that looks
like across the three contexts:

*Websites:*
A SaaS landing page is not a feature list —
it is *the first moment of trust between a stranger and a product*.
A portfolio site is not a gallery —
it is *a curated argument for why this person sees differently*.
A brand site is not marketing —
it is *the distillation of what the brand believes, made visible*.

*Web apps:*
A project management dashboard is not a task viewer —
it is *the reduction of cognitive load for someone with too much to hold*.
An analytics tool is not a chart renderer —
it is *the transformation of raw data into a decision someone can make*.
An onboarding flow is not a form sequence —
it is *the moment a product convinces someone it was built for them*.

*Mobile apps:*
A finance app is not an account viewer —
it is *the reduction of anxiety about the future into something manageable now*.
A fitness tracker is not a log —
it is *the externalization of willpower into something that holds you accountable*.
A communication app is not a message list —
it is *the feeling of presence with someone who isn't in the room*.

The design follows directly from this answer — not from the category,
not from competitor research, not from a design trend.
Get this answer wrong and everything that follows will be competent
but hollow. Get it right and the design almost designs itself.

**2. What is the one emotional register?**
Dense and powerful. Warm and human. Meditative. Precise. Urgent.
Luxurious. Playful. Clinical. Trustworthy. Pick *one*.
A design that tries to feel two things simultaneously feels like neither.
The emotional register governs every subsequent decision —
typeface, weight, color, spacing, motion speed, copy tone.

**3. What does "done" feel like?**
The user should feel something specific when they complete the
primary action. Name that feeling before building anything.
*Relieved* (anxiety resolved). *Confident* (decision made clearly).
*Satisfied* (task completed without friction). *Delighted* (exceeded
what they expected). Design backward from that feeling.

### UI and UX are the same question

This document covers both UI (what it looks like) and UX (how it
works) because they cannot be separated. Every visual decision is
also a behavioral one.

The restraint principle is where UI and UX become one:

> Ask of every element: *Is this earning its place by serving the
> thing, or is it here because it seemed like a good idea?*
>
> A design is finished not when there is nothing left to add,
> but when there is nothing left to remove.

A navigation item that "might be useful" is a UX failure dressed
as a UI feature. A modal that interrupts to confirm a reversible
action is a trust problem disguised as safety. A dashboard with
eight stat cards when three would serve the decision is cognitive
overload marketed as comprehensiveness.

Restraint is not minimalism for aesthetic reasons.
Restraint is the discipline of asking what genuinely serves the
person using the thing — and removing everything that doesn't.

---

## 1. ACCESSIBILITY — A DESIGN PRINCIPLE, NOT A CHECKLIST

Accessibility is not a compliance task applied after design. It is a
constraint that produces better design — the same way mobile-first
produces better hierarchy and restraint produces better focus.

When you design for someone who navigates with a keyboard, you discover
that your focus states reveal the true tab order — and that tab order
*is* your information hierarchy made explicit. When you design for
someone using a screen reader, you discover that your heading structure
*is* your content architecture spoken aloud. When you design for someone
with low vision, you discover that your contrast ratios *are* your
visual hierarchy under stress.

Every accommodation for accessibility improves the design for everyone.

### The governing questions

Before any visual decision, add a fourth question to the three:

**4. Does this work when I can't [see it / click it / hear it]?**

- Can't see it → Does the structure convey meaning without color?
  (Color should reinforce meaning, not carry it alone. A red error
  message also needs an icon or text label.)
- Can't click it → Can every interactive element be reached and
  activated with Tab + Enter? Is the focus indicator visible?
- Can't hear it → Does any audio/video content have text alternatives?

### Contrast minimums — floors, not suggestions

```
Primary text:           contrast ratio > 7:1   (AAA)
Secondary text:         contrast ratio > 4.5:1 (AA)
Muted / placeholder:    contrast ratio > 3:1   (AA Large)
Interactive on bg:      contrast ratio > 3:1   (non-text)
```

Check with webaim.org/resources/contrastchecker/ when uncertain.
The most common failure in dark-mode UIs: muted text too close
to background. `#6E6E80` on `#0A0A0B` = 4.8:1, workable.
`#333` on `#0A0A0B` = 1.5:1, illegible.

### Focus indicators

Every interactive element needs a visible focus ring. The default
browser outline is fine functionally but often visually inconsistent.
Define a custom focus ring using the accent color:

```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

Use `:focus-visible` (not `:focus`) so the ring appears on keyboard
navigation but not on mouse clicks.

### Semantic structure

- Use heading levels (`h1`–`h6`) to reflect the actual content hierarchy,
  not for visual sizing. Style headings with CSS classes if needed.
- Every form input needs a `<label>` associated via `for`/`id`.
- Use `<button>` for actions, `<a>` for navigation. Never a styled `<div>`.
- `aria-label` when a visual icon replaces text (icon-only buttons).

---

## 2. HOW TO FIND REAL INSPIRATION

### The principle of platform selection

Different platforms surface different kinds of thinking. Use them in
combination — and understand what each one *cannot* show you.

**Behance (behance.net)**
Where professional designers share complete brand and identity work.
Stronger than Dribbble for understanding how a visual system *coheres*
across surfaces — logo, typography, color, application together.
Search for: brand identity, visual identity, logo design, editorial.
Look past the mockups to the design decisions that made them possible.

**Are.na (are.na)**
A research and reference tool used by serious designers to build
collections of visual thinking. Channels on Are.na are curated with
conceptual intent — not trend-chasing. Use it to understand the
*ideas* behind visual directions, not just the outputs.

**It's Nice That (itsnicethat.com)**
The standard-bearer for editorial and graphic design criticism.
Strong for understanding why something works at a conceptual level,
not just what it looks like. Read the articles, not just the images.

**Fontfabric (fontfabric.com/blog)**
The most rigorous annual summary of typographic and design trends
with genuine critical analysis. Essential reading before starting
any identity or typographic system work.

**Cosmos.so**
Curated visual research boards from designers, researchers, and
creative directors. Excellent for finding unexpected reference
combinations — what happens when brutalism meets luxury, or
terminal aesthetics meet editorial calm.

**Dribbble (dribbble.com)**
High-concentration source of aspirational concept design. Useful for
component patterns and understanding aesthetic directions.
**Critical caveat:** Dribbble skews toward visual polish over conceptual
rigor. Use it to understand what something should *look* like after
you already know what it should *be*. Never use it as your primary
reference for a brand or identity.

**Godly (godly.website) / Awwwards (awwwards.com)**
Award-level web executions. Use for scroll behavior, hero sections,
and motion. Strong for understanding what exceptional interaction
feels like at the web layer.

**Mobbin (mobbin.com)**
Real screenshots from shipped apps, organized by screen type and flow.
This is what Dribbble is not: grounded in production reality.
Use when you need to understand how actual apps handle specific flows.

**Reference studios to study directly:**
Studio Dumbar, COLLINS, Pentagram, Wolff Olins, Sagmeister & Walsh.
These studios' websites and press releases are richer learning
resources than any aggregator.

### How to read a reference — the five dissections

When you find a reference worth studying, stop looking and start
asking:

1. **What is the hierarchy?** What draws the eye first, second, third?
   Does that order match what the product needs the user to do first?

2. **What is the palette, and what role does each color play?**
   Great work uses 2-3 colors maximum. Name the role of each:
   background, primary action, accent/signal, text. If you can't
   name the role, the palette is probably doing too much.

3. **What does the typography communicate before you read it?**
   Weight contrast communicates the relationship between human and
   machine. Tracking communicates intimacy or distance. Serif vs
   sans-serif communicates time — serif roots in print and history,
   sans in screens and immediacy. Ask this before asking size.

4. **What was removed?** The most important design decisions are
   subtractive. What information, element, or decoration is conspicuously
   absent that you'd expect to find? That absence is usually intentional
   and usually correct.

5. **What is the one thing you will remember tomorrow?**
   If nothing comes to mind, the design failed at the level of identity.
   Every strong design has one unforgettable thing.

---

## 3. DESIGN LANGUAGE — THINKING, NOT RECIPES

The mistake most designers make when learning aesthetic modes is
treating them as templates to apply. They are not. They are the
*output* of a particular way of thinking about what a product is.

Learn the thinking, not the template. The visual result will follow.

### The restraint principle — applies to everything

**Restraint is the primary design skill.** Not composition. Not color
theory. Not typography. The willingness to remove something correct
in favor of something necessary.

Ask of every element: *Is this earning its place by serving the
thing, or is it here because it seemed like a good idea?*

A design is finished not when there is nothing left to add, but when
there is nothing left to remove.

### Dark mode / technical precision (Vercel, Linear, Raycast)

The thinking: technology as craft. Darkness as surface, not void.
Every pixel is doing work. Nothing decorative. The user's attention
is the most valuable resource on the screen.

```css
/* These values follow from the thinking -- don't apply them
   without understanding why they are what they are */
:root {
  --bg:          #0A0A0B;  /* near-black -- slight cool tint, not pure black */
  --surface:     #111113;  /* 1 step lighter -- cards and panels */
  --surface-2:   #1A1A1E;  /* 2 steps -- elevated, modals */
  --border:      #232328;  /* hairline separators, never bright */
  --text:        #EDEDEF;  /* never pure white -- too harsh against dark */
  --text-muted:  #6E6E80;  /* 4.8:1 against bg -- just barely AA */
  --accent:      #7C3AED;  /* one saturated color. Use it sparingly. */
  --accent-hover:#5B21B6;
}
```

Key reasoning:
- Cards use `border: 1px solid var(--border)` — never `box-shadow`.
  Shadows imply depth. This aesthetic implies flatness and precision.
- Hover states are a subtle background tint shift, not a bright highlight.
  The interface does not reward the cursor. It acknowledges it.
- The accent color appears in exactly one context: primary action.
  If it appears anywhere else, it stops being an accent.

### Luxury minimal / light ground

The thinking: what you *don't* say is the product.
White is not the absence of design — it is the design.
Space is not empty — it is breathing room.
The type is the only element. It must carry everything.

The principles:
- One typeface family, with weight contrast as the only instrument
- Hairline weight (100-200) for the dominant display element
- Generous tracking on caps — the letters need air
- One accent element, used once, in a color so specific it
  becomes a signature (not a brand color — a signature)
- Rules and dividers are 1px at most, and often omitted entirely
- Copy is minimal to the point of feeling incomplete — that
  incompleteness is intentional, it invites the reader to fill the gap

### Terminal / sci-fi precision

The thinking: the interface as a living system. The user is
observing a process that continues whether or not they are watching.
Typography and interaction language borrow from actual terminal
conventions — not as decoration, but because those conventions
carry genuine meaning.

The principles:
- Monospace throughout, or monospace for all data/system text
- The cursor is an active agent, not a pointer. It does one thing
  at a time, sequentially. Never two things simultaneously.
- Color used as signal, not palette. One warm accent in a cold field.
- Broken borders, corner marks, and hairline rules replace
  conventional card borders — the geometry implies structure, not
  decoration
- Scanlines, breathing dots, and micro-animations exist to make
  the interface feel *alive* — like it's running, not just displayed

### Warm / human (Notion, Loom)

The thinking: software made by people who care about the
experience. The emotional register is warmth without sentimentality.

```css
:root {
  --bg:         #FAFAF9;  /* warm off-white -- never pure white */
  --surface:    #FFFFFF;
  --border:     #E8E8E4;  /* warm gray */
  --text:       #1A1817;  /* near-black with warmth */
  --text-muted: #8A8A82;
  --accent:     #2F80ED;  /* calm, trustworthy -- not exciting */
}
```

### Dense / data-rich (Linear, Airtable)

The thinking: respecting the user's intelligence.
Every pixel earns its place by carrying information.

```css
:root {
  --row-height:    36px;
  --compact-gap:   8px;
  --section-gap:   24px;
  --sidebar-width: 240px;
  --text-sm:       12px;  /* metadata */
  --text-md:       13px;  /* body -- Linear/Notion standard */
  --text-lg:       15px;  /* section headers */
}
```

---

## 4. THE LOGO-TO-SYSTEM PRINCIPLE

This is one of the most important concepts in applied brand design
and the one most often skipped.

**When a logo or mark exists, it is the design system.**

The logo's accent color becomes the *only* color used in the site.
Not a color palette inspired by the logo — the exact color,
deployed sparingly, always with the same semantic role.

The logo's typographic personality propagates into every element:
- If the logo uses hairline weight, the nav, body, and labels
  use hairline weight
- If the logo uses a specific typeface, that typeface is used
  throughout — not a similar one
- If the logo has a structural punctuation mark (a `/`, a `*`,
  a `_`), that mark appears in the UI at key moments with
  the same semantic meaning it carries in the logo

The logo's interaction language becomes the interaction language
of the site:
- A terminal mark gets a typing cursor, sequential text reveals,
  and scanlines
- A luxury minimal mark gets slow fade reveals, generous
  breathing, and a cursor that expands rather than changes

**Test:** If you removed the logo from the site, would someone
who has seen the logo be able to identify the site as belonging
to it? If not, the design system hasn't done its job.

---

## 5. TYPOGRAPHY — THE PRIMARY INSTRUMENT

Typography is not decoration applied after layout. It *is* the layout.
Learn to use it as a primary instrument, not a finishing step.

### What typefaces communicate before you read them

| Typeface category | What it implies |
|-------------------|-----------------|
| Sans-serif, geometric, thin | Precision, technology, modernity |
| Sans-serif, humanist | Warmth, approachability, craft |
| Serif, editorial | Tradition, editorial authority, slowness |
| Monospace | Code, data, terminal, objectivity |
| Condensed, heavy | Industrial, urgency, power |
| Script / calligraphic | Intimacy, handmade, personal |

**Never choose a font because it's neutral.** Neutral is a choice
with consequences — it says the product has no point of view.
Distinctive type says the product has been considered.

Inter is the most overused font in web design today. It is an
excellent typeface. It is also a signal that no typographic decision
was made. Use it only when you can justify it conceptually.

### Weight contrast as concept

The most powerful typographic tool available is weight contrast —
the difference in visual mass between two elements.

A 100-weight word next to a 900-weight word creates tension.
That tension can mean:
- Human / machine (thin organic, heavy digital)
- Signal / noise (thin background, heavy foreground)
- Question / answer (thin prompt, heavy response)

Identify the conceptual relationship you want to express, then
express it through weight contrast rather than color or size.

### Tracking (letter-spacing) as emotional register

- Tight tracking (-0.03em to 0): urgency, density, intimacy
- Normal tracking (0 to 0.05em): neutral, readable
- Wide tracking (0.1em to 0.3em): luxury, precision, distance
- Extreme tracking (0.4em+): architectural, monumental, cold

Wide-tracked caps at hairline weight is the typographic signature
of luxury. It reads as silence made visible.

### The type scale — committed choices

```css
:root {
  /* Display -- hero moments only. Use maximum once per screen. */
  --text-display: clamp(64px, 20vw, 160px);

  /* Title -- page and section identity */
  --text-title:   clamp(28px, 7vw, 56px);

  /* Heading -- sub-section structure */
  --text-heading: clamp(18px, 4vw, 28px);

  /* Body -- the primary reading size */
  --text-body:    clamp(13px, 2.5vw, 16px);

  /* Small -- metadata, labels, annotations */
  --text-small:   clamp(9px, 1.8vw, 11px);
}
```

**The rule:** Never use more than 4 of these on a single screen.
Every size you add is another thing competing for attention.

---

## 6. DESIGN TOKENS — THE NON-NEGOTIABLE FOUNDATION

Define all tokens before writing any component styles.
Never hardcode a color, spacing value, or font size.

These tokens are the same variables referenced in FRONTEND-GUIDE.md
Section 10 (`src/styles/tokens.css`). Define them here based on the
design intent; the frontend guide governs how they're consumed.

### Complete token template — dark precision default

```css
:root {
  /* -- Colors ---- */
  --color-bg:           #0A0A0B;
  --color-surface:      #111113;
  --color-surface-2:    #1A1A1E;
  --color-border:       #232328;
  --color-text:         #EDEDEF;
  --color-text-muted:   #6E6E80;
  --color-accent:       #7C3AED;
  --color-accent-hover: #5B21B6;
  --color-danger:       #E05252;
  --color-success:      #4ECF7A;
  --color-warning:      #E8A44A;

  /* -- Spacing (4px base grid) ---- */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* -- Typography ---- */
  --font-display: 'Inter', system-ui, -apple-system, sans-serif;
  --font-body:    'Inter', system-ui, -apple-system, sans-serif;
  --font-mono:    'JetBrains Mono', 'Fira Code', monospace;

  /* -- Radius ---- */
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-full: 9999px;

  /* -- Shadows -- use sparingly, only when elevation matters ---- */
  --shadow-sm:  0 1px 2px rgba(0,0,0,0.06);
  --shadow-md:  0 4px 12px rgba(0,0,0,0.10);
  --shadow-lg:  0 8px 32px rgba(0,0,0,0.16);

  /* -- Transitions ---- */
  --ease-fast:   120ms cubic-bezier(0.25, 0, 0.3, 1);
  --ease-base:   200ms cubic-bezier(0.25, 0, 0.3, 1);
  --ease-slow:   320ms cubic-bezier(0.25, 0, 0.3, 1);
  --ease-spring: 400ms cubic-bezier(0.34, 1.56, 0.64, 1);

  /* -- Focus ---- */
  --focus-ring: 2px solid var(--color-accent);
  --focus-offset: 2px;
}
```

### Color palette starting points — by thinking, not aesthetic name

| Thinking | Background | Surface | Border | Text | Accent |
|----------|-----------|---------|--------|------|--------|
| Tech precision, dark | `#0A0A0B` | `#111113` | `#232328` | `#EDEDEF` | `#7C3AED` |
| Terminal / amber | `#080807` | `#0C0C0A` | `rgba(255,107,26,0.07)` | `rgba(255,255,255,0.88)` | `#FF6B1A` |
| Terminal / cold | `#06070B` | `#0A0C12` | `rgba(74,244,255,0.07)` | `rgba(255,255,255,0.85)` | `#4AF4FF` |
| Luxury light | `#F2F2EE` | `#FFFFFF` | `rgba(17,17,18,0.1)` | `#111112` | `#7FFF00` |
| Warm editorial | `#FBF8F4` | `#FFFFFF` | `#E9E2D8` | `#2C2418` | `#DC7B3C` |
| Dark warm | `#0D0D0A` | `#141410` | `#2A2920` | `#F0EDE8` | `#E8A44A` |

### Dark/light mode — a design decision, not a default

Supporting both dark and light mode is not always necessary. Decide
based on the product context:

**Support both when:**
- The app is used for extended periods (dashboards, editors, reading)
- Users will use it in varying lighting conditions (mobile apps)
- The product serves a broad audience with diverse preferences

**Choose one when:**
- The emotional register is inseparable from the palette (a terminal
  aesthetic *is* dark — a light version would be a different product)
- The product is used in a controlled context (internal tool, kiosk)
- You're building a brand site where the palette *is* the brand

**When supporting both modes:**
- Use semantic token names: `--color-bg`, not `--color-dark-bg`
- Only the color layer changes. Typography, spacing, hierarchy, layout
  stay identical between modes.
- Define both palettes, then switch with a class or attribute on `:root`:

```css
:root { /* dark by default */
  --color-bg: #0A0A0B;
  --color-surface: #111113;
  --color-text: #EDEDEF;
}
:root[data-theme="light"] {
  --color-bg: #FAFAF9;
  --color-surface: #FFFFFF;
  --color-text: #1A1817;
}
```

- Test contrast ratios in *both* modes. A muted text color that passes
  in dark mode may fail in light mode, or vice versa.

---

## 7. MOBILE-FIRST AS PHILOSOPHY, NOT CHECKLIST

Mobile-first is not a responsive breakpoint strategy. It is a
design philosophy that says: *start with the most constrained
context and expand from there.*

The constraint of mobile forces the right decisions:
- One primary action per screen (screen real estate demands it)
- Typography that works at 390px (proves the hierarchy is real)
- Spacing that breathes without wasteful excess
- Navigation that is structural, not decorative

### The phone frame — when prototyping mobile

```html
<body style="display:flex; align-items:center; justify-content:center;
             min-height:100vh; background:#111; font-family:system-ui;">
  <div class="phone-frame">
    <div class="phone-island"></div>
    <div class="phone-screen" id="app"></div>
    <div class="phone-indicator"></div>
  </div>
</body>
```

```css
.phone-frame {
  width: 390px; height: 844px;
  background: #000; border-radius: 54px;
  position: relative; overflow: hidden;
  box-shadow: 0 0 0 2px #333, 0 0 0 4px #1a1a1a,
              0 40px 80px rgba(0,0,0,0.6);
}
.phone-island {
  position: absolute; top: 14px; left: 50%;
  transform: translateX(-50%);
  width: 120px; height: 34px;
  background: #000; border-radius: 20px; z-index: 100;
}
.phone-screen {
  width: 100%; height: 100%;
  overflow-y: auto; overflow-x: hidden; position: relative;
  scrollbar-width: none;
}
.phone-screen::-webkit-scrollbar { display: none; }
.phone-indicator {
  position: absolute; bottom: 8px; left: 50%;
  transform: translateX(-50%);
  width: 134px; height: 5px;
  background: rgba(255,255,255,0.3); border-radius: 3px; z-index: 100;
}
```

### iOS measurements that make a prototype feel native

| Element | Value | Why |
|---------|-------|-----|
| Status bar / island clearance | 54px | Dynamic Island phones |
| Tab bar total height | 83px | Includes 28px safe area |
| Nav bar height | 44px | Apple HIG standard |
| Minimum tap target | 44x44px | Accessibility requirement |
| Horizontal margin | 16px minimum | Never less |
| Card padding | 16px | Standard iOS card |
| Section gap | 32px | Breathing room without waste |
| Bottom safe area | 34px | Home indicator clearance |

```css
.screen { padding-top: 54px; padding-bottom: 83px; }
.tab-bar { height: 83px; padding-bottom: 28px;
           position: fixed; bottom: 0; left: 0; right: 0; }
```

### Responsive expansion — from mobile to desktop

Single-column is not a fallback on mobile — it is the intended layout.
The design *expands* from mobile, it doesn't *collapse* from desktop.

**What stays the same across breakpoints:**
- The visual hierarchy (primary, secondary, tertiary)
- The typography scale (clamp handles the sizing)
- The spacing relationships (proportions, not absolute values)
- The emotional register

**What changes:**
- Column count: 1 on mobile, 2-3 on desktop — only when content
  genuinely benefits from side-by-side comparison
- Navigation: bottom tab bar on mobile, sidebar on desktop
- Information density: mobile shows summaries, desktop can show details
- Touch targets: 44px minimum on mobile, can be smaller on desktop
  (but keyboard focus areas should still be generous)

```css
/* Breakpoint strategy -- expand from mobile */
/* Mobile: 0-767px (default styles, no media query) */

/* Tablet: 768-1023px */
@media (min-width: 768px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
  .sidebar { display: block; width: 240px; }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
  .content { max-width: 1200px; margin: 0 auto; }
}
```

Use `clamp()` for all font sizes and spacing that need to scale:
```css
font-size: clamp(min, preferred-vw, max);
padding: clamp(24px, 6vw, 56px);
```

---

## 8. VISUAL HIERARCHY — THE NON-NEGOTIABLE PRINCIPLES

### The 3-level rule

Every screen should have exactly three levels of visual weight:
1. **Primary** — the one thing the user should do or read first
2. **Secondary** — supporting information and navigation
3. **Tertiary** — metadata, timestamps, secondary actions

If everything has the same weight, nothing stands out.
If more than three things compete for attention, the design fails.

### Whitespace as signal, not decoration

Whitespace is not empty. It is the visual signal that says
"these things belong together" or "these things are separate."

- Things that are related: 4-8px gap
- Things in the same group: 12-16px gap
- Things in different sections: 32-48px gap
- Things in different *conceptual* zones: 64px+

If two sections have the same gap as two items within a section,
the user cannot read the hierarchy.

---

## 9. MOTION AND STATE TRANSITIONS

Every transition should answer one question: *what just happened?*

### The one ambient motion rule

One ambient motion element per design maximum — a slow drift,
a breathing pulse, a scanline. Its job is to make the interface
feel *alive*, not to entertain. One well-orchestrated page-load
reveal creates more delight than scattered micro-interactions
across every element.

### Hover states — always include these

```css
/* Button -- slight lift confirms it's interactive */
.btn {
  transition: transform var(--ease-fast), box-shadow var(--ease-fast),
              background var(--ease-fast);
}
.btn:hover  { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.btn:active { transform: translateY(0);    box-shadow: none; }

/* Card -- border brightens on hover, does not move */
.card { transition: border-color var(--ease-fast); }
.card:hover { border-color: rgba(255,255,255,0.15); }

/* Row -- subtle fill, never dramatic */
.row { transition: background var(--ease-fast); }
.row:hover { background: rgba(255,255,255,0.03); }
```

### Scroll reveals — the sequential reveal pattern

Elements that appear as the user scrolls should fade in from
slightly below their resting position. Never animate from the
side (too theatrical) or fade alone (too flat).

```css
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.reveal.visible { opacity: 1; transform: translateY(0); }
```

```js
const obs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      obs.unobserve(e.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
```

### State transitions — the choreography of data

The most common source of jank in web apps is the transition between
data states: empty, loading, populated, error. Each transition should
feel intentional, not accidental.

**Empty to loading:** Show skeletons immediately. No blank screen,
no spinner delay. The skeleton communicates the *shape* of what's
coming, reducing perceived wait time.

**Loading to populated:** Content replaces skeletons with a subtle
fade. Items can stagger slightly (20-40ms between items) for lists,
but never more than 200ms total stagger. Long staggers feel slow.

**Populated to error (partial failure):** Inline error at the point
of failure. Never replace the entire screen with an error page if
only one part failed. The content that loaded successfully stays
visible.

**Populated to empty (after deletion):** The removed item collapses
smoothly (height animates to 0 with overflow hidden). The remaining
items shift up to fill the gap. Never pop — always flow.

```css
/* List item removal */
.item-exit {
  overflow: hidden;
  max-height: 80px; /* match item height */
  transition: max-height 200ms ease, opacity 150ms ease;
}
.item-exit-active {
  max-height: 0;
  opacity: 0;
}
```

### The typing animation — sequential, single cursor

When a typing animation is used, it simulates a single conscious
agent moving through the page. This means:

- **One cursor on screen at any time** — a single global element
  that physically moves between type targets
- **Sequential queue** — elements type one at a time, in DOM order,
  never simultaneously
- **Cursor stops blinking while typing** — resume blink only on completion
- **Slow, deliberate pace** — 45-60ms per character with slight
  jitter (+-15ms) creates the feel of thought, not data dump

```js
const typeCursor = document.createElement('span');
// styles: display:inline-block, width, height, background:accent, blink animation

const queue = [];
let isTyping = false;

function processQueue() {
  if (isTyping || queue.length === 0) return;
  const el = queue.shift();
  isTyping = true;

  const output = el.querySelector('.typed-text');
  output.parentNode.insertBefore(typeCursor, output.nextSibling);
  typeCursor.style.animation = 'none'; // stop blink while typing

  let i = 0;
  const text = el.dataset.text;
  function tick() {
    if (i < text.length) {
      output.textContent += text[i++];
      setTimeout(tick, 50 + (Math.random() * 30 - 15));
    } else {
      typeCursor.style.animation = 'blink 1s steps(1) infinite';
      isTyping = false;
      setTimeout(processQueue, 200); // pause between lines
    }
  }
  tick();
}
```

### Screen transitions

```jsx
function Screen({ children, isVisible }) {
  return (
    <div style={{
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 200ms ease, transform 200ms ease',
      pointerEvents: isVisible ? 'auto' : 'none',
    }}>
      {children}
    </div>
  )
}
```

---

## 10. KEY COMPONENT PATTERNS

These patterns appear in almost every prototype. The goal is
not to copy them but to understand *when* they are the right choice.

### The stat card

Use when: a single metric needs to communicate status at a glance.
Avoid when: the metric needs context that a single number can't provide.

```jsx
function StatCard({ label, value, trend, trendLabel }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-6)',
    }}>
      <div style={{ fontSize:'var(--text-sm)', color:'var(--color-text-muted)',
                    fontWeight:500, marginBottom:'var(--space-2)' }}>
        {label}
      </div>
      <div style={{ fontSize:'var(--text-3xl)', fontWeight:700,
                    color:'var(--color-text)', lineHeight:1,
                    marginBottom:'var(--space-3)' }}>
        {value}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'var(--space-1)',
                    fontSize:'var(--text-sm)', fontWeight:500,
                    color: trend > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
        <span>{trend > 0 ? '\u2191' : '\u2193'} {Math.abs(trend)}%</span>
        <span style={{ color:'var(--color-text-muted)', fontWeight:400 }}>{trendLabel}</span>
      </div>
    </div>
  )
}
```

### The form field

Use when: any user input is needed. This is the most frequently built
component and the one most often built inconsistently.

```jsx
function FormField({ label, error, hint, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-1)' }}>
      {label && (
        <label style={{ fontSize:'var(--text-sm)', fontWeight:500,
                        color:'var(--color-text)' }}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && (
        <span style={{ fontSize:'var(--text-xs)', color:'var(--color-text-muted)' }}>
          {hint}
        </span>
      )}
      {error && (
        <span style={{ fontSize:'var(--text-xs)', color:'var(--color-danger)',
                        display:'flex', alignItems:'center', gap:'var(--space-1)' }}>
          {error}
        </span>
      )}
    </div>
  )
}
```

```css
/* Input base -- used inside FormField */
.input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--text-body);
  transition: border-color var(--ease-fast);
}
.input:focus-visible {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
}
.input[aria-invalid="true"] {
  border-color: var(--color-danger);
}
.input::placeholder {
  color: var(--color-text-muted);
}
```

### The data table row

```jsx
function TableRow({ item, isLast }) {
  return (
    <div style={{
      display:'flex', alignItems:'center',
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
      gap:'var(--space-3)',
      transition:'background var(--ease-fast)', cursor:'pointer',
    }}>
      <div style={{ width:32, height:32, borderRadius:'var(--radius-full)',
                    background:'var(--color-accent)', opacity:0.8,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'var(--text-sm)', fontWeight:600, color:'#fff',
                    flexShrink:0 }}>
        {item.name[0]}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:'var(--text-sm)', fontWeight:500,
                      color:'var(--color-text)',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {item.name}
        </div>
        <div style={{ fontSize:'var(--text-xs)', color:'var(--color-text-muted)',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {item.subtitle}
        </div>
      </div>
      <span style={{ fontSize:'var(--text-xs)', fontWeight:500,
                     padding:'2px var(--space-2)', borderRadius:'var(--radius-sm)',
                     background:'rgba(255,255,255,0.06)',
                     color:'var(--color-text-muted)' }}>
        {item.badge}
      </span>
    </div>
  )
}
```

### The empty state

Empty states are the most overlooked element separating polished
from amateur. They are not a fallback — they are an opportunity.
A great empty state tells the user exactly what to do next and
makes the product feel considered.

```jsx
function EmptyState({ icon, title, description, action, onAction }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                  justifyContent:'center', textAlign:'center',
                  padding:'var(--space-16) var(--space-8)', gap:'var(--space-4)' }}>
      <div style={{ fontSize:40, opacity:0.2, marginBottom:'var(--space-2)' }}>
        {icon}
      </div>
      <div style={{ fontSize:'var(--text-md)', fontWeight:600,
                    color:'var(--color-text)' }}>
        {title}
      </div>
      <div style={{ fontSize:'var(--text-sm)', color:'var(--color-text-muted)',
                    maxWidth:320, lineHeight:'var(--leading-normal)' }}>
        {description}
      </div>
      {action && (
        <button onClick={onAction} style={{
          marginTop:'var(--space-2)',
          padding:'var(--space-2) var(--space-5)',
          background:'var(--color-accent)', color:'#fff',
          border:'none', borderRadius:'var(--radius-md)',
          fontSize:'var(--text-sm)', fontWeight:500, cursor:'pointer',
        }}>
          {action}
        </button>
      )}
    </div>
  )
}
```

### The loading skeleton

```jsx
function Skeleton({ width, height, style = {} }) {
  return (
    <div style={{
      width, height,
      borderRadius: 'var(--radius-md)',
      background: 'linear-gradient(90deg, var(--color-surface) 0%, rgba(255,255,255,0.06) 50%, var(--color-surface) 100%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite',
      ...style,
    }} />
  )
}
// @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
```

---

## 11. PROTOTYPE STRUCTURE

### The App.jsx anatomy (React)

Note: inline styles are a prototype convention for rapid iteration.
Production code uses CSS Modules (see FRONTEND-GUIDE.md Section 10
and Section 13 below for the porting path).

```jsx
// App.jsx -- complete prototype
// SCREENS: [list them]
// NAVIGATION: State-driven
// DATA: All hardcoded -- replace with real API calls
// COMMENTS: All real logic marked // TODO:

import { useState } from 'react'

const tokens = `
  :root {
    /* Full token set -- defined before any component */
    --color-bg: #0A0A0B;
    /* ... */
  }
`

const MOCK_DATA = [
  /* Replace with real API calls in implementation */
]

function Sidebar({ activeScreen, onNavigate }) {
  return <nav>{/* TODO: Active state from router */}</nav>
}

function DashboardScreen() {
  return <div>{/* TODO: Replace MOCK_STATS with real analytics */}</div>
}

export default function App() {
  const [screen, setScreen] = useState('dashboard')
  return (
    <>
      <style>{tokens}</style>
      <div style={{ display:'flex', minHeight:'100vh', background:'var(--color-bg)' }}>
        <Sidebar activeScreen={screen} onNavigate={setScreen} />
        <main style={{ flex:1 }}>
          {screen === 'dashboard' && <DashboardScreen />}
          {screen === 'members'   && <MembersScreen />}
          {screen === 'settings'  && <SettingsScreen />}
        </main>
      </div>
    </>
  )
}
```

### Navigation pattern selection

**State-driven screen switching** — for click-through demos and
stakeholder review. The person should feel like they're using an app.

**Scrollable stacked layout** — for design review documents where
all screens are visible simultaneously for annotation and comparison.

**Stepper / wizard** — for enforced-sequence flows: onboarding,
checkout, setup. Progress indication is mandatory.

**List to detail drill-down** — when a collection screen navigates
to a full detail screen (not a modal).

---

## 12. THE TODO COMMENT CONVENTION

Every section representing real functionality gets a structured
TODO so implementation handoff is unambiguous.

```jsx
// TODO: [COMPONENT] Replace with real data
// TODO: [API] Call GET /api/members?page={page}&search={search}
// TODO: [STATE] Add error and loading states
// TODO: [AUTH] Check user permissions before showing this action
// TODO: [ANALYTICS] Track event on form submit
// TODO: [SPLIT] Extract into features/members/components/MemberTable.tsx
// TODO: [A11Y] Add aria-label, keyboard navigation, screen reader text
```

Tags: `[COMPONENT]` `[API]` `[STATE]` `[AUTH]` `[ANALYTICS]` `[SPLIT]` `[A11Y]`

---

## 13. PORTING TO PRODUCTION CODEBASE

```
App.jsx prototype              ->   React codebase
-----------------------------------------------------
Inline <style>{tokens}</style> ->   src/styles/tokens.css
MOCK_DATA constants            ->   src/features/[domain]/api.ts
Component functions            ->   src/features/[domain]/components/
Inline JSX styles              ->   ComponentName.module.css
Hardcoded state                ->   TanStack Query + tRPC
TODO: [AUTH] comments          ->   tRPC middleware / session guards
TODO: [API] comments           ->   tRPC procedure implementations
TODO: [A11Y] comments          ->   Semantic HTML, aria attrs, focus management
```

Design tokens stay as CSS custom properties — never TypeScript
constants. This keeps dark/light mode and theme switching at the
CSS layer, without re-renders.

Add one comment block per major component before handoff:

```jsx
/**
 * MembersTable
 *
 * Displays a paginated, searchable list of workspace members.
 *
 * Data dependencies:
 *   - GET /trpc/member.list (search, page, filter)
 *   - POST /trpc/member.invite
 *   - DELETE /trpc/member.remove
 *
 * State: search (string), page (number), filter ('all'|'admin'|'member')
 * Split into: src/features/members/components/MembersTable.tsx
 */
```

---

## 14. DESIGN SELF-CRITIQUE — THE REVIEW BEFORE SHIPPING

The five dissections (Section 2) teach you how to analyze other
people's work. This section teaches you how to critique your own.

### The inevitability test

Look at the finished design and ask: **does this feel inevitable?**

Inevitable means: you cannot imagine it being any other way.
Every element is where it is because that's where it belongs,
not because that's where you put it. If something feels placed
rather than discovered, it isn't right yet.

### The subtraction test

Go through every element on the screen — every label, every icon,
every border, every shadow, every piece of padding — and ask:
**if I removed this, would the design break?**

If removing an element breaks the design, it earned its place.
If removing it makes no difference or makes the design *better*,
it was decoration, not design. Remove it.

### The hierarchy test

Blur your eyes or step back from the screen. With the text
illegible, can you still identify:
1. Where the eye goes first?
2. Where the primary action is?
3. Where one section ends and another begins?

If the hierarchy disappears when you can't read the text,
the hierarchy is carried by content, not by design. Content
changes; the hierarchy should not.

### The stranger test

Show the design to someone who has never seen it. Give them
no context. Ask them:
1. What is this product?
2. What should you do first?
3. How does this make you feel?

If their answers don't match your three questions (Section 0),
the design is communicating something other than what you intended.

### The consistency audit

Check every instance of the same element type:
- Are all buttons the same height, padding, and radius?
- Are all cards the same border treatment?
- Are all status indicators the same pattern (color + icon, or color + text)?
- Is the spacing between elements consistent within the same context?

Inconsistency signals to the user (consciously or not) that the
product was not carefully made.

---

## 15. COMPLETION CHECKLISTS

### Before calling any prototype done

- [ ] Three questions answered (what is this, emotional register, done-feeling)
- [ ] Token set defined on `:root` — no hardcoded values anywhere
- [ ] Logo-to-system principle applied if a mark exists
- [ ] Typography choices justified conceptually, not just aesthetically
- [ ] Accessibility: focus-visible on all interactive elements
- [ ] Accessibility: all inputs have associated labels
- [ ] Accessibility: color is not the sole indicator of meaning
- [ ] One ambient motion element maximum
- [ ] All hover states transition (no hard jumps)
- [ ] State transitions defined (empty, loading, populated, error)
- [ ] Empty states exist for all list/table screens
- [ ] Primary action is visually dominant — the eye goes there first
- [ ] Self-critique: subtraction test passed (nothing removable)
- [ ] TODO comments in place for all real logic

### Web app additional checks

- [ ] Sidebar: 220-260px, fixed position
- [ ] Content area: `max-width: 1200px`, centered
- [ ] Works at 1024px viewport width (minimum)
- [ ] Text truncates with `...` on overflow
- [ ] Status indicators consistent across all instances
- [ ] Form fields have error states, not just valid states
- [ ] Keyboard navigation works for all primary flows

### Mobile app additional checks

- [ ] Phone frame at 390x844px
- [ ] 54px top clearance (Dynamic Island)
- [ ] 28-34px bottom safe area padding
- [ ] All tap targets 44x44px minimum
- [ ] 16px minimum horizontal margins
- [ ] Tab bar 83px total height
- [ ] All content scrollable where needed
- [ ] All screens reachable from navigation

---

## 16. CSS RESET

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button   { font: inherit; cursor: pointer; border: none; background: none; }
input,
textarea { font: inherit; }
a        { color: inherit; text-decoration: none; }
img      { max-width: 100%; display: block; }

:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
```

---

## THE UNDERLYING TRUTH

Every section of this document is in service of one thing:

**Design is an act of listening first.**

Before the font. Before the color. Before the layout.
Listen to what the thing actually is, what it means to the
person using it, and what it should feel like when it works.

The rest is craft in service of that listening.
The craft matters — execution is what makes the thinking real.
But craft without listening produces competent imitations,
and the world has enough of those.

Listen first. Then build something inevitable.
