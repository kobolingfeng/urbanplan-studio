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
const trimmedActiveScenario = parseUpfText(JSON.stringify({
    ...minimalRaw,
    activeScenarioId: ' scenario_base ',
}), fallback);
assert(trimmedActiveScenario.activeScenarioId === 'scenario_base', 'UPF parser should trim active scenario ids');
const manifestActiveScenario = parseUpfText(JSON.stringify({
    ...minimalRaw,
    activeScenarioId: ' ',
    manifest: { ...minimalRaw.manifest, activeScenarioId: ' scenario_base ' },
}), fallback);
assert(manifestActiveScenario.activeScenarioId === 'scenario_base', 'UPF parser should fall back to manifest active scenario ids');
const minimalWithBom = parseUpfText(`\uFEFF${minimalText}`, fallback);
assert(minimalWithBom.project.project?.id === 'minimal_demo', 'UPF parser should accept JSON files with UTF-8 BOM');
const minimalObjects = minimal.project.objects as Array<{ evidence?: unknown[] }> | undefined;
assert(typeof minimalObjects?.[0]?.evidence?.[0] === 'object', 'minimal evidence should demonstrate structured EvidenceSource');
const stringConfidenceRaw = JSON.parse(minimalText);
stringConfidenceRaw.objects[0].evidence[0].confidence = '0.82';
const stringConfidenceIssues = validateUpfDocument(stringConfidenceRaw);
assert(stringConfidenceIssues.some(issue => issue.severity === 'info' && issue.path.endsWith('.confidence') && issue.message.includes('字符串数字')), 'numeric-string confidence should be reported as compatible');
assert(!stringConfidenceIssues.some(issue => issue.severity === 'warning' && issue.path.endsWith('.confidence')), 'numeric-string confidence should not be warned as invalid');
const percentSignConfidenceRaw = JSON.parse(minimalText);
percentSignConfidenceRaw.objects[0].evidence[0].confidence = '86%';
const percentSignConfidenceIssues = validateUpfDocument(percentSignConfidenceRaw);
assert(percentSignConfidenceIssues.some(issue => issue.severity === 'info' && issue.path.endsWith('.confidence')), 'percent-suffixed confidence strings should be reported as compatible');
assert(!percentSignConfidenceIssues.some(issue => issue.severity === 'warning' && issue.path.endsWith('.confidence')), 'percent-suffixed confidence strings should not be warned as invalid');

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
const malformedBasisQuality = calculateDataQuality({
    project: { name: 'Malformed Basis Quality' },
    ruleset: { basis: 'not an array' },
    objects: [],
} as unknown as Parameters<typeof calculateDataQuality>[0], [], []);
assert(malformedBasisQuality.basisCount === 0, 'data quality should ignore non-array ruleset basis values');
const malformedObjectsQuality = calculateDataQuality({
    project: { name: 'Malformed Objects Quality' },
    objects: 'not an array',
} as unknown as Parameters<typeof calculateDataQuality>[0], [], []);
assert(malformedObjectsQuality.objectCount === 0, 'data quality should ignore non-array object collections');
const comparison = buildScenarioComparisonReport(analyticsFixture, 'update');
assert(comparison.includes('参与地块') && comparison.includes('Update 缺失 1 个地块'), 'scenario comparison should expose missing values');
assert(comparison.includes(String(Math.round(14000 / SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident))), 'scenario comparison should use shared resident assumptions');
const degenerateComparison = buildScenarioComparisonReport({
    project: { name: 'Degenerate Comparison' },
    scenarios: [{ id: 'base', name: 'Base' }],
    objects: [{
        id: 'parcel_valid',
        type: 'parcel',
        name: 'Valid Parcel',
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        scenarioValues: { base: { far: 2, greenRatio: 0.3, residentialGfaSqm: 12000, publicServiceGfaSqm: 400 } },
    }, {
        id: 'parcel_line',
        type: 'parcel',
        name: 'Line Parcel',
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
        scenarioValues: { base: { far: 8, greenRatio: 0.1, residentialGfaSqm: 50000, publicServiceGfaSqm: 0 } },
    }],
}, 'base');
assert(degenerateComparison.includes('| Base | 1/1 | 0 |'), 'scenario comparison should exclude degenerate parcel geometry');

