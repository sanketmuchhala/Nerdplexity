> Historical proposal, superseded on 2026-09-10 by [the Nerdplexity workbench plan](implementation-plan.md). This document contains unrelated Merchant branding and incorrect implementation assumptions. Use the linked plan for current work.

# 1) Phase 2 Summary
- **Goal statement**: Redesign the existing LLM Observability dashboard into a modern, Merchant Blue-anchored interface with improved grid layouts, clear component separation, and functional real-time metrics polling.
- **What stays unchanged**: Multi-provider LLM support, API key input, model selection, streaming chat, and the existing routing flows (e.g., `/chat`, `/settings`, and core prompt engineering logic).
- **What changes**: The UI layout architecture of the main dashboard, the styling of the event tables, the global app theme tokens inside the Tailwind configuration, and the introduction of a real-time polling mechanism for observability KPIs.

# 2) Inputs Used
- `nerdplexity.md`
- `research/Nerdplexity LLM Observability and Hallucination Risk Dashboard.pdf` (Note: File located in repo; PDF parsed via context title).
- `packages/web/src/promptops/Dashboard.tsx`
- `packages/web/src/promptops/EventsPage.tsx`
- `packages/web/src/hooks/useTheme.ts`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/App.tsx`
- `packages/web/src/components/ui/` specific files (e.g. `Button.tsx`).

# 3) Repo Reality Map
- **Frontend entry, routing, theming locations**:
  - Entry/Routing: `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, router at `packages/web/src/promptops/PromptOpsLanding.tsx`.
  - Theming: `packages/web/src/hooks/useTheme.ts`, `packages/web/index.css` (assuming standard setup).
- **Dashboard related pages/components**:
  - `packages/web/src/promptops/Dashboard.tsx`
  - `packages/web/src/promptops/EventsPage.tsx`
  - `packages/web/src/promptops/MetricsDashboard.tsx`
  - `packages/web/src/promptops/components/Cards.tsx`
- **Event card + vendor rendering logic**:
  - *Not found in repo*. (Specific vendor/event cards do not currently exist; LLM provider data is rendered in a generic `Table` inside `Dashboard.tsx`).
- **Tracking + refresh timestamp logic**:
  - `packages/web/src/promptops/Dashboard.tsx` (Current state: static `useEffect` on mount. Real-time polling is *not found in repo*).
  - `packages/web/src/promptops/EventsPage.tsx` (Static `useEffect`).
- **Branding assets and page titles/meta**:
  - `packages/web/index.html` (for `<title>` and meta tags).
  - Explicit logo components: *Not found in repo* outside of inline layout text inside `packages/web/src/components/Sidebar.tsx` and `Dashboard.tsx`.

# 4) Phase 2 Deliverables
- **UI redesign deliverables**:
  - AppShell: Updated `<Sidebar />` (`Sidebar.tsx`) with Merchant Blue styling and cohesive active states.
  - Dashboard: 12-column responsive grid layout inside `<PromptAnalyticsDashboard />`.
  - Event/Vendor cards: Workaround for missing logic -> Extract generic table rows into new `<ProviderCard />` and `<EventLogCard />` components representing LLM vendors and discrete prompts.
  - Empty/Loading/Error states: CSS skeleton loaders for `Charts.tsx` during fetch, and standardized illustrated `<EmptyState />` for zero-event scenarios.
- **Branding deliverables**:
  - Logo concept spec: Hexagonal geometric node intersecting a rising chart line in Merchant Blue.
  - Color tokens: Extending tailwind with `merchant-blue` (`#0B4F6C`).
  - Typography scale: Unified Inter/Roboto scale mapping to strictly semantic tailwind classes without inline overrides.
- **Dashboard visualization upgrades**:
  - Refactoring `components/Charts.tsx` (`LineChart`, `BarStack`, etc.) to consume the new color palette using existing data primitives.

# 5) Design System Implementation Plan
- **Exact Tailwind/shadcn changes needed**:
  - Path: `packages/web/tailwind.config.js` (or inline config in Vite). Extend `theme.colors` with `{ merchant: { blue: '#0B4F6C', light: '#1A7A9E', dark: '#063045' } }`. Updates to `packages/web/index.css` global vars.
- **Token naming and mapping rules**:
  - Replace arbitrarily injected `lantern-glow`, `bg-lantern-600` with `bg-merchant-blue`.
  - Standardization: Use `text-neutral-100` for primary type, `text-neutral-400` for secondary.
