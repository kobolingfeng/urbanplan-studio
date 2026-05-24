import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
    buildDataQualityReport,
    buildScenarioComparisonReport,
    calculateDataQuality,
    createUpfDocument,
    parseUpfText,
} from '../src/planning-analytics';
import { SERVICE_DEMAND_ASSUMPTIONS } from '../src/planning-assumptions';
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
const minimalObjects = minimal.project.objects as Array<{ evidence?: unknown[] }> | undefined;
assert(typeof minimalObjects?.[0]?.evidence?.[0] === 'object', 'minimal evidence should demonstrate structured EvidenceSource');
const stringConfidenceRaw = JSON.parse(minimalText);
stringConfidenceRaw.objects[0].evidence[0].confidence = '0.82';
const stringConfidenceIssues = validateUpfDocument(stringConfidenceRaw);
assert(stringConfidenceIssues.some(issue => issue.severity === 'info' && issue.path.endsWith('.confidence') && issue.message.includes('字符串数字')), 'numeric-string confidence should be reported as compatible');
assert(!stringConfidenceIssues.some(issue => issue.severity === 'warning' && issue.path.endsWith('.confidence')), 'numeric-string confidence should not be warned as invalid');

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
            evidence: [{
                title: 'fixture survey',
                type: 'survey',
                collectedAt: '2026-05-23',
                precision: 'parcel fixture',
                confidence: 0.9,
                license: 'test',
            }],
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
assert(quality.structuredEvidenceCoverage > 0 && quality.structuredEvidenceCoverage < 100, 'mixed evidence should report partial structured coverage');
assert(quality.averageEvidenceConfidence > 0, 'evidence confidence should be calculated');
assert(quality.entranceReferenceIssues.length === 2, 'dangling entrance references should be reported');
const qualityReport = buildDataQualityReport(analyticsFixture, [], []);
assert(qualityReport.includes('引用完整性问题'), 'quality report should expose reference issues');
assert(qualityReport.includes('结构化证据覆盖率'), 'quality report should expose structured evidence coverage');
assert(qualityReport.includes('扣分项') && qualityReport.includes('出入口引用问题'), 'quality report should explain score deductions');
const comparison = buildScenarioComparisonReport(analyticsFixture, 'update');
assert(comparison.includes('参与地块') && comparison.includes('Update 缺失 1 个地块'), 'scenario comparison should expose missing values');
assert(comparison.includes(String(Math.round(14000 / SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident))), 'scenario comparison should use shared resident assumptions');

const numericReferenceQuality = calculateDataQuality({
    project: { name: 'Numeric Reference Fixture' },
    ruleset: { basis: ['fixture basis'] },
    scenarios: [{ id: 'base', name: 'Base' }],
    objects: [
        { id: 0, type: 'parcel', name: 'Zero Parcel', evidence: ['fixture'], scenarioValues: { base: {} } },
        { id: 0, type: 'road', name: 'Zero Road', evidence: ['fixture'] },
        { id: 'entrance_zero', type: 'entrance', name: 'Zero Entrance', evidence: ['fixture'], parcelId: 0, roadId: 0 },
    ],
} as unknown as Parameters<typeof calculateDataQuality>[0], [], []);
assert(numericReferenceQuality.entranceReferenceIssues.length === 0, 'data quality should accept numeric zero ids and references');

const schema = JSON.parse(readFileSync(join(schemas, 'upf-0.1.schema.json'), 'utf8'));
assert(schema.title === 'Urban Planning Format 0.1', 'json schema title mismatch');
assert(schema.properties?.manifest?.properties?.unitSystem?.properties?.metersPerCanvasUnit, 'json schema should describe UPF manifest unit system');

const mixedCoordinateIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: {
        id: 'mixed_crs',
        name: 'Mixed CRS',
        city: '深圳市',
        district: '罗湖区',
        planningType: 'CRS smoke',
        planningHorizon: '2026-2035',
        crs: 'EPSG:4490',
    },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'CRS fixture' }],
    objects: [{
        id: 'parcel_bad_crs',
        type: 'parcel',
        name: 'Bad CRS Parcel',
        evidence: ['fixture'],
        points: [
            { x: 160, y: 140 },
            { x: 360, y: 140 },
            { x: 360, y: 280 },
            { x: 160, y: 280 },
        ],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3.5, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            base: { far: 3, buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }],
});
assert(mixedCoordinateIssues.some(issue => issue.severity === 'error' && issue.message.includes('疑似混入')), 'EPSG:4490 mixed canvas coordinates should be rejected');

const degeneratePolygonIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'degenerate', name: 'Degenerate', city: '深圳市', district: '罗湖区', planningType: 'Geometry smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Geometry fixture' }],
    objects: [{
        id: 'parcel_line',
        type: 'parcel',
        name: 'Line Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            base: { far: 2, buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }],
});
assert(degeneratePolygonIssues.some(issue => issue.severity === 'error' && issue.message.includes('面积接近 0')), 'degenerate parcel polygons should be rejected');

const outOfRangeIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'range', name: 'Range', city: '深圳市', district: '罗湖区', planningType: 'Range smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Range fixture' }],
    objects: [{
        id: 'parcel_range',
        type: 'parcel',
        name: 'Range Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 20, buildingCoverageMax: 1.4, greenRatioMin: -0.1, heightMaxM: 1200 },
        scenarioValues: {
            base: { far: 99, buildingCoverage: 1.2, greenRatio: -0.1, residentialGfaSqm: -1, publicServiceGfaSqm: 9_000_000, updateMode: '综合整治' },
        },
    }, {
        id: 'road_range',
        type: 'road',
        name: 'Range Road',
        evidence: ['fixture'],
        points: [{ x: 0, y: 90 }, { x: 80, y: 90 }],
        level: '支路',
        redLineWidthM: -1,
        lanes: 20,
    }, {
        id: 'facility_range',
        type: 'facility',
        name: 'Range Facility',
        evidence: ['fixture'],
        point: { x: 40, y: 40 },
        kind: '社区卫生',
        capacity: -1,
        serviceRadiusM: 50_000,
        planned: true,
    }],
});
const rangeErrors = outOfRangeIssues.filter(issue => issue.severity === 'error' && issue.message.includes('超出允许范围'));
assert(rangeErrors.length >= 13, 'UPF validation should reject out-of-range parcel indicators, controls, roads, and facilities');
for (const path of ['objects[1].redLineWidthM', 'objects[1].lanes', 'objects[2].capacity', 'objects[2].serviceRadiusM']) {
    assert(rangeErrors.some(issue => issue.path === path), `UPF validation should reject ${path}`);
}

const undefinedReferenceIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'undefined_ref', name: 'Undefined Ref', city: '深圳市', district: '罗湖区', planningType: 'Reference smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Reference fixture' }],
    objects: [{
        type: 'parcel',
        name: 'Missing Id Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            base: { far: 2, buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }, {
        id: 'road_ok',
        type: 'road',
        name: 'Road OK',
        evidence: ['fixture'],
        points: [{ x: 0, y: 90 }, { x: 80, y: 90 }],
        level: '支路',
        redLineWidthM: 18,
        lanes: 2,
    }, {
        id: 'entrance_undefined',
        type: 'entrance',
        name: 'Undefined Parcel Entrance',
        evidence: ['fixture'],
        point: { x: 10, y: 10 },
        entranceType: '机动车',
        parcelId: 'undefined',
        roadId: 'road_ok',
    }],
});
assert(undefinedReferenceIssues.some(issue => issue.path === 'objects[2].parcelId' && issue.message.includes('不存在')), 'UPF validation should not treat missing object ids as undefined references');

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
