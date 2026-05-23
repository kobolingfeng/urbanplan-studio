# Manual Acceptance Test

Use this when reviewing the current UrbanPlan Studio prototype.

## Launch

```powershell
D:\projects\urbanplan-studio\dist\app.exe
```

Expected:

- Window title is UrbanPlan Studio.
- Top actions include: run check, evaluation, compare, quality, report, UPF, save, load.
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
11. Confirm the modal includes dimension scores, parcel priorities, highlights, and risk register.
12. Click `敏感性`.
13. Confirm the modal compares at least four weight models and reports whether the recommended scheme is stable.
14. Click `对比`.
15. Confirm all scenarios appear in a decision matrix with score, confidence, population, public-service GFA, and risk counts.
16. Click `质检`.
17. Confirm a data quality score, rule catalog, evidence coverage, evidence type distribution, and prototype-rule notes appear.
18. Click `报告`.
19. Confirm the report includes core metrics, dimension scores, sensitivity summary, data quality summary, and limitations.
20. Click `UPF`.
21. Confirm exported JSON has top-level `format`, `formatVersion`, `manifest.software.version`, and `evaluation`.

## Object Editing

1. Choose the parcel tool.
2. Click the canvas to create a new parcel.
3. Confirm the tool returns to select mode.
4. Edit the new parcel values in the inspector.
5. Edit `证据来源（每行一条）`, then run quality check and confirm evidence counts update.
6. Use the object search and `高风险` filter; expected: the list narrows without changing the selected object.
7. Press `Esc`; expected: select mode remains active.
8. Press `Delete`; expected: selected deletable object is removed, unless it is referenced.

## Scenario Optimization

1. Duplicate the current scenario.
2. Choose `公服优先`, click `应用优化`, and confirm public-service GFA or notes change.
3. Choose `生态优先`, click `应用优化`, and confirm green ratio or FAR changes.
4. Run `检查`; expected: rule counts and evaluation score update.

## Import/Export

1. Click `保存` and save a `.upf`.
2. Click `载入` and load the same file.
3. Load `examples/minimal.upf`.
4. Open `质检`; expected: imported files with missing/defaulted fields show an import audit section.
5. Load `examples/invalid.upf`; expected: import error modal.

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
