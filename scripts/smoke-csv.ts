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
const crCsv = buildScenarioDecisionCsv([{ ...rows[0], scenario: { id: 'scenario_cr', name: 'Line\rBreak' } }]);
assert(crCsv.includes('"Line\rBreak"'), 'wide CSV should quote carriage returns');
const wideWithMalformedRows = buildScenarioDecisionCsv([rows[0], { scenario: { id: 'broken' } }] as unknown as ScenarioDecisionCsvRow[]);
assert(wideWithMalformedRows.includes('scenario_a'), 'wide CSV should keep valid rows when malformed rows are present');
assert(!wideWithMalformedRows.includes('broken'), 'wide CSV should skip malformed row entries');

const long = buildScenarioDecisionLongCsv(rows);
assert(long.startsWith('scenario_id,scenario_name,metric_group,metric_id,metric_name,value,unit'), 'long CSV header mismatch');
assert(long.includes('summary,score,综合评分,86,score'), 'long CSV should include score metric');
assert(long.includes('dimension_score,compliance_score,控规符合性得分,88,score'), 'long CSV should include dimension score');
assert(long.includes('dimension_weight,publicService_weight,公共服务权重,22,percent'), 'long CSV should include dimension weight percent');
assert(buildScenarioDecisionCsv('bad' as unknown as ScenarioDecisionCsvRow[]).trim() === 'scenario_id,scenario_name,score,band,confidence,residents,residential_gfa_sqm,public_service_gfa_sqm,rule_errors,rule_warnings', 'wide CSV should tolerate malformed row collections');
const longWithMalformedDimensions = buildScenarioDecisionLongCsv([{
    ...rows[0],
    evaluation: { ...rows[0].evaluation, dimensions: [rows[0].evaluation.dimensions[0], 'bad'] },
} as unknown as ScenarioDecisionCsvRow]);
assert(longWithMalformedDimensions.includes('summary,score,综合评分,86,score'), 'long CSV should keep summary metrics when dimensions are malformed');
assert(longWithMalformedDimensions.includes('dimension_score,compliance_score'), 'long CSV should keep valid dimensions when malformed dimensions are present');
assert(!longWithMalformedDimensions.includes('undefined_score'), 'long CSV should skip malformed dimension entries');
const longWithMalformedRows = buildScenarioDecisionLongCsv([rows[0], { scenario: { id: 'broken' } }] as unknown as ScenarioDecisionCsvRow[]);
assert(longWithMalformedRows.includes('scenario_a') && !longWithMalformedRows.includes('broken'), 'long CSV should skip malformed row entries');

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
        } as Record<string, { far?: number; buildingCoverage?: number; greenRatio?: number; residentialGfaSqm?: number; publicServiceGfaSqm?: number; notes?: string }>,
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

const parsedMalformedFallback = parseParcelIndicatorCsv([
    'parcel_id,scenario_id,far',
    'parcel_a,update,2.0',
].join('\n'), { scenarios: 'bad', objects: 'bad' } as unknown as typeof fallback);
assert(parsedMalformedFallback?.project.objects.length === 0 && parsedMalformedFallback.importSummary.skippedRows === 1, 'CSV import should tolerate malformed fallback collections');

const multilineCsv = [
    'parcel_id,scenario_id,far,notes',
    'parcel_a,multiline,2.1,"line 1',
    'line 2, with comma and ""quote"""',
].join('\n');
const parsedMultiline = parseParcelIndicatorCsv(multilineCsv, fallback);
const multilineParcel = parsedMultiline?.project.objects.find(object => object.id === 'parcel_a');
assert(parsedMultiline?.importSummary.rowCount === 1, 'CSV import should treat quoted newlines as one row');
assert(multilineParcel?.scenarioValues?.multiline?.notes === 'line 1\nline 2, with comma and "quote"', 'CSV import should parse quoted multiline notes');

