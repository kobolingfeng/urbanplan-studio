# Professional Product Benchmark Notes

Date: 2026-05-23

This note records what UrbanPlan Studio should learn from mature planning and digital-city products.

## References

- ArcGIS Urban: scenario modeling, data-driven analysis, e-submission, collaborative planning, extensible planning system. Source: https://www.esri.com/en-us/arcgis/products/arcgis-urban/overview
- ArcGIS Urban documentation: plans are long-range study-area planning objects with zoning or land-use code as a common data model. Source: https://doc.arcgis.com/en/urban/latest/get-started/get-started-plans.htm
- ArcGIS Urban dashboard metrics: scenario dashboards and spreadsheet export for scenario metrics. Source: https://doc.arcgis.com/en/urban/latest/help/help-metrics-plan.htm
- ArcGIS Urban data model: urban database, design feature services, parcels, zoning, land use, overlays, projects, indicators. Source: https://doc.arcgis.com/en/urban/data/data-model.htm
- ArcGIS CityEngine: procedural urban modeling from GIS data and rule-based generation. Source: https://www.esri.com/en-us/arcgis/products/arcgis-cityengine/overview
- CityEngine documentation: procedural modeling expresses generation logic in rule files instead of manual modeling. Source: https://doc.arcgis.com/en/cityengine/latest/get-started/get-started-about-cityengine.htm
- Autodesk urban planning and Forma: environmental impact analysis for early urban planning and design. Source: https://www.autodesk.com/solutions/urban-design-planning/
- Bentley OpenCities Planner: digital twin from CAD/BIM, GIS, CityGML, reality meshes, planning data, stakeholder feedback, web/mobile/VR access. Source: https://www.bentley.com/software/opencities-planner/

## Product Principles To Adopt

1. Scenario-first planning
   - Every metric and rule result should be scenario-scoped.
   - Comparison is a first-class workflow, not a report afterthought.

2. Common data model
   - Parcels, zoning/land use, overlays, projects, indicators, and scenarios need stable schemas.
   - CAD/GIS/BIM are import/export channels, not the internal source of truth.

3. Rule and evidence traceability
   - Every check should show threshold, actual value, source document, jurisdiction, version, and confidence.
   - Prototype rules must be visually distinct from statutory rules.

4. Data quality before expert claims
   - A professional product should expose missing evidence, dangling references, scenario gaps, and unverified assumptions.
   - A planning assistant should say what it knows, what it infers, and what remains unverified.

5. Clean delivery pipeline
   - Build output must be clean and repeatable.
   - Example UPF files, smoke tests, release notes, and versioned manifests are part of the product, not extras.

## Next Product-Level Targets

- Move geometry and rule execution into pure modules with fixture tests.
- Add schema validation and version migration for UPF.
- Introduce `Intersection`, `ServiceArea`, `Indicator`, and `RuleSource` as explicit UPF objects.
- Add real scenario dashboard with capacity, population, facility demand, risk count, and confidence score.
- Add import adapters for GeoJSON first, then DXF/DWG later.