- **Component conventions**:
  - Create components inside `packages/web/src/promptops/components/` utilizing PascalCase (`ProviderCard.tsx`).
  - Prop patterns: Use strictly typed exported interfaces (`export interface ProviderCardProps { ... }`) to avoid `<any>` casts present in legacy code.

# 6) Dashboard Redesign Spec
- **New information architecture**:
  1. Top Navigation & Freshness Status Bar
  2. Aggregated Top KPIs (Total Calls, Helpful Rate, Avg Latency)
  3. LLM Provider (Vendor) Status Cards
  4. Latency & Context Bloat Charts
  5. Recent Prompt Events Feed
- **Desktop layout and mobile layout**:
  ```text
  [Desktop Wireframe]
  [Sidebar]  [ Top Nav | Last Refreshed: X ago ]
  [ 250px ]  [ KPI 1 ] [ KPI 2 ] [ KPI 3 ] [ KPI 4 ]
             [ Provider Card ] [ Provider Card ] [ Provider Card ]
             [ Chart: Latency        ] [ Chart: Bloat risk       ]
             [ Event Feed (Table/Cards)                          ]

  [Mobile Wireframe]
  [ Hamburger | Last Refreshed ]
  [ KPI 1 ]
  [ KPI 2 ]
  [ Provider Card 1 ]
  [ Chart: Latency ]
  [ Event Feed ]
  ```
- **Component tree proposal**:
  - `<PromptAnalyticsDashboard />`
    - `<AnalyticsNav title="Analytics" lastRefreshed={timestamp} />`
    - `<KPIGrid kpis={mainKpis} />`
    - `<ProviderCardsGrid data={modelCompareData} />`
    - `<ChartsSection latSeries={latSeries} bloatSeries={rows} />`
    - `<EventFeed rows={rows} />`
- **State rules**:
  - Loading: `<div className="animate-pulse bg-neutral-800 rounded-lg h-32 w-full"></div>`.
  - Empty: Text block "No API telemetry found." with a button to trigger a test query.
  - Error: Red border state rendering `X Error: Network Failed` allowing manual retry.
  - Retry: Button strictly invoking `getEvents()`.

# 7) Time and Freshness Logic Fix
- **Identify current code**: `packages/web/src/promptops/Dashboard.tsx` (lines 25-46) fetches `getEvents()` inside an empty dependency array `useEffect`.
- **Define new rules**:
  - Establish a standard `setInterval` polling hook. No new dependencies; rely on standard React `useEffect`/`useRef`.
  - **"searched X minutes ago"**: A local state UI tick `Math.floor((Date.now() - lastFetchTime) / 60000)`.
  - **"refreshed X minutes ago"**: The global dashboard equivalent representing the latest poll of `getEvents()`.
  - **vendor-level last_updated vs event-level last_updated**: Extract the maximum `ts` (timestamp string) from events mapped to a specific `e.provider`. The global event-level metric is the exact `e.ts` of the latest row.
- **Test cases and sample timestamps**:
  - If `lastFetchTime` is `Date.now() - 3000`, display "just now".
  - If `lastFetchTime` is `Date.now() - 120000`, display "2 minutes ago".
  - Disconnect network, ensure previous analytics stay mounted while top nav shows "Refresh failed: 5 mins ago".

# 8) Logo and Brand System Spec
- **3 logo directions (Do not copy Perplexity)**:
  1. *Hexa-Node*: A flat geometric hexagon symbolizing a centralized server node, intersected horizontally by a sparkline (Merchant Blue).
  2. *Data Monolith*: Three staggered isometric rectangles layered against a dark background emitting a blue geometric shadow.
  3. *Pulse Typography*: Custom sans-serif letters for 'Nerdplexity' where the 'N' stems act as a vertical bar chart.
- **Construction ideas**: Clean vector geometries conforming to a 24x24 px inner safe area, 1.5px consistent stroke weights, pure semantic `#0B4F6C` color logic.
- **Where logo appears in app**: Top left header of `packages/web/src/components/Sidebar.tsx`, landing hero `<header>` in `packages/web/src/promptops/PromptOpsLanding.tsx`.
- **Favicon and metadata plan**: Edit `<title>PromptOps Dashboard</title>` to `<title>Observability | Merchant</title>` in `packages/web/index.html`. Add an `<link rel="icon" type="image/svg+xml" href="/merchant-icon.svg" />` (*File to be created*).