const unclosedQuoteCsv = [
    'parcel_id,scenario_id,notes',
    'parcel_a,broken,"unterminated note',
].join('\n');
assert(parseParcelIndicatorCsv(unclosedQuoteCsv, fallback) === undefined, 'CSV import should reject unclosed quoted cells');

const embeddedQuoteCsv = [
    'parcel_id,scenario_id,notes',
    'parcel_a,broken,unquoted"quote',
].join('\n');
assert(parseParcelIndicatorCsv(embeddedQuoteCsv, fallback) === undefined, 'CSV import should reject quotes embedded in unquoted cells');

const trailingQuoteGarbageCsv = [
    'parcel_id,scenario_id,notes',
    'parcel_a,broken,"quoted"x',
].join('\n');
assert(parseParcelIndicatorCsv(trailingQuoteGarbageCsv, fallback) === undefined, 'CSV import should reject non-delimiter content after closing quotes');

const quotedTrailingSpaceCsv = [
    'parcel_id,scenario_id,notes',
    'parcel_a,quote_space,"quoted note"   ',
].join('\n');
const parsedQuotedTrailingSpace = parseParcelIndicatorCsv(quotedTrailingSpaceCsv, fallback);
assert(parsedQuotedTrailingSpace?.project.objects[0].scenarioValues?.quote_space?.notes === 'quoted note', 'CSV import should allow whitespace after closing quotes');

const formattedNumberCsv = [
    'parcel_id,scenario_id,far,building_coverage,green_ratio,residential_gfa_sqm,public_service_gfa_sqm',
    'parcel_a,formatted,2.8,31%,36%,"42,000","1,200"',
].join('\n');
const parsedFormattedNumbers = parseParcelIndicatorCsv(formattedNumberCsv, fallback);
const formattedParcel = parsedFormattedNumbers?.project.objects.find(object => object.id === 'parcel_a');
assert(formattedParcel?.scenarioValues?.formatted?.buildingCoverage === 0.31, 'CSV import should parse percentage building coverage');
assert(formattedParcel?.scenarioValues?.formatted?.greenRatio === 0.36, 'CSV import should parse percentage green ratio');
assert(formattedParcel?.scenarioValues?.formatted?.residentialGfaSqm === 42000, 'CSV import should parse thousands-separated residential GFA');
assert(formattedParcel?.scenarioValues?.formatted?.publicServiceGfaSqm === 1200, 'CSV import should parse thousands-separated public service GFA');

const invalidValueCsv = [
    'parcel_id,scenario_id,far,building_coverage,green_ratio,residential_gfa_sqm',
    'parcel_a,stress,99,1.4,-0.1,not_a_number',
].join('\n');
const parsedInvalidValues = parseParcelIndicatorCsv(invalidValueCsv, fallback);
assert(parsedInvalidValues?.importSummary.updatedRows === 0 && parsedInvalidValues.importSummary.skippedRows === 1, 'CSV import should not count invalid-only rows as updates');
assert(parsedInvalidValues?.importSummary.invalidFields.length === 4, 'CSV import should summarize invalid numeric fields');
const stressParcel = parsedInvalidValues?.project.objects.find(object => object.id === 'parcel_a');
assert(!stressParcel?.scenarioValues?.stress, 'CSV import should not create scenario values when every field is invalid');

const malformedThousandsCsv = [
    'parcel_id,scenario_id,far,residential_gfa_sqm',
    'parcel_a,malformed,"3,2","42,00"',
].join('\n');
const parsedMalformedThousands = parseParcelIndicatorCsv(malformedThousandsCsv, fallback);
assert(parsedMalformedThousands?.importSummary.updatedRows === 0 && parsedMalformedThousands.importSummary.skippedRows === 1, 'CSV import should reject malformed thousands-separated numbers');
assert(parsedMalformedThousands?.importSummary.invalidFields.length === 2, 'CSV import should summarize malformed thousands-separated fields');
const malformedParcel = parsedMalformedThousands?.project.objects.find(object => object.id === 'parcel_a');
assert(!malformedParcel?.scenarioValues?.malformed, 'CSV import should not create scenario values for malformed thousands-only rows');

