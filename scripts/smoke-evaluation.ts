import {
    EVALUATION_WEIGHT_PROFILES,
    buildScenarioEvaluationReport,
    evaluateScenario,
} from '../src/planning-evaluation';
import { runPlanningRules } from '../src/planning-rules';

function fail(message: string): never {
    console.error(`evaluation smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const project = {
    project: { name: 'Evaluation Smoke' },
    ruleset: {
        version: 'Smoke Evaluation Rules',
        basis: ['GB 50180-2018', '完整居住社区建设指南'],
    },
    scenarios: [
        { id: 'scenario_baseline', name: 'Baseline' },
        { id: 'scenario_update', name: 'Update' },
    ],
    objects: [
        {
            id: 'parcel_a',
            type: 'parcel',
            name: 'Parcel | A',
            evidence: ['smoke fixture'],
            points: [
                { x: 0, y: 0 },
                { x: 140, y: 0 },
                { x: 140, y: 110 },
                { x: 0, y: 110 },
            ],
            controls: {
                farMax: 4,
                buildingCoverageMax: 0.35,
                greenRatioMin: 0.3,
            },
            scenarioValues: {
                scenario_baseline: {
                    far: 2.2,
                    buildingCoverage: 0.34,
                    greenRatio: 0.25,
                    residentialGfaSqm: 30000,
                    publicServiceGfaSqm: 200,
                    updateMode: '综合整治',
                },
                scenario_update: {
                    far: 3.8,
                    buildingCoverage: 0.33,
                    greenRatio: 0.32,
                    residentialGfaSqm: 48000,
                    publicServiceGfaSqm: 1600,
                    updateMode: '综合整治',
                },
            },
        },
        {
            id: 'road_a',
            type: 'road',
            name: 'Branch Road',
            level: '支路',
            points: [
                { x: -40, y: 130 },
                { x: 240, y: 130 },
            ],
        },
        {
            id: 'facility_a',
            type: 'facility',
            name: 'Kindergarten',
            evidence: ['smoke fixture'],
            point: { x: 60, y: 150 },
            kind: '幼儿园',
            capacity: 100,
            serviceRadiusM: 500,
            planned: true,
        },
        {
            id: 'open_a',
            type: 'openSpace',
            name: 'Pocket Park',
            evidence: ['smoke fixture'],
            points: [
                { x: 150, y: 0 },
                { x: 230, y: 0 },
                { x: 230, y: 70 },
                { x: 150, y: 70 },
            ],
            kind: '口袋公园',
        },
    ],
};

const rules = runPlanningRules(project, 'scenario_update');
const evaluation = evaluateScenario(project, 'scenario_update', rules.checks, rules.recommendations);

assert(evaluation.score > 0 && evaluation.score <= 100, 'score should be normalized');
assert(EVALUATION_WEIGHT_PROFILES.length === 4, 'weight profile count mismatch');
assert(evaluation.modelId === 'balanced', 'default model id mismatch');
assert(evaluation.modelName === '均衡模型', 'default model mismatch');
assert(evaluation.weightSource.includes('UrbanPlan Studio'), 'weight source should be exported');
assert(Object.values(evaluation.weights).reduce((sum, value) => sum + value, 0) > 0.99, 'exported weights should sum close to 1');
assert(evaluation.dimensions.length === 6, 'dimension count mismatch');
assert(evaluation.dimensions.map(item => item.id).join(',') === 'compliance,publicService,mobility,ecology,renewalValue,evidence', 'dimension ids should be stable');
assert(evaluation.parcels.length === 1, 'parcel evaluation mismatch');
assert(evaluation.highlights.length >= 2, 'highlights should explain the result');
const evaluationReport = buildScenarioEvaluationReport(project, 'scenario_update', rules.checks, rules.recommendations);
assert(evaluationReport.includes('方案综合评估'), 'report title mismatch');
assert(evaluationReport.includes('服务人口分摊') && evaluationReport.includes('幼儿园需求'), 'report should expose parcel service allocation');
assert(evaluationReport.includes('服务人口分摊假设'), 'report should explain service demand assumptions');
assert(evaluationReport.includes('公服建面目标按住宅建面'), 'report should include shared public-service target assumptions');
assert(evaluationReport.includes('Parcel \\| A'), 'report table cells should escape pipe characters');

for (const profile of EVALUATION_WEIGHT_PROFILES) {
    const profiled = evaluateScenario(project, 'scenario_update', rules.checks, rules.recommendations, profile);
    assert(profiled.modelId === profile.id, `${profile.name} model id mismatch`);
    assert(profiled.modelName === profile.name, `${profile.name} model name mismatch`);
    assert(profiled.dimensions.reduce((sum, item) => sum + item.weight, 0) > 0.99, `${profile.name} weights should sum close to 1`);
}

const degenerateGeometryProject = {
    project: { name: 'Degenerate Evaluation' },
    ruleset: { version: 'Geometry Evaluation Rules', basis: ['fixture'] },
    scenarios: [{ id: 'scenario_update', name: 'Update' }],
    objects: [
        {
            id: 'parcel_line',
            type: 'parcel',
            name: 'Line Parcel',
            evidence: ['smoke fixture'],
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            scenarioValues: {
                scenario_update: {
                    far: 2,
                    buildingCoverage: 0.3,
                    greenRatio: 0.3,
                    residentialGfaSqm: 12000,
                    publicServiceGfaSqm: 300,
                },
            },
        },
        {
            id: 'road_point',
            type: 'road',
            name: 'Point Road',
            points: [{ x: 0, y: 0 }],
        },
        {
            id: 'open_line',
            type: 'openSpace',
            name: 'Line Open Space',
            points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        },
    ],
};
const degenerateEvaluation = evaluateScenario(degenerateGeometryProject, 'scenario_update', [], []);
assert(degenerateEvaluation.parcels.length === 0, 'evaluation should exclude degenerate parcel geometry from parcel priority');
assert(!buildScenarioEvaluationReport(degenerateGeometryProject, 'scenario_update').includes('Line Parcel'), 'evaluation report should not allocate service demand to degenerate parcels');

const stringNumericProject = {
    project: { name: 'String Numeric Evaluation' },
    ruleset: { version: 'String Numeric Rules', basis: ['fixture'] },
    scenarios: [{ id: 'scenario_update', name: 'Update' }],
    objects: [{
        id: 'parcel_string_numeric',
        type: 'parcel',
        name: 'String Numeric Parcel',
        evidence: ['smoke fixture'],
        points: [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
            { x: 120, y: 100 },
            { x: 0, y: 100 },
        ],
        controls: {
            farMax: '4',
            buildingCoverageMax: '0.35',
            greenRatioMin: '0.30',
        },
        scenarioValues: {
            scenario_update: {
                far: '3.8',
                buildingCoverage: '0.33',
                greenRatio: '0.32',
                residentialGfaSqm: '48,000',
                publicServiceGfaSqm: '1,600',
                updateMode: '综合整治',
            },
        },
    }],
} as unknown as typeof project;
const stringNumericReport = buildScenarioEvaluationReport(stringNumericProject, 'scenario_update');
assert(stringNumericReport.includes('| String Numeric Parcel | 1455 |'), 'evaluation should parse strict numeric strings for service allocation');
assert(!stringNumericReport.includes('NaN'), 'evaluation report should not emit NaN for numeric strings');

console.log('evaluation smoke passed');
