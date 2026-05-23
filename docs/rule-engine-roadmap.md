# Rule Engine Roadmap

The active rule engine now lives in `src/planning-rules.ts`. More UI glue remains in `src/main.ts`, but rule execution has started moving toward pure modules.

## Current Rule Groups

- Parcel intensity rules
  - FAR maximum
  - Green ratio minimum
  - Building coverage maximum
  - Public service floor area heuristic
- Heritage overlay risk
  - Parcel polygon overlaps heritage control overlay
  - Demolition/rebuild mode triggers warning
- Entrance rules
  - Vehicle entrance on trunk road
  - Entrance-road distance consistency
  - Entrance near derived road intersection
- Facility rules
  - Kindergarten capacity gap
  - Elderly service capacity gap
  - Community health capacity check
  - Parcel-level facility coverage gap

## Target Architecture

```text
src/
  model/
    upf-types.ts
    geometry.ts
    unit-system.ts
  rules/
    index.ts
    parcel-rules.ts
    entrance-rules.ts
    facility-rules.ts
    overlay-rules.ts
    rule-result.ts
  io/
    upf-parse.ts
    upf-migrate.ts
    upf-export.ts
  ui/
    canvas-renderer.ts
    inspector.ts
    report-modal.ts
```

## Rule Metadata

Every rule should eventually declare:

- `id`
- `name`
- `level`: mandatory, statutory, local technical, special-plan, design-guidance, prototype
- `jurisdiction`
- `sourceTitle`
- `sourceUrl`
- `version`
- `effectiveFrom`
- `targetObjectType`
- `applicability`
- `severity`
- `threshold`
- `confidence`
- `fixHint`

## Test Fixtures

Needed fixtures:

- Valid minimal UPF.
- Invalid UPF with missing scenarios.
- Parcel FAR violation.
- Parcel green ratio violation.
- Entrance on trunk road.
- Entrance with dangling parcel reference.
- Parcel partially overlapping heritage overlay.
- Facility total capacity sufficient but coverage insufficient.

## Near-Term Refactor Order

1. Extract geometry functions and unit system. Done in `src/planning-geometry.ts`.
2. Extract UPF parsing and normalization. Partially done in `src/planning-analytics.ts`.
3. Extract rule result type and rule runner. Partially done in `src/planning-rules.ts`.
4. Move parcel rules out of `main.ts`. First pass done.
5. Move entrance and facility rules out of `main.ts`. First pass done.
6. Add fixture tests for each rule group.
7. Add schema migration from UPF 0.1 to future versions.
