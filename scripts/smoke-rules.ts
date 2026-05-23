import { runPlanningRules } from '../src/planning-rules';

function fail(message: string): never {
    console.error(`rules smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const project = {
    project: { name: 'Rule Smoke' },
    ruleset: { version: 'Smoke Rules' },
    objects: [
        {
            id: 'parcel_bad',
            type: 'parcel',
            name: 'Bad Parcel',
            points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 },
            ],
            controls: {
                farMax: 3,
                buildingCoverageMax: 0.35,
                greenRatioMin: 0.3,
            },
            scenarioValues: {
                s1: {
                    far: 4,
                    buildingCoverage: 0.4,
                    greenRatio: 0.2,
                    residentialGfaSqm: 50000,
                    publicServiceGfaSqm: 100,
                    updateMode: '拆除重建',
                },
            },
        },
        {
            id: 'heritage',
            type: 'constraint',
            name: 'Heritage',
            kind: '历史风貌控制',
            points: [
                { x: 20, y: 20 },
                { x: 120, y: 20 },
                { x: 120, y: 120 },
                { x: 20, y: 120 },
            ],
        },
        {
            id: 'road_a',
            type: 'road',
            name: 'Trunk',
            level: '主干路',
            points: [
                { x: 150, y: -20 },
                { x: 150, y: 200 },
            ],
        },
        {
            id: 'road_b',
            type: 'road',
            name: 'Branch',
            level: '支路',
            points: [
                { x: 0, y: 80 },
                { x: 260, y: 80 },
            ],
        },
        {
            id: 'road_c',
            type: 'road',
            name: 'Endpoint Road',
            level: '支路',
            points: [
                { x: 150, y: 200 },
                { x: 260, y: 200 },
            ],
        },
        {
            id: 'entrance_bad',
            type: 'entrance',
            name: 'Bad Entrance',
            entranceType: '机动车',
            roadId: 'road_a',
            parcelId: 'parcel_bad',
            point: { x: 150, y: 82 },
        },
        {
            id: 'entrance_endpoint',
            type: 'entrance',
            name: 'Endpoint Entrance',
            entranceType: '机动车',
            roadId: 'road_c',
            parcelId: 'parcel_bad',
            point: { x: 155, y: 200 },
        },
    ],
};

const result = runPlanningRules(project, 's1');
const ids = new Set(result.checks.map(check => check.ruleId));

for (const id of [
    'parcel_far_max',
    'parcel_green_min',
    'parcel_coverage_max',
    'historic_area_rebuild_risk',
    'entrance_arterial_risk',
    'entrance_intersection_distance',
]) {
    assert(ids.has(id), `${id} did not trigger`);
}

assert(result.recommendations.length > 0, 'recommendations should be generated');

console.log('rules smoke passed');
