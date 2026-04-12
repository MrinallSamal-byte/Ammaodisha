# Reference Site Analysis: NammaKasa

## Overview
NammaKasa is a map-first civic reporting product for garbage issues in Bengaluru. The first useful screen is not a marketing page: it is the live map, with data, filters, and reporting controls immediately available.

The strongest UX principle is action proximity. Reporting, filtering, viewing civic accountability, and switching map/list modes are all reachable without leaving the main experience.

## Information Architecture
- `/` is the primary public app: map, filters, stats, report CTA, list mode, report detail, civic profiles, about, changelog, and community prompt.
- `/report/:id` opens a report detail sheet over the map.
- `/ward/:id` opens ward accountability context.
- `/mla/:id` and `/mp/:id` open representative accountability context.
- `/admin` is a separate moderation surface.

## Homepage Hierarchy
- Header: compact brand, version, and utility/social affordances.
- Trust/status banner: new home/domain notice placed near the top without taking over the screen.
- Filters: severity and status are visible before the map content gets buried.
- Core experience: large map with ward boundaries and severity-coded report markers.
- Stats: compact counters for active reports and total reports.
- View toggle: map/list switch uses a segmented control.
- Primary CTA: bottom sticky `Report Garbage` button dominates the public action path.
- Secondary data affordance: a compact chart/insights button sits beside the CTA.

## Component Inventory
- Brand header with small utility controls.
- Top notice banner.
- Filter controls.
- Segmented map/list toggle.
- Map markers sized and colored by severity.
- Stats pills using monospace numbers.
- Bottom action bar.
- List feed rows with count, location, severity, and representative context.
- Bottom sheets for report details, forms, changelog, and about content.
- Toast/community prompt.
- Moderator login and moderation cards.

## Interaction Patterns
- Map markers open report details without leaving context.
- Ward boundaries are clickable and map to accountability views.
- Report form auto-starts location detection and lets the user fall back to manual ward selection.
- CTA remains visible across map and list views.
- Intro overlay is dismissible by tapping anywhere.
- Sheets slide from the bottom on mobile and are constrained on larger screens.

## Responsiveness Observations
- Mobile prioritizes a header, top filters, full-height map, and bottom CTA.
- The list view becomes a full feed instead of a cramped side panel.
- Touch targets are generally 40px or larger.
- Sheets occupy most of the viewport but keep a grab handle and close button visible.
- The primary CTA stays above the safe-area inset.
- The reference avoids a traditional multi-section homepage because the product value is the live civic map.

## Inferred Design Tokens
- Background: white and very light neutral surfaces.
- Text: near-black primary, gray secondary, muted gray metadata.
- Primary action: strong red.
- Severity: amber/orange/red gradient by urgency.
- Success/resolved: green.
- Borders: pale gray, low contrast.
- Radius: mostly 8-16px, with larger sheet radius.
- Shadows: subtle cards, stronger overlay sheets.
- Fonts: clean sans for UI, monospace for counters and system labels.

## UX Principles To Adapt
- Start with the highest-value interaction, not a brochure.
- Keep the main CTA constantly available.
- Make public accountability visible through ward and representative context.
- Use compact proof: counts, severity, active/resolved status, and civic ownership.
- Keep controls near the user task: filter, inspect, report, share.
- Use sheets instead of page changes for contextual tasks.
- Keep mobile layouts predictable: header controls top, action controls bottom.

## What Not To Copy
- Do not copy Bengaluru-specific text, data, representatives, or city framing.
- Do not copy logos, assets, icons, or brand language.
- Do not clone exact layout measurements where Amma Odisha needs Bhubaneswar-specific hierarchy.
- Do not copy the reference's visual identity wholesale; retain Amma Odisha's red civic identity and BMC context.
