# UI Redesign Plan: Amma Odisha

## Design Direction
Amma Odisha will become a polished, app-like civic reporting surface: live map first, clear data proof, one dominant reporting action, and compact accountability context.

The visual identity will stay Bhubaneswar-focused with a strong red primary action, neutral civic surfaces, severity accents, and green cleanup/status cues.

## Layout Strategy
- Public shell uses fixed full-screen map/list content.
- Header sits at the top with brand, about, changelog, and compact utility actions.
- A slim civic notice gives context without blocking map use.
- Filters and map/list toggle are grouped into a compact control dock.
- Stats become small proof pills rather than a dashboard block.
- Bottom action bar contains the main `Report Garbage` CTA and a secondary `Insights` action.
- Insights opens as a focused sheet with active/resolved counts, worst wards, and accountability proof.

## Design System Proposal
- Tokens: primary red, deep red, civic green, amber/orange severity, neutral text, muted text, border, surface, elevated surface, overlay, shadows, safe-area spacing, and z-index layers.
- Typography: sans UI with strong headings, compact metadata labels, and monospace counters.
- Components: `app-button`, `app-chip`, `app-card`, `app-sheet`, `app-field`, `status-pill`, `metric-card`, `bottom-action-bar`.
- Radius: max 8px for buttons/cards, with sheets allowed slightly larger only where needed for platform feel.
- Interaction states: visible focus rings, active press states, disabled state, and hover states on pointer devices.

## Page And Component Mapping
- `PublicApp`: keep state orchestration, but replace the overloaded bottom sheet with header, controls, stats, bottom action bar, and insights sheet.
- `ReportForm`: reorganize into mobile-first sections with sticky submit action and clear validation.
- `ReportDetail`: elevate photo/status, ward context, metrics, MLA/MP accountability, and action grid.
- `ProfileSheet`: improve summary metrics and top locations with feed-style report rows.
- `TelegramToast`: make compact and non-overlapping, hidden while report form or major modal is active.
- `AdminPanel`: preserve behavior and lightly inherit shared tokens without broad refactor.

## Responsive Strategy
- 360-640px: full map/list content, compact top controls, stats scroll if needed, bottom CTA always visible.
- 641-1023px: wider sheets, two-column form options, map remains dominant.
- 1024px and up: controls float with more breathing room, insights/detail/form sheets stay constrained and readable.
- Use safe-area insets for top and bottom UI.
- Avoid horizontal overflow, fixed-height traps, overlapping toast/CTA, and hidden submit actions.

## Implementation Approach
- Write documentation first.
- Refactor `PublicApp.tsx` presentation structure without changing backend calls or route behavior.
- Replace `src/styles/index.css` public UI styles with a clearer tokenized system while preserving admin classes.
- Update e2e tests for map, list, form, admin, and deep links.
- Run lint, unit tests, build, e2e, and responsive screenshot checks.
