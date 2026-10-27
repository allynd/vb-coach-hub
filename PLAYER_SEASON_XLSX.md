# Player Season + Match Breakdown XLSX (v15.41)

In **Players** or **Roster**, select any player and choose **Export Season XLSX**.
The standard **Export Excel Stats** dialog also provides **Player Season + Match Breakdown** under Period, with a player selector.

The workbook uses a single worksheet, **Season Match Breakdown**:
- Season Total appears first, followed by one chronologically ordered row per team match.
- Includes opponent, date, tournament, round, W/L, match set record, individual set scores, participation status and all existing stat categories (30).
- Individual per-set rates and percentage statistics use the same underlying event calculations and player set participation rules as Coach Hub. The spreadsheet supplies formulas for derived fields, with totals at the top.
- Includes both School and Club matches for the selected team's season, not the player's separate career totals or other teams.
- Every team match is shown, even when the player has no recorded appearance (clearly labeled).
- Season-only stat corrections appear in their own **Season Adjustments** row. This reconciles the season totals without inventing a match for adjustments.
- The file is generated locally with the bundled ExcelJS library and remains available offline after the app's assets are cached.

This feature adds no new database schema and does not modify match or player records.
