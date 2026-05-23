# Next Professional Steps

This backlog is ordered by product risk, not by excitement.

## P0: Trust And Data Correctness

1. Add a real UPF JSON Schema and schema-version migration.
2. Replace demo canvas units with real projected coordinates.
3. Add CRS transform support for accepted projected/geographic imports.
4. Extend structured `EvidenceSource` into a reusable source registry with attachments and review status.
5. Extend structured `RuleSource` with verified URLs, effective dates, attachments, and expert review status.
6. Split prototype rules from statutory rules visually and structurally.

## P1: Planning Logic

1. Add explicit `Intersection` objects instead of deriving intersections every rule run.
2. Add network walking distance for facility coverage.
3. Extend parcel service allocation with age-structure assumptions and facility catchment balancing.
4. Extend land-use compatibility rules to mixed-use ratios, negative uses, and scenario-scoped use changes.
5. Add road access hierarchy and entrance spacing rules by road class.
6. Add scenario-scoped facilities and open spaces.
7. Add facility demand by age structure assumptions.

## P1: Product Experience

1. Add recent files and current project path.
2. Extend the import report with before/after normalized field diffs and rejected-object previews.
3. Extend keyboard navigation with map panning, zoom, and command palette workflows.
4. Add object search and filtering.
5. Add export of scenario comparison tables.
6. Add a proper rule catalog panel.

## P2: Engineering

1. Move type definitions to `src/model/upf-types.ts`.
2. Move UI rendering into view modules.
3. Add fixture-based tests for each rule group.
4. Add release smoke that verifies zip contents and SHA256.
5. Add CI workflow once this becomes a git repository.
6. Extend native Windows metadata with icon branding, publisher, signing, and installer manifests.
7. Add installer/signing path for real distribution.

## P2: Data Adapters

1. GeoJSON import/export.
2. DXF import for parcel and road layers.
3. CSV import for parcel indicators.
4. POI import adapter.
5. OSM/Overpass adapter for roads and facilities.
6. Raster/remote-sensing metadata adapter.
