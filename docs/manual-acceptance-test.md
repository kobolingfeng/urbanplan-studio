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
4. Click `运行检查`.
5. Confirm rule count updates.
6. Confirm the bottom `综合评估` section shows six dimension rows and a scenario score.
7. Confirm parcel fill colors reflect score bands: lower scoring parcels are warmer, stable parcels are cooler/green.
8. Click `评估`.
9. Confirm the modal includes dimension scores, parcel priorities, highlights, and risk register.
10. Click `对比`.
11. Confirm all scenarios appear in a decision matrix with score, confidence, population, public-service GFA, and risk counts.
12. Click `质检`.
13. Confirm a data quality score, rule catalog, evidence coverage, evidence type distribution, and prototype-rule notes appear.
14. Click `UPF`.
15. Confirm exported JSON has top-level `format`, `formatVersion`, `manifest.software.version`, and `evaluation`.

## Object Editing

1. Choose the parcel tool.
2. Click the canvas to create a new parcel.
3. Confirm the tool returns to select mode.
4. Edit the new parcel values in the inspector.
5. Press `Esc`; expected: select mode remains active.
6. Press `Delete`; expected: selected deletable object is removed, unless it is referenced.

## Import/Export

1. Click `保存` and save a `.upf`.
2. Click `载入` and load the same file.
3. Load `examples/minimal.upf`.
4. Load `examples/invalid.upf`; expected: import error modal.

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
