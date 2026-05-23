# Manual Acceptance Test

Use this when reviewing the current UrbanPlan Studio prototype.

## Launch

```powershell
D:\projects\urbanplan-studio\dist\app.exe
```

Expected:

- Window title is UrbanPlan Studio.
- Top actions include: run check, evaluation, sensitivity, compare, quality, validation, report, UPF, save, load.
- Central canvas shows parcels, roads, facilities, entrances, open space, and a heritage overlay.

## Core Planning Flow

1. Select parcel `A-01`.
2. Change FAR from `4.6` to `4.0`.
3. Confirm status bar indicates unsaved changes.
4. Click `检查`.
5. Confirm rule count updates.
6. Confirm the bottom `综合评估` section shows six dimension rows and a scenario score.
7. Confirm scenario rows show score and band, not only scenario names.
8. Confirm parcel fill colors reflect score bands: lower scoring parcels are warmer, stable parcels are cooler/green.
9. Select a public facility and confirm its service-radius overlay appears on the map.
10. Click `评估`.
11. Confirm the modal includes dimension scores, parcel priorities, service population allocation, highlights, and risk register.
12. Click `敏感`.
13. Confirm the modal compares at least four weight models and reports whether the recommended scheme is stable.
14. Click `对比`.
15. Confirm all scenarios appear in a decision matrix with score, confidence, population, public-service GFA, and risk counts.
16. Click `CSV`.
17. Confirm the modal contains `scenario_id`, scores, population, floor area, and risk-count columns.
18. Click `质检`.
19. Confirm a data quality score, UPF structure validation report, structured RuleSource metadata, evidence coverage, structured evidence coverage, evidence type distribution, and prototype-rule notes appear.
20. Click `验证`.
21. Confirm the report includes research questions, data overview, decision matrix, sensitivity summary, experiment record table, expert review table, and CSV appendix.
22. Click `报告`.
23. Confirm the report includes core metrics, dimension scores, risk register, sensitivity summary, data quality summary, method metadata, and limitations.
24. Click `UPF`.
25. Confirm exported JSON has top-level `format`, `formatVersion`, `manifest.software.version`, `manifest.activeScenarioId`, and `evaluation.modelId`.
26. Click `GeoJSON`.
27. Confirm the modal contains a `FeatureCollection` with parcel, road, facility, entrance, open-space, and constraint features.

## Object Editing

1. Choose the parcel tool.
2. Click the canvas to create a new parcel.
3. Confirm the tool returns to select mode.
4. Edit the new parcel values in the inspector.
5. Edit `证据来源（每行一条）` with one plain text line and one JSON EvidenceSource line, then run quality check and confirm evidence counts plus structured evidence coverage update.
6. Use the object search and `高风险` filter; expected: the list narrows without changing the selected object.
7. Press `Esc`; expected: select mode remains active.
8. Press `Delete`; expected: selected deletable object is removed, unless it is referenced.

## Keyboard Flow

1. Press `Ctrl+F`; expected: object search receives focus.
2. Press `ArrowDown`, `ArrowUp`, `Home`, and `End` outside inputs; expected: selected object moves within the current filtered list.
3. Press `Ctrl+Enter`; expected: checks and evaluation rerun.
4. Press `Ctrl+S`; expected: save dialog or browser download for UPF.
5. Open a report modal, press `Ctrl+S`; expected: the modal content saves with its report filename.

## Scenario Optimization

1. Duplicate the current scenario.
2. Choose `公服优先`, click `应用优化`, and confirm public-service GFA or notes change.
3. Choose `生态优先`, click `应用优化`, and confirm green ratio or FAR changes.
4. Run `检查`; expected: rule counts and evaluation score update.

## Import/Export

1. Click `保存` and save a `.upf`.
2. Click `载入` and load the same file.
3. Confirm the import report opens with object counts, active scenario, and compatibility findings.
4. Load `examples/minimal.upf`.
5. Load `examples/luohu-case-v1.upf`.
6. Confirm the project contains multiple parcels, roads, facilities, open space, heritage constraint, and three scenarios.
7. Open `验证`; expected: validation pack reflects the loaded Luohu case.
8. Open `质检`; expected: imported files with missing/defaulted fields show an import audit section, UPF structure findings, and dangling references if present.
9. Load `examples/invalid.upf`; expected: import error modal.

## Data Integrity

1. Select a parcel referenced by an entrance.
2. Click `删除`.
3. Expected: deletion is blocked with a reference integrity modal.

## Release Verification

```powershell
bun run verify
bun run verify:release
```

Expected:

- Typecheck passes.
- Geometry, UPF, rules, evaluation, static, and release smoke checks pass.
- `release/UrbanPlan Studio-0.1.0-portable.zip` exists.
- `release/SHA256SUMS.txt` matches the generated zip.
