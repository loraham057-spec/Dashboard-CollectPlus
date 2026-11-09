# CollectPlus v0.8.6 — Analytics dashboard UI

## Delivered
- Dashboard now includes an advanced analytics panel connected to `GET /api/analytics/quality`.
- Summary tiles: total submissions analyzed, average observed field completeness, exact-payload duplicate candidates, malformed payloads.
- Visual daily trend (latest 14 dates) using lightweight CSS bars.
- Visual field completeness ranking (up to 8 fields).
- Form filter triggers refresh of analytics data.
- Responsive layout for narrow screens and dark-mode variables inherited from the existing theme.
- No charting library dependency added; renders with native HTML/CSS to reduce bundle and load overhead.

## Technical checks
- `node --check app/static/app.js`: passed.
- Python compilation `app/main.py`: passed.
- ZIP integrity: checked.
- API integration/browser interaction test: not run in a live browser in this delivery.
- Current completeness score is a heuristic across fields present in the selected submissions, not schema-aware required-field completeness.
- Duplicate candidates are payload-exact matches and must be reviewed; nothing is deleted automatically.

## Next work recommended
- Validate panel visually in desktop/mobile browsers and test filtering.
- Add province/antenna breakdown only after confirming a consistent org-unit field and permission model.
- PostgreSQL, persistent Render disk, offline sync queue and audit logs remain separate deployment/architecture tasks.
