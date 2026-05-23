# Changelog

## 0.1.0 - 2026-05-23

- Created the UrbanPlan Studio planning-native desktop prototype.
- Added semantic planning canvas, UPF export/import, scenario switching, rule checks, reports, and data-quality diagnostics.
- Added clean build behavior, smoke verification, example UPF files, and professional benchmark notes.
- Fixed UPF round-trip import, tool-button state after object creation, road-intersection risk detection, heritage overlay overlap detection, road label midpoint placement, and deletion reference protection.
- Added versioned release naming and version metadata in UPF exports.
- Extracted shared planning geometry and unit-system helpers into `src/planning-geometry.ts`.
- Added geometry smoke tests for area scale, distance scale, point-in-polygon, polygon overlap, and segment intersection.
- Moved the active rule runner into `src/planning-rules.ts` as a first step toward a real rules engine.
- Removed the legacy inline rule block from `main.ts` after the new rule runner passed verification.
- Added rule smoke tests for parcel, overlay, entrance, and recommendation behavior.
- `build:frontend` now preserves an existing `dist/app.exe` while still cleaning stale frontend/cache files.
- Added local autosave and restore-from-autosave entry point in the Project panel.
- Package script now writes `SHA256SUMS.txt` for release integrity checks.
- Added release smoke script to verify zip naming and SHA256 contents.
- Added `verify:release` as the one-command packaging verification path.
- Clarified prototype rule source labels so outputs do not read like formal statutory approval conclusions.
