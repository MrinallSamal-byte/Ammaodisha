# Current Site Audit: Amma Odisha

## Current Routes And Surfaces
- `/`: public map app with report markers, ward boundaries, filters, report form, report detail, profile sheets, intro overlay, about sheet, changelog, and community toast.
- `/report/:id`: opens the matching report detail sheet.
- `/ward/:id`: focuses the ward and opens a ward profile sheet.
- `/mla/:id` and `/mp/:id`: open representative profile sheets.
- `/admin`: moderation login and report review queues.

## Current Strengths
- The product already has the right core shape: map-first reporting.
- Backend and fallback data flows are mature enough to preserve.
- Reports include photo, ward, severity, category, status, upvotes, and cleanup verification.
- Civic accountability is already modeled through wards, MLAs, and MP records.
- Existing smoke, unit, build, and lint checks pass at baseline.

## UX Weaknesses
- The main public UI behaves like a map with a dashboard bolted on, rather than one integrated product surface.
- The bottom sheet carries too many jobs at once: intro copy, filters, refresh, search, CTA, worst wards, and count feedback.
- `Report Garbage` is visible, but competes with filters, toast, and dashboard content on small screens.
- Insights and worst-ward data are useful, but they are too prominent by default and reduce map space.
- Intro and community prompt can overlap the panel and CTA on mobile.
- The list mode is functional but should feel like a dedicated issue feed.

## Visual And System Issues
- Design tokens exist only partially in `src/styles/index.css`.
- Button, card, sheet, chip, metric, and input styles are repeated through class groups instead of a clearer system.
- Radius values are inconsistent and often exceed the requested tighter product style.
- Cards and controls use similar white surfaces without enough hierarchy between primary, secondary, and tertiary actions.
- The visual language is close to the reference but needs stronger Amma Odisha ownership.

## Responsiveness Issues
- Mobile top controls, stats, and map/list toggle crowd the same area.
- The bottom sheet can hide important map content and stack awkwardly with toast prompts.
- Form content is dense on small screens and the submit action can sit below a long scroll.
- Some overlays rely on fixed positioning that can collide across phone heights.
- List mode needs clearer full-screen mobile behavior with reliable bottom action spacing.

## Accessibility Issues
- Focus styles are inconsistent across custom controls.
- Some icon-only controls rely on labels, but visual affordance can be weak.
- Modal/sheet semantics could be more consistent.
- Empty states and loading states are serviceable but not product-grade.
- Form validation messages should be easier to scan and closer to the affected task.

## Improvement Opportunities
- Introduce a small design system with semantic tokens and reusable class patterns.
- Convert the public shell into clear zones: header, filters, map/list content, stats, bottom action bar, optional insights.
- Make report flow feel like the central conversion path.
- Promote accountability in report detail and profile sheets, not by overloading the home panel.
- Expand Playwright coverage for list mode, report form, and deep-linked sheets.
- Preserve user edits around cleaner ward names and Bhubaneswar address fallback.
