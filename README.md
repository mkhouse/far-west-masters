# far-west-masters

Far West Masters email and web templates, scripts, and archives.

## Directory Structure

```text
far-west-masters/
├── airtable-results/        # Scripts for race points calculation
├── archive/                 # Historical files by season
│   ├── 25-26/
│   │   ├── email/           # All emails sent during 2025-26 season
│   │   ├── results/         # Results table snapshots
│   │   └── schedule/        # Final season schedule table
│   └── forerunner/          # Forerunner newsletter archive by season
│       └── 2025-2026/
├── email-templates/         # Email templates and examples
│   └── examples/            # Curated reference emails by type
│       ├── old/             # Pre-2025-26 examples
│       ├── [named examples] # See email-templates/examples/README.md
│       └── README.md
├── html-templates/          # Squarespace HTML block templates
│   ├── templates/           # Working templates
│   │   ├── race-results.html
│   │   └── race-schedule.html
│   └── squarespace-custom.css  # Full sitewide CSS (paste into Squarespace CSS panel)
├── screenshots/             # Screenshots of templates and useful references
├── social/                  # Social media content by season
│   └── 2025-2026/           # Calendar graphics (square + vertical)
├── LICENSE
└── README.md
```

## Airtable Results

Scripts used to import and calculate race and overall points for a season using Airtable. See the directory's README for additional info.

## Archive

Historical files organized by season. Each season folder contains:

- `email/` — all transactional and announcement emails sent that season
- `results/` — end-of-season results table snapshot
- `schedule/` — final season schedule table

`forerunner/` contains the full Forerunner newsletter archive organized by season (e.g. `2025-2026/2026-01-02.html`).

## Email Templates

HTML emails for FWM news and race announcements, built for compatibility with Outlook and all major email clients (table-based layout, inline CSS, MSO conditionals).

See `email-templates/examples/README.md` for descriptions of each example file and a component reference table.

**Types of emails:**

- Full Forerunner newsletter (monthly, 10-article grid)
- Condensed Forerunner (fewer articles, single focus)
- Race registration deadline reminders
- Race results announcements

**Workflow: Creating a new email**

1. Open the closest matching example from `email-templates/examples/` as a starting point
2. Edit in VS Code Insiders with Claude Code
3. Preview in a browser to check layout
4. Copy the final HTML and paste into the FWM email editor
5. Save the final sent version to `archive/forerunner/[season]/`

## HTML Templates

Squarespace HTML block templates for the race schedule and results index pages on farwestmasters.org.

- `race-schedule.html` — season schedule table with all row states (upcoming, completed, canceled, rescheduled, out-of-region)
- `race-results.html` — results index table linking to all individual race result pages
- `squarespace-custom.css` — full sitewide CSS; paste into Squarespace → Design → Custom CSS

**Workflow: Updating the schedule table**

1. Open `html-templates/templates/race-schedule.html` in VS Code Insiders
2. Edit with Claude Code (add races, update row states, add result links)
3. Copy the HTML and paste into the Squarespace HTML block on the Schedule page
4. At end of season, save the final file to `archive/[season]/schedule/`

**Workflow: Updating the results index table**

1. Open `html-templates/templates/race-results.html` in VS Code Insiders
2. Add new rows or result links after each race weekend
3. Copy the HTML and paste into the Squarespace HTML block on the Results page
4. At end of season, save the final file to `archive/[season]/results/`

## Screenshots

Screenshots of email templates, table templates, and other useful references.

## Social

Social media content organized by season (e.g. `social/2025-2026/`). Currently holds calendar graphics generated from HTML:

- `calendar-square.html` — square format for feed posts
- `calendar-vertical.html` — vertical format for stories

## Squarespace Process Notes

### Draft content: Announcements

- In the not-linked section of the website pages list, there's a page called **DRAFTS: Announcements**
- Use this to draft announcements and share with others for review
- When ready to post, copy the announcement from the drafts page and paste into the main Announcements page
- It's also possible to duplicate the entire homepage and draft there, but one at a time is easier

### Draft content: Other pages

Either duplicate the page and edit it, then copy back into the main page, or swap the pages.

### Backup content for future reference

Add to the `archive/` folder in GitHub. Options:

1. Take a screenshot and add it to `screenshots/`
2. Create a new file in `archive/` and paste content in
3. Create a new file in `archive/` and describe the process or context

## License

See [LICENSE](LICENSE) for details.
