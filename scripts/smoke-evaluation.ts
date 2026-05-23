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
            name: 'Parcel A',
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
assert(evaluation.modelName === '均衡模型', 'default model mismatch');
assert(evaluation.dimensions.length === 6, 'dimension count mismatch');
assert(evaluation.parcels.length === 1, 'parcel evaluation mismatch');
assert(evaluation.highlights.length >= 2, 'highlights should explain the result');
assert(buildScenarioEvaluationReport(project, 'scenario_update', rules.checks, rules.recommendations).includes('方案综合评估'), 'report title mismatch');

for (const profile of EVALUATION_WEIGHT_PROFILES) {
    const profiled = evaluateScenario(project, 'scenario_update', rules.checks, rules.recommendations, profile);
    assert(profiled.modelName === profile.name, `${profile.name} model name mismatch`);
    assert(profiled.dimensions.reduce((sum, item) => sum + item.weight, 0) > 0.99, `${profile.name} weights should sum close to 1`);
}

console.log('evaluation smoke passed');