const hexNumberCsv = [
    'parcel_id,scenario_id,far',
    'parcel_a,hex,"0x10"',
].join('\n');
const parsedHexNumber = parseParcelIndicatorCsv(hexNumberCsv, fallback);
assert(parsedHexNumber?.importSummary.updatedRows === 0 && parsedHexNumber.importSummary.invalidFields.length === 1, 'CSV import should reject hexadecimal numeric strings');
const hexParcel = parsedHexNumber?.project.objects.find(object => object.id === 'parcel_a');
assert(!hexParcel?.scenarioValues?.hex, 'CSV import should not create scenario values for hexadecimal numeric strings');

const noUpdateCsv = [
    'parcel_id,scenario_id',
    'parcel_a,empty_update',
].join('\n');
const parsedNoUpdate = parseParcelIndicatorCsv(noUpdateCsv, fallback);
assert(parsedNoUpdate?.importSummary.updatedRows === 0 && parsedNoUpdate.importSummary.skippedRows === 1, 'CSV import should skip matched rows without update fields');
assert(!parsedNoUpdate?.project.scenarios.some(scenario => scenario.id === 'empty_update'), 'CSV import should not create scenarios for no-op rows');

const numericFallback = {
    scenarios: [{ id: 'base', name: 'Base', description: 'Existing scenario' }],
    objects: [{
        id: 0,
        type: 'parcel',
        name: 'Zero Parcel',
        scenarioValues: {},
    }],
} as unknown as typeof fallback;
const parsedNumericId = parseParcelIndicatorCsv([
    'parcel_id,scenario_id,far',
    '0,zero_update,2.4',
].join('\n'), numericFallback);
assert(parsedNumericId?.importSummary.updatedRows === 1, 'CSV import should match numeric zero parcel ids');
assert(parsedNumericId?.project.objects[0].scenarioValues?.zero_update?.far === 2.4, 'CSV import should update numeric zero parcel ids');

const malformedScenarioValuesFallback = {
    scenarios: [{ id: 0, name: 'Zero', description: 'Existing numeric scenario' }],
    objects: [{
        id: 'parcel_a',
        type: 'parcel',
        name: 'Parcel A',
        scenarioValues: 'bad',
    }],
} as unknown as typeof fallback;
const parsedMalformedScenarioValues = parseParcelIndicatorCsv([
    'parcel_id,scenario_id,far',
    'parcel_a,0,2.4',
].join('\n'), malformedScenarioValuesFallback);
const malformedScenarioValue = parsedMalformedScenarioValues?.project.objects[0].scenarioValues?.['0'] as { far?: number; 0?: unknown } | undefined;
assert(malformedScenarioValue?.far === 2.4 && malformedScenarioValue[0] === undefined, 'CSV import should ignore malformed fallback scenario value maps');

const trimmedScenarioFallback = {
    scenarios: [{ id: ' update ', name: 'Update', description: 'Existing scenario with whitespace' }],
    objects: [{
        id: 'parcel_a',
        type: 'parcel',
        name: 'Parcel A',
        scenarioValues: {
            ' update ': { far: 1.1, notes: 'existing note' },
        },
    }],
} as unknown as typeof fallback;
const parsedTrimmedScenario = parseParcelIndicatorCsv([
    'parcel_id,scenario_id,far',
    'parcel_a,update,2.4',
].join('\n'), trimmedScenarioFallback);
assert(parsedTrimmedScenario?.project.scenarios.length === 1, 'CSV import should not duplicate scenarios whose ids differ only by whitespace');
assert(parsedTrimmedScenario?.importSummary.scenarioIds.join(',') === 'update', 'CSV import summary should normalize scenario ids');
assert(parsedTrimmedScenario?.project.objects[0].scenarioValues?.update?.far === 2.4, 'CSV import should update trimmed scenario keys');
assert(parsedTrimmedScenario?.project.objects[0].scenarioValues?.update?.notes === 'existing note', 'CSV import should merge existing trimmed scenario values');

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
