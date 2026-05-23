# Release Checklist

Use this before handing UrbanPlan Studio to another person for review.

## Build Hygiene

- Run `bun run clean`.
- Run `bun run verify`, including `smoke:rule-fixtures`.
- Run `bun run verify:release`.
- Confirm `dist` only contains:
  - `app.config.json`
  - `app.exe`
  - `index.html`
  - `main.js`
- Confirm `release/UrbanPlan Studio-0.1.0-portable.zip` contains only the same runtime files.
- Confirm `release/SHA256SUMS.txt` is regenerated.
- Confirm `dist/app.exe` FileVersion matches `app.config.json`.
- `verify:release` runs `package` and `smoke:release`.

## Product Smoke

- Launch `dist/app.exe`.
- Confirm the title is UrbanPlan Studio.
- Confirm the top actions are visible: run check, evaluation, sensitivity, compare, quality, validation, report, UPF, save, load.
- Click a parcel and edit FAR; status bar should show unsaved state.
- Click UPF and confirm top-level `format` and `formatVersion` exist.
- Click evaluation and confirm the modal includes score, confidence, dimensions, parcel priorities, service population allocation, and risk register.
- Click sensitivity and confirm four weight profiles produce a model comparison and scenario rankings.
- Click validation and confirm the case validation pack includes research questions, decision matrix, sensitivity summary, experiment record table, expert review table, and CSV appendix.
- Click CSV and confirm a standalone scenario-decision CSV is available.
- Click quality and confirm it includes UPF structure validation, structured RuleSource metadata, evidence distribution, structured evidence coverage, and import audit.
- Click report and confirm sensitivity and data-quality summaries are included.
- Click GeoJSON and confirm a FeatureCollection is exported with UPF object properties.
- Use object search and high-risk filter to locate problem objects.
- Apply public-service and ecology optimization presets on a duplicated scenario.
- Test `Ctrl+F`, arrow-key object navigation, `Ctrl+Enter`, and `Ctrl+S` keyboard flow.
- Save a `.upf`, then load it back.
- Confirm the 导入报告 modal appears after loading, with object counts and compatibility findings.
- Load `examples/minimal.upf`.
- Load `examples/luohu-case-v1.upf` and confirm three scenarios and multiple planning object types appear.
- Try a UPF declaring `EPSG:4490` with canvas-scale coordinates and confirm validation reports mixed CRS data.
- Confirm quality report includes import audit when compatibility fixes were applied.
- Try `examples/invalid.upf`; it should show an import error.

## Planning Logic Smoke

- FAR above control value creates an error.
- Green ratio below control value creates an error.
- Industrial land with residential GFA creates a land-use compatibility warning.
- A vehicle entrance on a trunk road creates a warning.
- A parcel overlapping heritage control and marked as demolition/rebuild creates a warning.
- Deleting a parcel referenced by an entrance is blocked.
- Scenario decision matrix lists all scenarios, scores, confidence, key metrics, and risk counts.
- Data quality report exposes rule catalog, structured RuleSource levels, prototype rules, evidence coverage, structured evidence coverage, evidence type distribution, and evidence gaps.
- UPF smoke confirms `schemas/upf-0.1.schema.json` exists and runtime validation catches invalid files.
- Data quality report exposes dangling entrance references when an entrance points to a missing parcel or road.
- Evaluation smoke confirms six dimensions and parcel-level scoring.

## Known Limits

- Geometry uses demo canvas units, not real projected coordinates.
- Rules are prototype rules, not statutory review rules.
- Facility coverage uses straight-line distance, not network walking distance.
- Traffic checks are warnings, not traffic impact assessment.
- Fire, sunlight, municipal utilities, ownership, compensation, and implementation phasing are not modeled yet.
