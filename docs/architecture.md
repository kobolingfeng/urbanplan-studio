# Architecture

UrbanPlan Studio is a planning-native desktop prototype built on a lightweight WebView shell. The current implementation is local-first: it can run as a desktop executable or as a static frontend preview.

## Runtime Shape

```text
dist/
  app.exe
  app.config.json
  index.html
  main.js
```

The app shell provides native file dialogs, file read/write, clipboard, logging, and window controls. High-risk native namespaces are denied in `app.config.json`.

## Source Modules

```text
src/
  main.ts                UI state, rendering, inspector, modal, native integration
  planning-geometry.ts   Unit system and pure geometry helpers
  evidence.ts            EvidenceSource parsing, display, classification, and confidence scoring
  planning-rules.ts      Active rule runner and recommendations
  planning-evaluation.ts Multi-criteria scenario scoring and decision reports
  planning-analytics.ts  UPF import/export helpers, comparison, data quality reports
  upf-validation.ts      UPF structure validation and validation report output
  planning-rules.ts      rule execution plus rule catalog metadata
  api.ts                 Native command wrappers inherited from the shell
  ipc.ts                 WebView IPC bridge
  index.html             Layout and CSS for the prototype UI
```

## Verification

`bun run verify` executes:

1. TypeScript typecheck.
2. Geometry smoke tests.
3. UPF parse/export smoke tests.
4. Rule smoke tests.
5. Rule fixture smoke tests for rule-group regressions.
6. Scenario evaluation smoke tests.
7. Full frontend + native build.
8. Static build smoke tests.

Release verification:

```powershell
bun run package
bun run smoke:release
```

The release smoke checks zip naming, SHA256 contents, and zip file entries.

## Data Flow

```text
UPF/demo project
  -> normalize import
  -> render semantic objects
  -> edit scenario/object fields
  -> runPlanningRules()
  -> checks + recommendations
  -> evaluateScenario()
  -> report / decision matrix / sensitivity analysis / data-quality / UPF export
```

## Current Boundaries

- UI rendering is still mostly in `main.ts`.
- Rules have moved to `planning-rules.ts`, but rule metadata is not yet declarative.
- Scenario evaluation uses transparent prototype weights and built-in sensitivity profiles; expert-calibrated AHP/entropy weights are future work.
- Geometry uses a demo canvas unit system.
- UPF validation now has a lightweight runtime validator and a draft JSON Schema. Evidence can be legacy strings or structured EvidenceSource objects, but full migration/version negotiation is still future work.
- Facility coverage uses straight-line distance.
- Reports are generated as Markdown text.

## Next Refactor

Move type definitions into `src/model/upf-types.ts`, then split UI rendering into `src/ui/*`. After that, convert rules into declarative rule objects with metadata and fixtures.