# 9) Phased Engineering Plan
- **2.0 Baseline and screenshots**
  - *Scope*: Document the starting visual state.
  - *Exact file touch list*: Write to `plan/baseline.md`.
  - *Step-by-step tasks*: Run `npm run dev` and screenshot legacy dashboard routes.
  - *Acceptance criteria*: Baseline imagery is recorded.
  - *QA checklist*: Current streaming API functions correctly.
  - *Rollback strategy*: N/A.
- **2.1 Tokens and theming**
  - *Scope*: Inject Merchant Blue.
  - *Exact file touch list*: `packages/web/index.css`, `packages/web/src/hooks/useTheme.ts`, `packages/web/tailwind.config.js` (if exposed).
  - *Step-by-step tasks*: Define global CSS variables `--color-merchant-blue: 11 79 108`. Swap `lantern` references in `useTheme.ts`.
  - *Acceptance criteria*: Tailwind compiles classes like `text-merchant-blue`.
  - *QA checklist*: Verify dark mode override functionality.
  - *Rollback strategy*: `git revert` CSS variable commits.
- **2.2 AppShell + nav**
  - *Scope*: UI update to main navigation framing.
  - *Exact file touch list*: `packages/web/src/components/Sidebar.tsx`, `packages/web/src/promptops/components/AnalyticsNav.tsx`.
  - *Step-by-step tasks*: Remove inline custom colors; apply base grids; wire the new Logo SVG component.
  - *Acceptance criteria*: Sidebar conforms to updated padding layout specs.
  - *QA checklist*: Mobile hamburger menu toggles correctly.
  - *Rollback strategy*: Revert Sidebar.tsx.
- **2.3 Component refactors (EventCard/VendorRow workaround)**
  - *Scope*: Abstraction of the complex data tables.
  - *Exact file touch list*: Create `packages/web/src/promptops/components/ProviderCard.tsx`, create `packages/web/src/promptops/components/EventLogCard.tsx`, edit `packages/web/src/promptops/components/Cards.tsx`.
  - *Step-by-step tasks*: Build generic card wrappers passing down `e.result.status`, `e.provider`, and `e.usage` values.
  - *Acceptance criteria*: Storybook or isolated rendering showcases accurate event rendering.
  - *QA checklist*: Check text cutoff on long prompt spans.
  - *Rollback strategy*: Delete new components; restore `Table` usage.
- **2.4 Dashboard page rebuild**
  - *Scope*: The primary view logic combining previous phases.
  - *Exact file touch list*: `packages/web/src/promptops/Dashboard.tsx`, `packages/web/src/promptops/EventsPage.tsx`.
  - *Step-by-step tasks*: Strip out the hard-coded 6x5 CSS grids. Implement `<ProviderCardsGrid>`. Introduce `useEffect` polling timer.
  - *Acceptance criteria*: Dashboard layout strictly matches the grid specification and updates dynamically over time without page reloading.
  - *QA checklist*: Let page idle for 2 minutes to confirm timestamp updates ("2 mins ago").
  - *Rollback strategy*: `git checkout -- packages/web/src/promptops/Dashboard.tsx`.
- **2.5 Polish and a11y**
  - *Scope*: Cleanup and accessibility markup.
  - *Exact file touch list*: `packages/web/index.html`, `packages/web/src/components/ui/Button.tsx`.
  - *Step-by-step tasks*: Set `aria-live="polite"` on the freshness string. Apply offset `ring` utility to Button focus states. Update index metadata.
  - *Acceptance criteria*: 100% standard keyboard navigation support across dashboard.
  - *QA checklist*: Screenreader gracefully announces the last refreshed state changes.
  - *Rollback strategy*: N/A (Atomic commits per element).

# 10) Definition of Done
- **No regression list**: Chat completion streaming functionality unchanged; existing settings and model selection unchanged.
- **Visual consistency checklist**: Codebase is clean of `lantern-` prefixes; padding scales mathematically adhere to `rem` standards (e.g. `p-4`, `p-6`). All arbitrary hex codes replaced with Tailwind mapping rules.
- **Performance checks**: Bundle sizes stay constant (no new dependencies added). `React DevTools` registers no unnecessary deeply nested re-renders of the Chart layer due to the 30-second polling pulse.
- **Accessibility checks**: Keyboard tabbing seamlessly traverses top navigation, KPIs, Provider cards, and Charts without skipped indices. Visual focus outline is present and meets contrast requirements against `neutral-950`.