const coercedGeometryComparison = buildScenarioComparisonReport({
    project: { name: 'Coerced Geometry Comparison' },
    scenarios: [{ id: 'base', name: 'Base' }],
    objects: [{
        id: 'parcel_hex_coordinate',
        type: 'parcel',
        name: 'Hex Coordinate Parcel',
        points: [{ x: 0, y: 0 }, { x: '0x10', y: 0 }, { x: '0x10', y: 80 }, { x: 0, y: 80 }],
        scenarioValues: { base: { far: 2, greenRatio: 0.3, residentialGfaSqm: 12000, publicServiceGfaSqm: 400 } },
    }],
} as unknown as Parameters<typeof buildScenarioComparisonReport>[0], 'base');
assert(coercedGeometryComparison.includes('| Base | 0/0 | 0 |'), 'scenario comparison should reject string-coerced polygon coordinates');

const malformedObjectsComparison = buildScenarioComparisonReport({
    project: { name: 'Malformed Objects Comparison' },
    scenarios: [{ id: 'base', name: 'Base' }],
    objects: 'not an array',
} as unknown as Parameters<typeof buildScenarioComparisonReport>[0], 'base');
assert(malformedObjectsComparison.includes('| Base | 0/0 | 0 |'), 'scenario comparison should ignore non-array object collections');
const malformedScenariosComparison = buildScenarioComparisonReport({
    project: { name: 'Malformed Scenarios Comparison' },
    scenarios: 'not an array',
    objects: [],
} as unknown as Parameters<typeof buildScenarioComparisonReport>[0], 'base');
assert(malformedScenariosComparison.includes('所有方案均覆盖全部地块'), 'scenario comparison should ignore non-array scenario collections');

const malformedNumericComparison = buildScenarioComparisonReport({
    project: { name: 'Malformed Numeric Comparison' },
    scenarios: [{ id: 'base', name: 'Base' }],
    objects: [{
        id: 'parcel_malformed',
        type: 'parcel',
        name: 'Malformed Numeric Parcel',
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        scenarioValues: {
            base: { far: 'not_a_number', greenRatio: '3,2', residentialGfaSqm: 'bad', publicServiceGfaSqm: '1,200' },
        },
    }],
} as unknown as Parameters<typeof buildScenarioComparisonReport>[0], 'base');
assert(!malformedNumericComparison.includes('NaN'), 'scenario comparison should not emit NaN for malformed numeric values');
assert(malformedNumericComparison.includes('1,200'), 'scenario comparison should still accept strict thousands-formatted numeric strings');

const trimmedScenarioProject = {
    project: { name: 'Trimmed Scenario Analytics' },
    ruleset: { basis: ['fixture basis'] },
    scenarios: [{ id: ' base ', name: 'Base' }],
    objects: [{
        id: 'parcel_trimmed_scenario',
        type: 'parcel',
        name: 'Trimmed Scenario Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        scenarioValues: { base: { far: 2, greenRatio: 0.3, residentialGfaSqm: 12000, publicServiceGfaSqm: 400 } },
    }],
};
const trimmedScenarioComparison = buildScenarioComparisonReport(trimmedScenarioProject, 'base');
assert(trimmedScenarioComparison.includes('| Base | 1/1 | 0 |'), 'scenario comparison should trim scenario ids before value lookup');
const trimmedScenarioQuality = calculateDataQuality(trimmedScenarioProject, [], []);
assert(trimmedScenarioQuality.parcelScenarioGaps.length === 0, 'data quality should trim scenario ids before gap checks');
const trimmedScenarioValueKeyProject = {
    ...trimmedScenarioProject,
    scenarios: [{ id: 'base', name: 'Base' }],
    objects: [{
        ...trimmedScenarioProject.objects[0],
        scenarioValues: { ' base ': { far: 2, greenRatio: 0.3, residentialGfaSqm: 12000, publicServiceGfaSqm: 400 } },
    }],
};
const trimmedScenarioValueKeyComparison = buildScenarioComparisonReport(trimmedScenarioValueKeyProject, 'base');
assert(trimmedScenarioValueKeyComparison.includes('| Base | 1/1 | 0 |'), 'scenario comparison should trim scenario value keys before lookup');
const trimmedScenarioValueKeyQuality = calculateDataQuality(trimmedScenarioValueKeyProject, [], []);
assert(trimmedScenarioValueKeyQuality.parcelScenarioGaps.length === 0, 'data quality should trim scenario value keys before gap checks');

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

const numericReferenceValidationIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'numeric_refs', name: 'Numeric Refs', city: '深圳市', district: '罗湖区', planningType: 'Reference smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 0, name: 'Zero Scenario', description: 'Numeric reference fixture' }],
    activeScenarioId: 0,
    objects: [{
        id: 0,
        type: 'parcel',
        name: 'Zero Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            0: { far: 2, buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }, {
        id: 1,
        type: 'road',
        name: 'One Road',
        evidence: ['fixture'],
        points: [{ x: 0, y: 90 }, { x: 80, y: 90 }],
        level: '支路',
        redLineWidthM: 18,
        lanes: 2,
    }, {
        id: 'entrance_numeric',
        type: 'entrance',
        name: 'Numeric Entrance',
        evidence: ['fixture'],
        point: { x: 10, y: 10 },
        entranceType: '机动车',
        parcelId: 0,
        roadId: 1,
    }],
});
assert(!numericReferenceValidationIssues.some(issue => issue.path.endsWith('.id') && issue.message.includes('缺少')), 'UPF validation should accept numeric ids');
assert(!numericReferenceValidationIssues.some(issue => issue.message.includes('不存在')), 'UPF validation should accept numeric references');
assert(!numericReferenceValidationIssues.some(issue => issue.path === 'activeScenarioId'), 'UPF validation should accept numeric active scenario ids');

const duplicateEntranceNameQuality = calculateDataQuality({
    project: { name: 'Duplicate Entrance Names' },
    ruleset: { basis: ['fixture basis'] },
    objects: [
        { id: 'parcel_ok', type: 'parcel', name: 'Parcel OK', evidence: ['fixture'] },
        { id: 'road_ok', type: 'road', name: 'Road OK', evidence: ['fixture'] },
        { id: 'entrance_good', type: 'entrance', name: 'Shared Entrance', evidence: ['fixture'], parcelId: 'parcel_ok', roadId: 'road_ok' },
        { id: 'entrance_bad', type: 'entrance', name: 'Shared Entrance', evidence: ['fixture'], parcelId: 'missing_parcel', roadId: 'missing_road' },
    ],
}, [], []);
assert(duplicateEntranceNameQuality.unboundEntrances.length === 1 && duplicateEntranceNameQuality.unboundEntrances[0].id === 'entrance_bad', 'data quality should not mark same-name valid entrances as unbound');

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

const zeroLengthRoadIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'zero_length_road', name: 'Zero Length Road', city: '深圳市', district: '罗湖区', planningType: 'Geometry smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Geometry fixture' }],
    objects: [{
        id: 'road_zero_length',
        type: 'road',
        name: 'Zero Length Road',
        evidence: ['fixture'],
        points: [{ x: 10, y: 10 }, { x: 10, y: 10 }],
        level: '支路',
        redLineWidthM: 18,
        lanes: 2,
    }],
});
assert(zeroLengthRoadIssues.some(issue => issue.severity === 'error' && issue.path === 'objects[0].points' && issue.message.includes('不同坐标点')), 'zero-length road geometry should be rejected');

const malformedPointIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'malformed_point', name: 'Malformed Point', city: '深圳市', district: '罗湖区', planningType: 'Geometry smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Geometry fixture' }],
    objects: [{
        id: 'road_bad_point',
        type: 'road',
        name: 'Bad Point Road',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: '0x10', y: 0 }, { x: 10, y: 0 }],
        level: '支路',
        redLineWidthM: 18,
        lanes: 2,
    }],
});
assert(malformedPointIssues.some(issue => issue.severity === 'error' && issue.path === 'objects[0].points[1]' && issue.message.includes('有限数字')), 'UPF validation should point to malformed coordinate entries');

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

const numericStringIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'numeric_string', name: 'Numeric String', city: '深圳市', district: '罗湖区', planningType: 'Numeric smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Numeric string fixture' }],
    objects: [{
        id: 'parcel_numeric_string',
        type: 'parcel',
        name: 'Numeric String Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: '3', buildingCoverageMax: '0.35', greenRatioMin: '0.3', heightMaxM: '80' },
        scenarioValues: {
            base: { far: '2', buildingCoverage: '0.3', greenRatio: '0.31', residentialGfaSqm: '42,000', publicServiceGfaSqm: '1,200', updateMode: '综合整治' },
        },
    }, {
        id: 'road_numeric_string',
        type: 'road',
        name: 'Numeric String Road',
        evidence: ['fixture'],
        points: [{ x: 0, y: 90 }, { x: 80, y: 90 }],
        level: '支路',
        redLineWidthM: '18',
        lanes: '2',
    }, {
        id: 'facility_numeric_string',
        type: 'facility',
        name: 'Numeric String Facility',
        evidence: ['fixture'],
        point: { x: 40, y: 40 },
        kind: '社区养老',
        capacity: '80',
        serviceRadiusM: '500',
        planned: true,
    }],
});
assert(!numericStringIssues.some(issue => issue.severity === 'error' && issue.message.includes('必须是数字')), 'UPF validation should not error on compatible numeric strings');
assert(numericStringIssues.some(issue => issue.severity === 'info' && issue.path === 'objects[0].scenarioValues.base.residentialGfaSqm'), 'UPF validation should report compatible numeric strings as info');

const hexNumericStringIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'hex_numeric_string', name: 'Hex Numeric String', city: '深圳市', district: '罗湖区', planningType: 'Numeric smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Hex numeric string fixture' }],
    objects: [{
        id: 'parcel_hex_numeric_string',
        type: 'parcel',
        name: 'Hex Numeric String Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            base: { far: '0x10', buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }],
});
assert(hexNumericStringIssues.some(issue => issue.severity === 'error' && issue.path === 'objects[0].scenarioValues.base.far' && issue.message.includes('必须是数字')), 'UPF validation should reject hexadecimal numeric strings');

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

const trimmedReferenceIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'trimmed_ref', name: 'Trimmed Ref', city: '深圳市', district: '罗湖区', planningType: 'Reference smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: ' base ', name: 'Base', description: 'Reference fixture' }],
    activeScenarioId: ' base ',
    objects: [{
        id: ' parcel_trim ',
        type: 'parcel',
        name: 'Trim Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            base: { far: 2, buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }, {
        id: ' road_trim ',
        type: 'road',
        name: 'Road Trim',
        evidence: ['fixture'],
        points: [{ x: 0, y: 90 }, { x: 80, y: 90 }],
        level: '支路',
        redLineWidthM: 18,
        lanes: 2,
    }, {
        id: 'entrance_trim',
        type: 'entrance',
        name: 'Trim Entrance',
        evidence: ['fixture'],
        point: { x: 10, y: 10 },
        entranceType: '机动车',
        parcelId: 'parcel_trim',
        roadId: ' road_trim ',
    }],
});
assert(!trimmedReferenceIssues.some(issue => issue.message.includes('不存在')), 'UPF validation should trim ids before reference checks');
assert(!trimmedReferenceIssues.some(issue => issue.path === 'activeScenarioId'), 'UPF validation should trim active scenario ids');

const trimmedScenarioValueKeyValidationIssues = validateUpfDocument({
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'trimmed_value_key', name: 'Trimmed Value Key', city: '深圳市', district: '罗湖区', planningType: 'Reference smoke', planningHorizon: '2026-2035', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: ['fixture'] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Reference fixture' }],
    activeScenarioId: 'base',
    objects: [{
        id: 'parcel_trimmed_value_key',
        type: 'parcel',
        name: 'Trimmed Value Key Parcel',
        evidence: ['fixture'],
        points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
        landUseCode: '0701',
        landUseName: '城镇住宅用地',
        controls: { farMax: 3, buildingCoverageMax: 0.35, greenRatioMin: 0.3, heightMaxM: 80 },
        scenarioValues: {
            ' base ': { far: 2, buildingCoverage: 0.3, greenRatio: 0.31, residentialGfaSqm: 10000, publicServiceGfaSqm: 300, updateMode: '综合整治' },
        },
    }],
});
assert(!trimmedScenarioValueKeyValidationIssues.some(issue => issue.path === 'objects[0].scenarioValues.base' && issue.message.includes('缺少')), 'UPF validation should trim scenario value keys before lookup');

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
