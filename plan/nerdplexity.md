# 1. Phase 2 Goals
* Clean and consolidate the existing "PromptOps / Nerdplexity" dashboard into a cohesive layout.
* Modernize the brand by anchoring the primary color system around a core "Merchant blue" while maintaining the existing dark mode neutral palettes.
* Refactor components to reduce duplicated tailwind classes and standardize spacing and typography.
* Implement robust real-time freshness logic for observability metrics.
* Enhance mobile, tablet, and desktop responsiveness by defining unified grid sizes and breakpoints.

# 2. Current State Repo Map
* **`packages/web/src/promptops/`**
  * `Dashboard.tsx`: Main Legacy Analytics View and entry point for LLM observability.
  * `EventsPage.tsx`: Detailed data table of all prompt events.
  * `MetricsDashboard.tsx`: Modular dashboard metrics component.
  * `PromptOpsLanding.tsx`: Landing router combining navigation states.
  * `components/Cards.tsx`: Reusable `<Table>` rendering component.
  * `components/AnalyticsNav.tsx`: Top navigation for dashboard switches.
* **`packages/web/src/components/`**
  * `ui/`: Standard UI primitives (`Button.tsx`, `Badge.tsx`, `CodeBlock.tsx`, `Input.tsx`, `Modal.tsx`).
  * `Sidebar.tsx`: Main application sidebar navigation.
* **`packages/web/src/hooks/`**
  * `useTheme.ts`: Implements dark/light theme switching via `localStorage` and `data-theme`.
* **`packages/server/src/`**
  * Contains core API endpoints and integrations; specific tracking routes need mapping.

# 3. Problems Observed
* **Inconsistent components**: Hard-coded inline layout widths and ad-hoc class lists across `packages/web/src/promptops/Dashboard.tsx` (`mx-auto max-w-screen-2xl p-6`). UI components are physically split between `promptops/components/` and `components/ui/`.
* **Mixed styling**: The dashboard relies heavily on absolute arbitrary colors (e.g., `text-green-400`, `bg-neutral-950`) mixed with domain-specific utility classes like `lantern-glow-strong` and `bg-lantern-600`.
* **Timestamp or refresh logic issues**: `Dashboard.tsx` and `EventsPage.tsx` both fetch telemetry strictly on component mount via `useEffect` -> `getEvents()`. There is no actual freshness interval or real-time web-socket fallback observed, making the dashboard feel static after load.

*(Note: Merchant event ticketing, event cards, and vendor tracking logic were **not found in repo scan**. The codebase is currently scoped as an LLM observability layer.)*

# 4. Target Design System

### 4.1 Brand
* **Logo concept options**:
  1. A minimalist hexagonal node intersecting a glowing chart line, colored in core Merchant Blue.
  2. A stylized monolithic 'N' constructed from overlapping transparent data blocks.
  3. A sleek, typographic vector icon with a pulse wave replacing the horizontal bar of an 'H' or 'A'.
* **Wordmark rules**: Requires a 24px exclusion zone on all sides. Must lock to pure white (`#FFFFFF`) on dark surfaces and core Merchant Blue (`#0B4F6C`) on light backgrounds.
* **Color tokens**:
  * Action/Primary: Core Merchant Blue (`#0B4F6C`)
  * Surface Main: `bg-neutral-950`
  * Surface Card: `bg-neutral-900`
  * Border: `border-neutral-800`
  * Text Primary: `text-neutral-100` 
  * Text Secondary: `text-neutral-400`
  * Semantic: Red for errors (`text-red-400`), Green for success (`text-green-400`), Yellow for warnings.
