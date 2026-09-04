# Volleyball Coach Hub

A mobile-first, offline-capable volleyball coaching app for managing teams, rosters, lineups, substitutions, match statistics, player history, and season data from an iPhone or iPad.

Coach Hub is designed to function as a standalone coaching tool. It does **not** require the livestream/overlay application, a laptop at the gym, or a permanent internet connection during matches.

## Overview

Coach Hub is intended to be a one-stop shop for volleyball coaches and team managers. It combines:

- Team and season management
- Saved rosters
- Player profiles and photos
- Team logos
- Pre-set lineup sheets
- Starting six and libero designation
- Regular, libero, and serving substitutions
- Touch-first live stat entry
- Automatic team/player stat calculations
- Match history
- Season and career player history
- CSV export and sharing
- Local backup/restore
- Offline use on iPhone and iPad

The application is built as an installable Progressive Web App (PWA) and stores coaching data locally in the browser using IndexedDB.

---

## Current Features

### Multiple Teams

Coaches can create and maintain multiple teams on the same device.

Each team can have its own:

- Team name
- School/organization
- Level
- Season
- Team logo
- Roster
- Matches
- Statistics
- Player history

Coach Hub remembers the **last active team** and opens back to that team until the coach chooses another one.

### Rosters and Player Profiles

Players can have persistent profiles containing information such as:

- First and last name
- Jersey number
- Primary position
- Secondary position
- Height
- Graduation year
- Dominant hand
- Player photo
- Coach notes

Player identity can persist across seasons so season statistics and longer-term career history can be tracked separately.

### Set Lineups

Each set can have its own submitted lineup.

The lineup screen supports:

- Serve or receive selection
- Service order I–VI
- Starting six
- Libero designation
- Optional second libero designation
- Copying the previous set's lineup
- A separate submitted lineup and current on-court lineup

This allows substitutions to occur during a set without overwriting the lineup that was originally submitted before the set.

### Substitutions

Tap an active player during Game Day to access substitution controls.

Supported substitution types include:

- **Sub** – normal player substitution
- **Libero Sub** – libero/defensive replacement
- **Libero Return** – returns the player previously replaced by the libero
- **Serve Sub** – tracks a serving-specific substitution

When selecting **Libero Sub**, only players whose primary position is listed as `L` or `DS` are offered as libero/defensive candidates.

Substitution history is stored by set and service-order position.

### Game Day Statistics

The Game Day interface is designed for touch use on a phone or tablet.

Typical tracked stats include:

- Serve attempts
- Aces
- Serve errors
- Attack attempts
- Kills
- Attack errors
- Solo blocks
- Block assists
- Assists
- Ball-handling / setting errors
- Digs
- Serve receive ratings (0–3)
- Team points
- Opponent points

Coach Hub supports **Simple** and **Advanced** stat-entry modes.

A setting/ball-handling error is recorded as a player statistic only and does **not** automatically award the opponent a point. The rally result is recorded separately.

### Automatic Statistics

Coach Hub calculates statistics from the underlying event history rather than relying on manually entered cumulative totals.

Calculated values include items such as:

- Hitting percentage
- Serve-in percentage
- Passing average
- Player match totals
- Team match totals
- Season totals
- Career totals
- Season leaders

Because statistics are event-driven, correcting or deleting historical events automatically changes the relevant totals.

### Match and Set History

Completed and in-progress matches are saved under **Games**.

A saved match can retain:

- Opponent
- Date
- Set scores
- Submitted lineups
- Current lineup/substitution history
- Player statistics
- Team statistics
- Event history

Historical match information can be corrected after the match.

### Delete Sets and Matches

Historical data can also be permanently removed.

**Delete Set** removes:

- The selected set score
- That set's lineup
- Substitutions recorded in the set
- All player/team stat events recorded in the set

Later sets are renumbered when needed.

**Delete Match** removes:

- The entire match
- All sets
- All lineups
- All substitutions
- Every stat event associated with the match

After deletion, team, season, and player statistics automatically recalculate from the remaining history.

> Deletion is permanent. Exporting a backup before major historical edits is recommended.

---

## Offline Use

Coach Hub is designed to continue working after it has been loaded on the device.

The application uses:

- A service worker for offline app assets
- IndexedDB for team, player, match, and stat data
- Local image storage for player photos and team logos

Once the current application version has been loaded successfully, coaches can use the app in gyms with poor or unavailable internet access.

Internet access is still recommended periodically so the device can receive application updates and so coaches can export/share backups as needed.

