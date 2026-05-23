# UrbanPlan Studio

UrbanPlan Studio is a planning-native desktop prototype. It is not a CAD plug-in. It tests a workflow based on UPF, a semantic Urban Planning Format for parcels, roads, entrances, facilities, open spaces, overlays, scenarios, rule checks, and evidence traces.

## Current MVP

- Semantic planning canvas with parcels, roads, entrances, facilities, open spaces, and control overlays.
- Scenario switching and comparison.
- Parcel inspector for FAR, coverage, green ratio, residential GFA, public-service GFA, and renewal mode.
- Editable evidence traces per object, feeding data-quality and confidence scoring.
- Import audit for missing fields, compatibility fixes, and objects that need review.
- Rule checks for parcel intensity, green ratio, coverage, public-service gaps, entrance risks, and heritage overlay risks.
- Multi-criteria scenario evaluation for compliance, public service, mobility, ecology, renewal value, and evidence confidence.
- Weight-sensitivity analysis across balanced, public-service-first, conservation-first, and implementation-risk models.
- Decision matrix that reruns checks and scoring across all scenarios and explains the recommended scenario.
- Parcel score heatmap for quickly spotting priority intervention areas.
- UPF export/import.
- Markdown planning diagnosis report.
- Data-quality report for evidence, scenario completeness, prototype rules, and dangling references.
- Geometry, UPF, rules, evaluation, and static build smoke checks.

## Commands

```powershell
bun install
bun run verify
bun run dev
```

Clean and package:

```powershell
bun run clean
bun run verify
bun run verify:release
```

Expected output: `release/UrbanPlan Studio-0.1.0-portable.zip`.

Static preview:

```powershell
bun run build:frontend
cd dist
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`.

## Example Data

- `examples/minimal.upf`
- `examples/luohu-demo.upf`
- `examples/invalid.upf`

## Review Docs

- `docs/architecture.md`
- `docs/manual-acceptance-test.md`
- `docs/release-checklist.md`
- `docs/next-professional-steps.md`
- `docs/graduation-design-plan.md`
- `docs/evaluation-methodology.md`

## Limits

This prototype is a planning decision-support experiment. It does not replace statutory planning review, fire-safety review, traffic impact assessment, or official detailed-plan deliverables.
