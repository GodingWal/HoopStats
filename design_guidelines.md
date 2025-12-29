# NBA Sports Betting Analytics - Design Guidelines

## Design Approach: Data-First Analytics Dashboard

**Selected Framework:** Carbon Design System principles adapted for sports analytics, emphasizing data density, readability, and analytical efficiency.

**Design Philosophy:** This is a professional analytical tool where data accuracy, quick scanning, and decision-making speed are paramount. Visual design should enhance data comprehension, not distract from it.

---

## Typography System

**Font Stack:**
- Primary: 'Inter' (body text, labels, general UI)
- Data/Stats: 'JetBrains Mono' or 'IBM Plex Mono' (numerical data, statistics)
- Headings: 'Inter' with increased letter-spacing

**Type Scale:**
- Hero Stats: 32px (bold, tabular numbers)
- Section Headers: 20px (semibold)
- Card Titles/Player Names: 16px (medium)
- Body/Labels: 14px (regular)
- Meta/Secondary: 12px (regular)
- Micro Data: 10px (uppercase, tracked)

---

## Layout System

**Spacing Primitives:** Use Tailwind units: 2, 4, 6, 8, 12, 16, 20, 24 (focus on 4, 8, 16 for consistency)

**Grid Structure:**
- Main container: max-w-7xl with px-4 md:px-8
- Dashboard cards: gap-6 for breathing room
- Data tables: Compact spacing (p-3, gap-2) for density
- Stats grids: 3-4 columns on desktop, stack on mobile

**Layout Patterns:**
- Top navigation bar with search/filters (sticky)
- Sidebar for quick player/team selection (collapsible on mobile)
- Main content area: Card-based layout for different data modules
- Multi-column stats displays where appropriate (not excessive)

---

## Component Library

### Navigation
- Persistent top bar with logo, search, date selector, user menu
- Left sidebar for player list/favorites (sticky, scrollable)
- Breadcrumbs for navigation context

### Player Cards
- Compact card showing headshot, name, team, key stats
- Expandable to show full profile
- Visual indicators for trending stats (↑↓ arrows)
- Quick-action buttons (compare, favorite, view matchup)

### Data Visualization
- **Sparklines:** Mini line charts for trend visualization (80x24px)
- **Hit Rate Badges:** Color-coded percentage indicators
  - Green (≥80%): High confidence
  - Yellow (60-79%): Moderate
  - Orange (40-59%): Lower confidence  
  - Red (<40%): Rare occurrence
- **Stat Comparison Tables:** Clean, scannable rows with alternating subtle backgrounds
- **Recent Games Timeline:** Horizontal scrollable cards

### Stats Display
- **Stat Badges:** Small cards with label, value, hit rate, trend arrow
- **Comparison Grids:** Side-by-side player/team stats
- **Heat Maps:** For hit rate visualization across different lines
- **Home/Away Splits:** Side-by-side comparison cards

### Forms & Inputs
- Search bar with autocomplete (player/team suggestions)
- Date range picker for historical analysis
- Filter chips (position, team, stat category)
- Toggle switches for data views (season avg vs. last 10 games)

### Data Tables
- Sortable columns (click header to sort)
- Sticky headers on scroll
- Highlight row on hover
- Responsive: stack on mobile, horizontal scroll on tablet

---

## Visual Hierarchy

**Primary Focus:** Player stats, hit rates, recent performance
**Secondary:** Historical trends, matchup data
**Tertiary:** Meta information (dates, opponent records)

**Information Architecture:**
1. Player header (name, team, photo)
2. Key stats dashboard (PTS, REB, AST, PRA with hit rates)
3. Recent form (last 5-10 games trend)
4. Matchup analysis (vs. specific team)
5. Advanced analytics (teammate impact, home/away splits)

---

## Interactions

**Minimal Animations:**
- Smooth transitions on card expansion (200ms ease)
- Fade-in for data loading states
- Subtle hover states (background opacity change)
- **NO** distracting scroll effects or unnecessary motion

**Interactive Elements:**
- Click player card → expand full profile
- Click stat badge → show detailed breakdown
- Hover table row → highlight, show quick actions
- Click chart → drill down into detail view

---

## Images

**Player Headshots:**
- 80x80px circular headshots in cards
- 200x200px in expanded player view
- Fallback: Team logo or generic silhouette

**Team Logos:**
- 32x32px next to player names
- 48x48px in matchup comparisons

**Hero Section:**
- NO large hero image (data dashboard doesn't need it)
- Instead: Quick stats overview banner with today's featured players/games

---

## Responsive Behavior

**Desktop (1024px+):** 
- Sidebar + main content
- Multi-column stat grids (3-4 columns)
- Full data tables

**Tablet (768-1023px):**
- Collapsible sidebar
- 2-column stat grids
- Horizontal scroll tables

**Mobile (<768px):**
- Hidden sidebar (menu icon)
- Single column stacks
- Card-based stat displays
- Simplified data views

---

## Accessibility

- High contrast text (AAA rating)
- Keyboard navigation throughout
- Screen reader labels for all data points
- Focus indicators on interactive elements
- Consistent form input styling with labels

---

## Key Design Principles

1. **Data Clarity:** Every element serves the purpose of quick, accurate information consumption
2. **Scanability:** Use consistent patterns, alignment, and spacing for rapid data scanning
3. **Contextual Information:** Always show context (vs. season avg, trend indicators)
4. **Professional Restraint:** Avoid flashy elements; this is a serious analytical tool
5. **Performance:** Optimize for fast data loading and rendering (critical for live betting scenarios)