* **Typography scale**: Sans-serif stack (Inter/Roboto). `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px), `text-xl` (20px), `text-2xl` (24px), `text-3xl` (30px). Use font weights strictly for hierarchy (`font-bold` for metric values, `font-medium` for headers).
* **Icon rules**: 24x24 pixel grid bounding box. 1.5px consistent stroke weight.

### 4.2 UI primitives
* **Grid system**: Unified 12-column grid structure utilizing standard viewport breakpoints (`sm`, `md`, `lg`, `xl`, `2xl`). Global base padding of `1.5rem` (24px) for dashboard views.
* **Card system**: (Vendor/Tracked Cards **not found in repo scan**). Metric Cards will use flat borders, zero drop-shadow in dark mode, and an inner padding of `1.5rem`.
* **Components**: Buttons, Inputs, Tooltips, and Modals mapped natively to Shadcn/ui configurations referencing our `tailwind.config` generic color targets.
* **Empty states**: Skeletons for charts during fetch, and standardized illustrated empty states (e.g., in `EventsPage.tsx:111` replacing the simple text fallback).

### 4.3 Dashboard information architecture
* **Panels and sections**: Strict top-level navigation, a secondary filter bar, primary top level KPIs, middle tier charts (latency/bloat), and an underlying data table.
* **Default layout**: Desktop defaults to a fixed left sidebar with fluid-width scrolling main content. Mobile shifts to a stacked layout with a hamburger menu.
* **Interaction rules**: Hover states uniformly apply a `10%` lightness increase to interactive surfaces. Focus rings must be explicit, 2px solid Merchant Blue offset by 2px.

# 5. Implementation Plan

* **Phase 2.0 Audit**: Audit tailwind usage in `packages/web`.
  * *Scope*: Scan all `.tsx` and define custom themes.
  * *Files*: `packages/web/tailwind.config.js` (if exists), `packages/web/src/hooks/useTheme.ts`.
* **Phase 2.1 Tokens**: Inject core Merchant blue palette and semantic variables.
  * *Scope*: Redefine `lantern-` classes to the new variable system.
  * *Step by step*: Update CSS variables, enforce new `useTheme` structure.
* **Phase 2.2 Components**: Refactor Shadcn primitives.
  * *Scope*: Port `components/ui/` (`Badge.tsx`, `Button.tsx`).
  * *Acceptance Criteria*: Storybook/isolated renders show correct hover/focus states.
* **Phase 2.3 Dashboard Rebuild**: Grid refactor.
  * *Scope*: Redesign `packages/web/src/promptops/Dashboard.tsx` to cleanly handle mobile viewpoints.
  * *File Touch List*: `Dashboard.tsx`, `AnalyticsNav.tsx`, `components/Cards.tsx`.
* **Phase 2.4 Tracking UI**: Dynamic refreshing logic.
  * *Scope*: Add SWR-style live-update loops replacing the naked `useEffect`.
  * *File Touch List*: `EventsPage.tsx`, `Dashboard.tsx`.
* **Phase 2.5 Polish and QA**: 
  * *Scope*: Mobile responsive sanity check and accessibility audits.
  * *QA*: Manual checklist across major browsers.
  * *Rollback plan*: Revert to the old `Legacy Analytics View` components via Git tagging.

# 6. Specific UI rewrites

### a) DashboardPage layout
* **Component tree proposal**: `<DashboardContainer><AnalyticsNav /><KPIBar /><MetricsGrid /><ChartSection /></DashboardContainer>`
* **Props contract**: `interface DashboardProps { initialData: DashboardEvent[]; isLoading: boolean; error: string | null; }`
* **State rules**: Centralized fetching logic via a context or SWR hook.
* **Accessibility notes**: ARIA roles for regions and charts.

### b) Event card layout with vendors list
* **not found in repo scan**

### c) Vendor card showing price, min/max, last refresh
* **not found in repo scan**

### d) Search history timeline
* **not found in repo scan**

### e) Tracked events view and actions
* **not found in repo scan** (Current `EventsPage.tsx` acts as the raw event log).

# 7. Timestamp and freshness logic plan

* **Current logic**: In `packages/web/src/promptops/Dashboard.tsx` and `EventsPage.tsx`, the logic is an asynchronous fetch `getEvents()` nested inside an empty dependency `useEffect`, meaning it fires strictly on component mount. There are no timestamps for "last refreshed".
* **Correct logic**: Implement a background polling interval or cache invalidation that explicitly populates a `lastRefreshed` state variable. Present this at the top of the dashboard: `Last refreshed: 12 seconds ago`.
* **Data source of truth**: The local analytics cache provided by the Express backend (`getEvents()` route).
* **Test cases**: 
  * Verify UI shows "refreshing..." skeleton over charts when the interval triggers.
  * Test network disconnects handle gracefully without clearing current dashboard state.

# 8. Definition of Done
* **Visual consistency checks**: Sizing, typography, and color tokens cleanly match Figma/Design specs without inline arbitrary values.
* **Lighthouse targets**: > 95 Performance, > 95 Accessibility, > 95 Best Practices.
* **No regression list**: Data tables sort correctly, charts render without NaNs, and all historic LLM prompts still securely display.
* **Screenshot list for PR review**: 
  * Desktop Light/Dark mode.
  * Mobile Light/Dark mode.
  * Search/Event table expanded view.
