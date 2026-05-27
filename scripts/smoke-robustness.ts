import { buildScenarioComparisonReport, buildDataQualityReport, calculateDataQuality, createUpfDocument, parseUpfText } from '../src/planning-analytics';
import { buildScenarioDecisionCsv, buildScenarioDecisionLongCsv, parseParcelIndicatorCsv } from '../src/planning-csv';
import { buildScenarioEvaluationReport, evaluateScenario } from '../src/planning-evaluation';
import { buildGeoJsonFeatureCollection, parseGeoJsonProject } from '../src/planning-geojson';
import { buildRuleCatalogReport, runPlanningRules } from '../src/planning-rules';
import { evidenceCompletenessScore, evidenceKind, evidenceSearchText, formatEvidenceForEditing, normalizeEvidenceList, type EvidenceItem } from '../src/evidence';
import { markdownTableRow, splitMarkdownTableRow } from '../src/markdown-table';
import { markdownToHtml, renderModalContent } from '../src/markdown-renderer';
import { buildUpfValidationReport, summarizeUpfValidation, type UpfValidationIssue } from '../src/upf-validation';
import { invoke, on } from '../src/ipc';

function fail(message: string): never {
    console.error(`robustness smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

function assertNoThrow(name: string, fn: () => unknown) {
    try {
        fn();
    } catch (error) {
        fail(`${name} threw: ${error instanceof Error ? error.message : String(error)}`);
    }
}

const fallbackProject = {
    scenarios: [null, {}, { id: 'base', name: 'Base' }],
    objects: [null],
};
const unitSystem = { name: 'DemoCanvasMetric', metersPerCanvasUnit: 1 };

try {
    parseUpfText(null as unknown as string, fallbackProject as never);
    fail('parseUpfText should reject malformed text inputs');
} catch (error) {
    assert(error instanceof Error && error.message.includes('不是可识别'), 'parseUpfText should fail cleanly');
}

assertNoThrow('CSV parser sparse fallback', () => parseParcelIndicatorCsv('parcel_id,scenario_id,far\np,base,1', fallbackProject as never));
assertNoThrow('CSV parser malformed fallback', () => parseParcelIndicatorCsv('parcel_id,scenario_id,far\np,base,1', null as never));
assertNoThrow('CSV parser malformed text', () => parseParcelIndicatorCsv(null as unknown as string, fallbackProject as never));
assertNoThrow('wide CSV malformed rows', () => buildScenarioDecisionCsv([null, {}] as never));
assertNoThrow('long CSV malformed rows', () => buildScenarioDecisionLongCsv([null, {}] as never));
assertNoThrow('UPF export malformed project', () => createUpfDocument(null as never, 'base', [], []));
assertNoThrow('UPF export sparse arrays', () => createUpfDocument(fallbackProject as never, 'base', [null, {}] as never, [null, {}] as never));
assertNoThrow('scenario comparison malformed project', () => buildScenarioComparisonReport(null as never, 'base'));
assertNoThrow('scenario comparison sparse project', () => buildScenarioComparisonReport(fallbackProject as never, 'base'));
assertNoThrow('quality malformed project', () => calculateDataQuality(null as never, [], []));
assertNoThrow('quality sparse signals', () => calculateDataQuality({ ...fallbackProject, ruleset: { basis: [null, ''] } } as never, [null, {}] as never, [null, {}] as never));
assertNoThrow('quality report malformed project', () => buildDataQualityReport(null as never, [], []));
assertNoThrow('quality report sparse signals', () => buildDataQualityReport({ ...fallbackProject, ruleset: { basis: [null, ''] } } as never, [null, {}] as never, [null, {}] as never));
assertNoThrow('evaluation malformed project', () => evaluateScenario(null as never, 'base'));
assertNoThrow('evaluation sparse signals', () => evaluateScenario({ ...fallbackProject, ruleset: { basis: [null, ''] } } as never, 'base', [null, {}] as never, [null, {}] as never));
assertNoThrow('evaluation malformed road points', () => evaluateScenario({ objects: [{ type: 'road', points: 'bad' }] } as never, 'base'));
assertNoThrow('evaluation report malformed project', () => buildScenarioEvaluationReport(null as never, 'base'));
assertNoThrow('evaluation report sparse signals', () => buildScenarioEvaluationReport({ ...fallbackProject, ruleset: { basis: [null, ''] } } as never, 'base', [null, {}] as never, [null, {}] as never));
assertNoThrow('rules malformed project', () => runPlanningRules(null as never, 'base'));
assertNoThrow('rules sparse objects', () => runPlanningRules({ objects: [null, {}] } as never, 'base'));
assertNoThrow('rules malformed road points', () => runPlanningRules({ objects: [{ type: 'road', points: 'bad' }] } as never, 'base'));
assertNoThrow('rule catalog sparse checks', () => buildRuleCatalogReport([null, {}] as never));
assertNoThrow('GeoJSON export malformed project', () => buildGeoJsonFeatureCollection(null as never, 'base', unitSystem));
assertNoThrow('GeoJSON export sparse objects', () => buildGeoJsonFeatureCollection({ objects: [null, {}] } as never, 'base', unitSystem));
assertNoThrow('GeoJSON parse malformed input', () => parseGeoJsonProject(null, fallbackProject as never));
assertNoThrow('GeoJSON parse malformed fallback', () => parseGeoJsonProject({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { upfType: 'facility' } }],
}, null as never));
assertNoThrow('UPF parse malformed fallback', () => parseUpfText(JSON.stringify({ objects: [], scenarios: [] }), null as never));
assertNoThrow('validation summary malformed issues', () => summarizeUpfValidation([null, {}] as unknown as UpfValidationIssue[]));
assertNoThrow('validation report malformed issues', () => buildUpfValidationReport([null, {}] as unknown as UpfValidationIssue[]));
assertNoThrow('markdown malformed inputs', () => {
    markdownToHtml(null as unknown as string);
    renderModalContent(42 as unknown as string, null as unknown as string);
    markdownTableRow('bad' as never);
    splitMarkdownTableRow(null as unknown as string);
});
assertNoThrow('evidence malformed inputs', () => {
    normalizeEvidenceList([null, {}]);
    evidenceSearchText([null, {}] as unknown as EvidenceItem[]);
    formatEvidenceForEditing([null, {}] as unknown as EvidenceItem[]);
    evidenceKind(null as unknown as EvidenceItem);
    evidenceCompletenessScore({} as unknown as EvidenceItem);
});
assertNoThrow('IPC listener without WebView', () => on(null as unknown as string, () => {})());
assertNoThrow('IPC listener malformed handler', () => on('bad', null as never)());
try {
    await invoke(null as never, null as never, null as never);
    fail('invoke should reject outside WebView2');
} catch (error) {
    assert(error instanceof Error && error.message.includes('Not running in WebView2'), 'invoke should fail cleanly outside WebView2');
}

console.log('robustness smoke passed');
