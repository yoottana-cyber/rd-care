# RD Care — Colorful Dashboard UI (Dev)

## Design
The referenced Facebook group post could not be opened because the source restricted access. This is an original colorful dashboard, not a pixel-accurate clone of that post.

New CSS uses violet–blue–cyan gradients, seven colored statistic cards, soft surfaces, readable navigation, contrast-aware badges, and responsive layouts. All visual assets use local CSS and system fonts only.

## Working additions
- Dashboard button “ดูข้อมูลล่าสุด”: resets the date to current Asia/Bangkok and fetches live summary from the existing API.
- Quick links: attendance, late, behavior, alerts, and admin-only student management. All buttons navigate to existing working tabs.
- Light/dark switch on staff login, staff dashboard, student/guardian portal, and student late reporting. Stores only a color preference, never data or credentials.
- Compact mobile dashboard, bottom scrolling navigation, keyboard focus indicators, reduced-motion support.
- Distinct present/absent/late/leave chips with appropriate contrast.

## QA
- Node regression tests for route wiring, palette choice, dark mode, mobile and appearance controls.
- No changes to Cloudflare D1 tables or authentication policies.
- CSS/JS are included in PWA cache v17 for proper update.
- Prototype remains Dev-only and uses mock student information.

## Matching the Facebook post later
For exact appearance and feature parity, the user should provide an image or video of that post with visible menus and features (with any personal data hidden). Until then, no particular functions of the inaccessible post are presumed.
