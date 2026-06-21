# FWM Email Template Examples

HTML email templates and examples for Far West Masters emails.

## Branding

- **Navy:** `#003366`
- **Burgundy:** `#8b0000`
- **Fonts:** Arial, sans-serif throughout (email client compatibility)
- Table-based layout with inline CSS; MSO conditionals for Outlook compatibility
- Mobile responsive via `@media only screen and (max-width: 600px)`

## Examples

### `forerunner-full-10-articles.html`

Full Forerunner newsletter format. Demonstrates: 10-article grid (2-column layout with thumbnails), World Cup schedule callout, two race registration sections with CTA buttons, and "In This Issue" bulleted list at the top.

### `forerunner-two-race-callouts.html`

General-purpose Forerunner format. Demonstrates: two concurrent race registration callouts, race report solicitation section, 10-article grid with real website thumbnails, and "In This Issue" as a bulleted list.

### `forerunner-single-deadline.html`

Condensed Forerunner format. Demonstrates: single focused race callout with urgency deadline language, reduced article grid (6 articles), and tighter layout for lower-content issues.

### `forerunner-complex-multi-section.html`

Complex multi-section Forerunner format. Demonstrates: upcoming schedule section listing multiple races with registration links, board elections / organizational news callout box, "In This Email" inline summary bar with bullet separators, and Masters Nationals info section.

### `forerunner-registration-and-results.html`

Transactional/operational email format (not a full Forerunner). Demonstrates: early registration deadline callout with late fee warning, race results links in Class · Gender · Overall format, callout box with burgundy border (used for organizational announcements), and the upcoming calendar section (dates, deadlines, and events in a scannable format).

### `deadline-reminder.html`

Single-purpose deadline reminder email. Demonstrates: minimal focused layout (one message, one CTA button), inline flyer link as plain text link rather than button, and the upcoming calendar section in its cleanest form — navy header bar, alternating row shading, burgundy dot timeline markers, and inline sub-notes in a smaller font. Best reference for the calendar component.

### `race-results-announcement.html`

Standalone race results announcement email. Demonstrates: multi-race results layout grouped by day with h3 date subheadings, results links in Class \| Gender \| Overall format, brief narrative intro paragraph, and season standings link at the bottom. Use this as the base for any post-race results email.

## Key Components

| Component | Example File |
| --- | --- |
| 2-column article grid with thumbnails | forerunner-full-10-articles, forerunner-two-race-callouts |
| CTA button (burgundy background) | forerunner-full-10-articles, forerunner-two-race-callouts, forerunner-single-deadline, deadline-reminder |
| Race registration callout section | all forerunner-* examples |
| "In This Issue" / "In This Email" bar | forerunner-two-race-callouts, forerunner-complex-multi-section |
| Results links (Class \| Gender \| Overall) | forerunner-registration-and-results, race-results-announcement |
| Callout box — navy background | forerunner-complex-multi-section (elections) |
| Callout box — burgundy border, white bg | forerunner-registration-and-results (membership) |
| Upcoming calendar (dates, deadlines, events) ⭐ | forerunner-registration-and-results, deadline-reminder |
| Single-focus urgent deadline email | deadline-reminder |
| Urgency / deadline language | forerunner-single-deadline, forerunner-registration-and-results, deadline-reminder |