---

## Install on iPhone or iPad

1. Open the deployed Coach Hub site in **Safari**.
2. Allow the site to fully load while connected to the internet.
3. Tap the **Share** button.
4. Choose **Add to Home Screen**.
5. Make sure **Open as Web App** is enabled if shown.
6. Tap **Add**.
7. Launch Coach Hub from the new Home Screen icon.

The installed Home Screen version behaves much more like a standalone app than a normal browser tab.

---

## GitHub Pages Deployment

This repository is structured so the app can be hosted directly with GitHub Pages.

The repository root contains the application files, including:

```text
index.html
coach.js
coach.css
db.js
history-delete.js
sw.js
manifest.webmanifest
icon-180.png
icon-192.png
icon-512.png
README.md
```

To enable GitHub Pages:

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch.
5. Select `/ (root)` as the folder.
6. Save the Pages configuration.

GitHub Pages may take a few minutes to publish new commits.

---

## Updating the App

Application updates are made by committing updated source files to the repository.

Because Coach Hub is a PWA, an installed iPhone/iPad may temporarily display a cached version after a new deployment.

Recommended update process:

1. Push or commit the updated application files.
2. Wait for GitHub Pages to finish publishing.
3. Open the Coach Hub site in Safari while online.
4. Refresh the page.
5. Close and reopen the Home Screen app.

The service-worker cache version should be incremented when application assets change so devices know that a new build is available.

Updating application code is designed to leave the locally stored team database intact.

Before major application changes, however, exporting a backup is still recommended.

---

## Backup and Restore

Coach Hub supports exporting the locally stored application data as a JSON-based backup file.

Backups can preserve information such as:

- Teams
- Seasons
- Rosters
- Player profiles
- Matches
- Event history
- Statistics
- Settings

Use **Team → Export Backup** periodically, especially before:

- Clearing Safari website data
- Removing/reinstalling the Home Screen app
- Moving to a new device
- Performing major historical cleanup
- Testing significant application changes

A previously exported backup can be restored through the app's import function.

---

## Sharing and Export

Coach Hub supports device-friendly sharing for team and player information.

Depending on the device/browser, reports can be shared through the operating system Share Sheet or email fallback.

Season statistics can also be exported in CSV format for further analysis or record keeping.

---

## Data Model

Coach Hub intentionally treats individual stat events as the primary historical record.

Conceptually:

```text
Team
└── Season
    ├── Players
    └── Matches
        ├── Set 1
        │   ├── Submitted Lineup
        │   ├── Substitutions
        │   └── Stat Events
        ├── Set 2
        └── Set 3
```

Player and team totals are calculated from those underlying events.

This makes it possible to:

- Correct mistakes
- Delete individual events
- Delete entire sets
- Delete entire matches
- Recalculate season statistics accurately
- Preserve per-match and per-set history

---

## Project Goals

Coach Hub is being built around a few core principles:

1. **Fast courtside operation** – common actions should require as few taps as possible.
2. **Mobile first** – the primary experience is iPhone/iPad rather than desktop.
3. **Offline first** – losing gym Wi-Fi should not stop stat keeping.
4. **Historical accuracy** – edits and deletions should propagate through player and team totals.
5. **Volleyball specific** – lineup, libero, substitution, rotation, and stat workflows should reflect how volleyball is actually coached.
6. **Coach ownership** – the coach should be able to export and retain their own team data.

---

## Planned / Future Improvements

Potential next steps include:

- Live rotation tracking
- Current server / side-out tracking
- Automatic P1–P6 rotation movement
- Rotation-level performance analytics
- Side-out percentage
- Scoring differential by rotation
- More advanced lineup analytics
- Expanded player development trends
- PDF reports
- Additional CSV/report formats
- Improved historical substitution editing
- Optional additional backup/sync strategies

---

## Technology

Coach Hub currently uses a lightweight browser-based stack:

- HTML
- CSS
- Vanilla JavaScript / ES modules
- IndexedDB
- Service Workers
- Web App Manifest / PWA support
- GitHub Pages for static hosting

There is no required application server for normal coach/stat-tracking use.

---

## Important Data Note

Coach Hub currently stores its working database locally on the device/browser.

That makes the application fast and usable offline, but it also means the device's local storage is important. Clearing browser website data can remove locally stored Coach Hub data.

**Export backups regularly.**

---

## Status

Coach Hub is under active development and is currently focused on practical volleyball roster, lineup, substitution, and statistics workflows for coaches using mobile devices.
