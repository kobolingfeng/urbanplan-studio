import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
    buildScenarioDecisionCsv,
    buildScenarioDecisionLongCsv,
    parseParcelIndicatorCsv,
    type ScenarioDecisionCsvRow,
} from '../src/planning-csv';
import { parseUpfText } from '../src/planning-analytics';

const ROOT = resolve(import.meta.dir, '..');

function fail(message: string): never {
    console.error(`csv smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const rows: ScenarioDecisionCsvRow[] = [{
    scenario: { id: 'scenario_a', name: '方案 A, 引号"测试' },
    evaluation: {
        score: 86,
        band: '良好',
        confidence: 74,
        dimensions: [
            { id: 'compliance', name: '控规符合性', score: 88, weight: 0.24 },
            { id: 'publicService', name: '公共服务', score: 72, weight: 0.22 },
        ],
    },
    residents: 1280,
    residentialGfa: 42200.6,
    publicServiceGfa: 880.2,
    errors: 1,
    warnings: 3,
}];

const wide = buildScenarioDecisionCsv(rows);
assert(wide.startsWith('scenario_id,scenario_name,score'), 'wide CSV header mismatch');
assert(wide.includes('"方案 A, 引号""测试"'), 'wide CSV should escape commas and quotes');
assert(wide.includes(',42201,880,'), 'wide CSV should round floor area values');

const long = buildScenarioDecisionLongCsv(rows);
assert(long.startsWith('scenario_id,scenario_name,metric_group,metric_id,metric_name,value,unit'), 'long CSV header mismatch');
assert(long.includes('summary,score,综合评分,86,score'), 'long CSV should include score metric');
assert(long.includes('dimension_score,compliance_score,控规符合性得分,88,score'), 'long CSV should include dimension score');
assert(long.includes('dimension_weight,publicService_weight,公共服务权重,22,percent'), 'long CSV should include dimension weight percent');

const fallback = {
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'csv_fixture', name: 'CSV Fixture' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: [] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Existing scenario' }],
    objects: [{
        id: 'parcel_a',
        type: 'parcel',
        name: 'Parcel A',
        scenarioValues: {
            base: { far: 1, buildingCoverage: 0.2, greenRatio: 0.25 },
        } as Record<string, { far?: number; buildingCoverage?: number; greenRatio?: number; notes?: string }>,
    }],
};
const parcelCsv = [
    'parcel_id,scenario_id,far,building_coverage,green_ratio,residential_gfa_sqm,public_service_gfa_sqm,update_mode,notes',
    'parcel_a,update,2.6,0.31,0.36,42000,900,综合整治,"quoted, note"',
    'missing_parcel,update,1.2,0.2,0.3,1000,50,综合整治,should skip',
].join('\n');
const parsedCsv = parseParcelIndicatorCsv(parcelCsv, fallback);
assert(parsedCsv?.activeScenarioId === 'update', 'CSV import should activate imported scenario');
assert(parsedCsv?.project.scenarios.some(scenario => scenario.id === 'update'), 'CSV import should add missing scenario');
assert(parsedCsv?.importSummary.updatedRows === 1 && parsedCsv.importSummary.skippedRows === 1, 'CSV import should summarize updated and skipped rows');
assert(parsedCsv?.importSummary.unmatchedParcelIds.includes('missing_parcel'), 'CSV import should report unmatched parcel IDs');
const importedParcel = parsedCsv?.project.objects.find(object => object.id === 'parcel_a');
assert(importedParcel?.scenarioValues?.update?.far === 2.6, 'CSV import should update FAR');
assert(importedParcel?.scenarioValues?.update?.notes === 'quoted, note', 'CSV import should parse quoted cells');
const parsedViaUpf = parseUpfText(parcelCsv, fallback);
assert(parsedViaUpf.activeScenarioId === 'update', 'UPF parser should accept parcel CSV');

const unmatchedOnlyCsv = [
    'parcel_id,scenario_id,far',
    'missing_a,update,2.0',
    'missing_b,update,3.0',
].join('\n');
const parsedUnmatchedOnly = parseParcelIndicatorCsv(unmatchedOnlyCsv, fallback);
assert(parsedUnmatchedOnly?.importSummary.updatedRows === 0, 'CSV import should recognize unmatched-only indicator files');
assert(parsedUnmatchedOnly?.importSummary.skippedRows === 2, 'CSV import should report all unmatched rows as skipped');
assert(parsedUnmatchedOnly?.importSummary.unmatchedParcelIds.join(',') === 'missing_a,missing_b', 'CSV import should keep unmatched parcel IDs when no rows update');
const parsedUnmatchedViaUpf = parseUpfText(unmatchedOnlyCsv, fallback);
assert((parsedUnmatchedViaUpf as { importSummary?: { updatedRows?: number } }).importSummary?.updatedRows === 0, 'UPF parser should surface unmatched-only CSV import summaries');

const multilineCsv = [
    'parcel_id,scenario_id,far,notes',
    'parcel_a,multiline,2.1,"line 1',
    'line 2, with comma and ""quote"""',
].join('\n');
const parsedMultiline = parseParcelIndicatorCsv(multilineCsv, fallback);
const multilineParcel = parsedMultiline?.project.objects.find(object => object.id === 'parcel_a');
assert(parsedMultiline?.importSummary.rowCount === 1, 'CSV import should treat quoted newlines as one row');
assert(multilineParcel?.scenarioValues?.multiline?.notes === 'line 1\nline 2, with comma and "quote"', 'CSV import should parse quoted multiline notes');

const invalidValueCsv = [
    'parcel_id,scenario_id,far,building_coverage,green_ratio,residential_gfa_sqm',
    'parcel_a,stress,99,1.4,-0.1,not_a_number',
].join('\n');
const parsedInvalidValues = parseParcelIndicatorCsv(invalidValueCsv, fallback);
assert(parsedInvalidValues?.importSummary.updatedRows === 0 && parsedInvalidValues.importSummary.skippedRows === 1, 'CSV import should not count invalid-only rows as updates');
assert(parsedInvalidValues?.importSummary.invalidFields.length === 4, 'CSV import should summarize invalid numeric fields');
const stressParcel = parsedInvalidValues?.project.objects.find(object => object.id === 'parcel_a');
assert(!stressParcel?.scenarioValues?.stress, 'CSV import should not create scenario values when every field is invalid');

const noUpdateCsv = [
    'parcel_id,scenario_id',
    'parcel_a,empty_update',
].join('\n');
const parsedNoUpdate = parseParcelIndicatorCsv(noUpdateCsv, fallback);
assert(parsedNoUpdate?.importSummary.updatedRows === 0 && parsedNoUpdate.importSummary.skippedRows === 1, 'CSV import should skip matched rows without update fields');
assert(!parsedNoUpdate?.project.scenarios.some(scenario => scenario.id === 'empty_update'), 'CSV import should not create scenarios for no-op rows');

const exampleCsv = readFileSync(join(ROOT, 'examples', 'parcel-indicators.csv'), 'utf8');
const exampleFallback = {
    scenarios: [{ id: 'scenario_public', name: 'Public', description: 'Existing scenario' }],
    objects: ['parcel_01', 'parcel_02', 'parcel_03'].map(id => ({
        id,
        type: 'parcel',
        name: id,
        scenarioValues: {} as Record<string, { far?: number; publicServiceGfaSqm?: number }>,
    })),
};
const parsedExample = parseParcelIndicatorCsv(exampleCsv, exampleFallback);
assert(parsedExample?.project.objects[0].scenarioValues.scenario_public?.far === 3.6, 'example CSV should update parcel_01 FAR');
assert(parsedExample?.project.objects[2].scenarioValues.scenario_public?.publicServiceGfaSqm === 2000, 'example CSV should update parcel_03 public service GFA');

console.log('csv smoke passed');
