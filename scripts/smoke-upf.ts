import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
    buildDataQualityReport,
    buildScenarioComparisonReport,
    calculateDataQuality,
    createUpfDocument,
    parseUpfText,
} from '../src/planning-analytics';
import { buildUpfValidationReport, validateUpfDocument } from '../src/upf-validation';

const ROOT = resolve(import.meta.dir, '..');
const examples = join(ROOT, 'examples');
const schemas = join(ROOT, 'schemas');

function fail(message: string): never {
    console.error(`upf smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const fallback = {
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'fallback', name: 'Fallback' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: [] },
    scenarios: [{ id: 'scenario_base', name: 'Base' }],
    objects: [],
};

const minimalText = readFileSync(join(examples, 'minimal.upf'), 'utf8');
const minimalRaw = JSON.parse(minimalText);
const minimalIssues = validateUpfDocument(minimalRaw);
assert(!minimalIssues.some(issue => issue.severity === 'error'), 'minimal should have no schema errors');
assert(buildUpfValidationReport(minimalIssues).includes('UPF 结构校验报告'), 'validation report title mismatch');
const minimal = parseUpfText(minimalText, fallback);
assert(minimal.project.project?.id === 'minimal_demo', 'minimal project id mismatch');
assert(minimal.activeScenarioId === 'scenario_base', 'minimal active scenario mismatch');

const roundTrip = createUpfDocument(minimal.project, minimal.activeScenarioId, [], [], {
    scenarioId: minimal.activeScenarioId,
    modelId: 'balanced',
    modelName: '均衡模型',
    weights: { compliance: 0.24, publicService: 0.22, mobility: 0.16, ecology: 0.16, renewalValue: 0.12, evidence: 0.10 },
    score: 88,
    dimensions: [],
    riskRegister: [],
});
assert(roundTrip.manifest.software.version === '0.1.0', 'manifest software version mismatch');
assert(roundTrip.manifest.activeScenarioId === minimal.activeScenarioId, 'manifest active scenario mismatch');
assert(roundTrip.manifest.unitSystem.metersPerCanvasUnit === 0.68, 'manifest unit system mismatch');
assert((roundTrip.evaluation as { score?: number }).score === 88, 'evaluation export mismatch');
assert((roundTrip.evaluation as { modelId?: string }).modelId === 'balanced', 'evaluation model id export mismatch');
assert((roundTrip.evaluation as { modelName?: string }).modelName === '均衡模型', 'evaluation model name export mismatch');
assert(Array.isArray((roundTrip.evaluation as { riskRegister?: unknown[] }).riskRegister), 'evaluation risk register export mismatch');
const parsedRoundTrip = parseUpfText(JSON.stringify(roundTrip), fallback);
assert(parsedRoundTrip.project.format === 'UPF', 'round-trip format mismatch');
assert(parsedRoundTrip.project.objects?.length === 1, 'round-trip objects mismatch');

const analyticsFixture: Parameters<typeof calculateDataQuality>[0] = {
    project: { name: 'Analytics Fixture' },
    ruleset: { basis: ['fixture basis'] },
    scenarios: [{ id: 'base', name: 'Base' }, { id: 'update', name: 'Update' }],
    objects: [
        {
            id: 'parcel_a',
            type: 'parcel',
            name: 'Parcel A',
            evidence: ['fixture survey'],
            points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 },
            ],
            scenarioValues: {
                base: { far: 1.2, greenRatio: 0.3, residentialGfaSqm: 12000, publicServiceGfaSqm: 400 },
            },
        },
        {
            id: 'parcel_b',
            type: 'parcel',
            name: 'Parcel B',
            evidence: ['fixture survey'],
            points: [
                { x: 120, y: 0 },
                { x: 220, y: 0 },
                { x: 220, y: 100 },
                { x: 120, y: 100 },
            ],
            scenarioValues: {
                base: { far: 1, greenRatio: 0.25, residentialGfaSqm: 9000, publicServiceGfaSqm: 100 },
                update: { far: 1.5, greenRatio: 0.32, residentialGfaSqm: 14000, publicServiceGfaSqm: 500 },
            },
        },
        {
            id: 'entrance_bad',
            type: 'entrance',
            name: 'Bad Entrance',
            evidence: ['fixture survey'],
            parcelId: 'missing_parcel',
            roadId: 'missing_road',
        },
    ],
};
const quality = calculateDataQuality(analyticsFixture, [], []);
assert(quality.score < 100, 'data quality should penalize missing scenario values and dangling references');
assert(quality.entranceReferenceIssues.length === 2, 'dangling entrance references should be reported');
assert(buildDataQualityReport(analyticsFixture, [], []).includes('引用完整性问题'), 'quality report should expose reference issues');
const comparison = buildScenarioComparisonReport(analyticsFixture, 'update');
assert(comparison.includes('参与地块') && comparison.includes('Update 缺失 1 个地块'), 'scenario comparison should expose missing values');

const schema = JSON.parse(readFileSync(join(schemas, 'upf-0.1.schema.json'), 'utf8'));
assert(schema.title === 'Urban Planning Format 0.1', 'json schema title mismatch');

try {
    const invalidText = readFileSync(join(examples, 'invalid.upf'), 'utf8');
    const invalidIssues = validateUpfDocument(JSON.parse(invalidText));
    assert(invalidIssues.some(issue => issue.severity === 'error'), 'invalid.upf should have validation errors');
    parseUpfText(invalidText, fallback);
    fail('invalid.upf should be rejected');
} catch (error) {
    assert(error instanceof Error && error.message.includes('不是可识别'), 'invalid error message mismatch');
}

console.log('upf smoke passed');
