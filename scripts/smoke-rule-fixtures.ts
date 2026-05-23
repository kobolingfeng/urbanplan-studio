import { runPlanningRules } from '../src/planning-rules';

type Point = { x: number; y: number };
type FixtureObject = { id: string; type: string; name: string; [key: string]: unknown };

function fail(message: string): never {
    console.error(`rule fixture smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

function run(objects: FixtureObject[], scenarioId = 's1') {
    return runPlanningRules({
        project: { name: 'Rule Fixture' },
        ruleset: { version: 'Fixture Rule Set' },
        objects,
    }, scenarioId).checks;
}

function assertTriggers(name: string, objects: FixtureObject[], expectedRuleIds: string[]) {
    const ids = new Set(run(objects).map(check => check.ruleId));
    for (const ruleId of expectedRuleIds) {
        assert(ids.has(ruleId), `${name} should trigger ${ruleId}`);
    }
}

function rect(x: number, y: number, width: number, height: number): Point[] {
    return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
    ];
}

const badParcel = {
    id: 'parcel_bad_controls',
    type: 'parcel',
    name: 'Bad Controls',
    points: rect(0, 0, 120, 120),
    controls: {
        farMax: 3,
        buildingCoverageMax: 0.35,
        greenRatioMin: 0.3,
    },
    scenarioValues: {
        s1: {
            far: 4,
            buildingCoverage: 0.42,
            greenRatio: 0.18,
            residentialGfaSqm: 48000,
            publicServiceGfaSqm: 50,
            updateMode: '综合整治',
        },
    },
};

assertTriggers('parcel controls', [badParcel], [
    'parcel_far_max',
    'parcel_green_min',
    'parcel_coverage_max',
    'parcel_public_service_ratio',
]);

assertTriggers('heritage overlap', [
    {
        ...badParcel,
        id: 'parcel_heritage',
        name: 'Heritage Parcel',
        scenarioValues: {
            s1: {
                far: 2.5,
                buildingCoverage: 0.3,
                greenRatio: 0.32,
                residentialGfaSqm: 12000,
                publicServiceGfaSqm: 600,
                updateMode: '拆除重建',
            },
        },
    },
    {
        id: 'heritage_overlay',
        type: 'constraint',
        name: 'Heritage Overlay',
        kind: '历史风貌控制',
        points: rect(40, 40, 80, 80),
    },
], ['historic_area_rebuild_risk']);

assertTriggers('land-use compatibility', [
    {
        ...badParcel,
        id: 'parcel_industrial_housing',
        name: 'Industrial Housing Mix',
        landUseCode: '1001',
        landUseName: '工业用地',
        scenarioValues: {
            s1: {
                far: 2.4,
                buildingCoverage: 0.32,
                greenRatio: 0.3,
                residentialGfaSqm: 18000,
                publicServiceGfaSqm: 800,
                updateMode: '功能置换',
            },
        },
    },
], ['landuse_industrial_residential_mix']);

assertTriggers('entrance integrity and geometry', [
    badParcel,
    {
        id: 'road_trunk',
        type: 'road',
        name: 'Trunk Road',
        level: '主干路',
        points: [{ x: 150, y: -20 }, { x: 150, y: 220 }],
    },
    {
        id: 'road_branch',
        type: 'road',
        name: 'Branch Road',
        level: '支路',
        points: [{ x: 0, y: 80 }, { x: 260, y: 80 }],
    },
    {
        id: 'entrance_arterial',
        type: 'entrance',
        name: 'Arterial Entrance',
        entranceType: '机动车',
        parcelId: 'parcel_bad_controls',
        roadId: 'road_trunk',
        point: { x: 150, y: 82 },
    },
    {
        id: 'entrance_far',
        type: 'entrance',
        name: 'Far Entrance',
        entranceType: '人行',
        parcelId: 'parcel_bad_controls',
        roadId: 'road_branch',
        point: { x: 240, y: 180 },
    },
    {
        id: 'entrance_dangling',
        type: 'entrance',
        name: 'Dangling Entrance',
        entranceType: '机动车',
        parcelId: 'missing_parcel',
        roadId: 'missing_road',
        point: { x: 30, y: 30 },
    },
], [
    'entrance_arterial_risk',
    'entrance_intersection_distance',
    'entrance_road_distance',
    'entrance_dangling_parcel',
    'entrance_dangling_road',
]);

assertTriggers('road redline width', [
    {
        id: 'road_too_narrow',
        type: 'road',
        name: 'Too Narrow Arterial',
        level: '主干路',
        redLineWidthM: 18,
        lanes: 6,
        points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
    },
], ['road_redline_width_min']);

assertTriggers('facility capacity and coverage', [
    {
        ...badParcel,
        id: 'parcel_high_population',
        name: 'High Population Parcel',
        scenarioValues: {
            s1: {
                far: 2.8,
                buildingCoverage: 0.3,
                greenRatio: 0.32,
                residentialGfaSqm: 99000,
                publicServiceGfaSqm: 3000,
                updateMode: '综合整治',
            },
        },
    },
    {
        id: 'facility_remote_kindergarten',
        type: 'facility',
        name: 'Remote Kindergarten',
        kind: '幼儿园',
        point: { x: 2000, y: 2000 },
        capacity: 20,
        serviceRadiusM: 300,
    },
], [
    'facility_kindergarten_coverage_gap',
    'facility_elderly_coverage_gap',
    'facility_kindergarten_gap',
    'facility_elderly_gap',
    'facility_health_gap',
]);

console.log('rule fixture smoke passed');
