# Manual Acceptance Test

Use this when reviewing the current UrbanPlan Studio prototype.

## Launch

```powershell
D:\projects\urbanplan-studio\dist\app.exe
```

Expected:

- Window title is UrbanPlan Studio.
- Top actions include: run check, compare, quality, report, UPF, save, load.
- Central canvas shows parcels, roads, facilities, entrances, open space, and a heritage overlay.

## Core Planning Flow

1. Select parcel `A-01`.
2. Change FAR from `4.6` to `4.0`.
3. Confirm status bar indicates unsaved changes.
4. Click `运行检查`.
5. Confirm rule count updates.
6. Click `对比`.
7. Confirm all scenarios appear in a comparison table.
8. Click `质检`.
9. Confirm a data quality score and evidence/prototype-rule notes appear.
10. Click `UPF`.
11. Confirm exported JSON has top-level `format`, `formatVersion`, and `manifest.software.version`.

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
- Geometry, UPF, rules, static, and release smoke checks pass.
- `release/UrbanPlan Studio-0.1.0-portable.zip` exists.
- `release/SHA256SUMS.txt` matches the generated zip.
