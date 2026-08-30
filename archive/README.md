# Archive

Historical Far West Masters content, organized by season.

## Structure

One folder per season, named with full years (`2025-2026`, not `25-26`). Inside each,
one folder per content type:

```text
archive/
├── 2024-2025/
│   └── results/          # results table snapshots
├── 2025-2026/
│   ├── forerunner/       # Forerunner newsletters, named by send date
│   ├── email/            # other emails sent that season (deadline reminders,
│   │                     #   race results announcements)
│   ├── results/          # results table snapshots
│   └── schedule/         # season schedule table
└── 2026-2027/
    ├── forerunner/
    └── schedule/
```

Not every season has every folder — create them as content appears.

**Forerunner newsletters** go in `forerunner/`, named `YYYY-MM-DD.html` by send date.
Everything else that went out by email goes in `email/`, named the same way.

**The season schedule table** lives in `[season]/schedule/` from the start of the season
and is edited in place all year — it is the live working file, not an end-of-season
snapshot. The blank reference template with all row states documented is at
`html-templates/templates/race-schedule.html`.

## Adding to the archive

1. Save the file under the right season and type folder, named `YYYY-MM-DD.html`
   for anything sent by email.
2. Screenshots go in the top-level `screenshots/` folder, not here.
3. Add a short note if the context isn't obvious from the file itself.

## Note on duplication

Six files in `email-templates/examples/` are byte-identical copies of archived emails,
kept there under descriptive names as a curated reference set (see that folder's README).
Editing an archived email will not update its example copy, or the reverse.
