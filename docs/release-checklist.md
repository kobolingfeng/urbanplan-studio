# Release Checklist

Use this before handing UrbanPlan Studio to another person for review.

## Build Hygiene

- Run `bun run clean`.
- Run `bun run verify`.
- Run `bun run verify:release`.
- Confirm `dist` only contains:
  - `app.config.json`
  - `app.exe`
  - `index.html`
  - `main.js`
- Confirm `release/UrbanPlan Studio-0.1.0-portable.zip` contains only the same runtime files.
- Confirm `release/SHA256SUMS.txt` is regenerated.
- `verify:release` runs `package` and `smoke:release`.

## Product Smoke

- Launch `dist/app.exe`.
- Confirm the title is UrbanPlan Studio.
- Confirm the top actions are visible: run check, compare, quality, report, UPF, save, load.
- Click a parcel and edit FAR; status bar should show unsaved state.
- Click UPF and confirm top-level `format` and `formatVersion` exist.
- Save a `.upf`, then load it back.
- Load `examples/minimal.upf`.
- Try `examples/invalid.upf`; it should show an import error.

## Planning Logic Smoke

- FAR above control value creates an error.
- Green ratio below control value creates an error.
- A vehicle entrance on a trunk road creates a warning.
- A parcel overlapping heritage control and marked as demolition/rebuild creates a warning.
- Deleting a parcel referenced by an entrance is blocked.
- Scenario comparison lists all scenarios and key metrics.
- Data quality report exposes prototype rules and evidence gaps.

## Known Limits

- Geometry uses demo canvas units, not real projected coordinates.
- Rules are prototype rules, not statutory review rules.
- Facility coverage uses straight-line distance, not network walking distance.
- Traffic checks are warnings, not traffic impact assessment.
- Fire, sunlight, municipal utilities, ownership, compensation, and implementation phasing are not modeled yet.
