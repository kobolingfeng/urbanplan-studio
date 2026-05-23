# UPF 0.1 Schema Notes

UPF is the internal semantic planning format used by UrbanPlan Studio. It is intentionally not CAD-native. CAD, GIS, BIM, and spreadsheets can become import/export channels, but UPF should remain the planning source of truth.

## Document

```json
{
  "format": "UPF",
  "formatVersion": "0.1.0",
  "manifest": {},
  "project": {},
  "ruleset": {},
  "scenarios": [],
  "activeScenarioId": "scenario_id",
  "objects": [],
  "checks": [],
  "recommendations": []
}
```

## Required Principles

- Every object has `id`, `type`, `name`, and `evidence`.
- The manifest records the software version and unit system used during export.
- Every scenario has `id`, `name`, and `description`.
- Every parcel must have scenario-scoped values.
- Rule results must reference the object, rule, source, and severity.
- Prototype rules must remain distinguishable from statutory rules.
- All imported files go through normalization before rendering.

## Current Object Types

### Parcel

Represents a planning parcel, not a CAD polygon.

Required fields:

- `points`
- `landUseCode`
- `landUseName`
- `controls.farMax`
- `controls.buildingCoverageMax`
- `controls.greenRatioMin`
- `controls.heightMaxM`
- `scenarioValues`

Scenario values:

- `far`
- `buildingCoverage`
- `greenRatio`
- `residentialGfaSqm`
- `publicServiceGfaSqm`
- `updateMode`
- `notes`

### Road

Represents a road segment with planning meaning.

Required fields:

- `points`
- `level`
- `redLineWidthM`
- `lanes`

### Entrance

Represents an entrance bound to a parcel and road.

Required fields:

- `point`
- `entranceType`
- `parcelId`
- `roadId`

The application blocks deleting referenced parcels to avoid dangling entrance references.

### Facility

Represents public service facilities.

Required fields:

- `point`
- `kind`
- `capacity`
- `serviceRadiusM`
- `planned`

Current rules support both total capacity and straight-line coverage checks.

### OpenSpace

Represents public open space.

Required fields:

- `points`
- `kind`

### Constraint Overlay

Represents protection or risk overlays.

Required fields:

- `points`
- `kind`

Current heritage risk rules use polygon overlap instead of centroid-only checks.

## Known Schema Gaps

- `Intersection` should become an explicit object instead of being derived every run.
- `RuleSource` should become an object with jurisdiction, version, effective date, source URL, and clause.
- `EvidenceSource` should become structured instead of string arrays.
- `ServiceArea` should support walking-network distance instead of straight-line distance.
- `Indicator` should store scenario dashboard metrics.
- Geometry should support real projected coordinates and CRS transforms.
