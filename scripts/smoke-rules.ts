import { buildRuleCatalogReport, RULE_CATALOG, runPlanningRules } from '../src/planning-rules';

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
            landUseCode: '1001',
            landUseName: '工业用地',
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
        {
            id: 'entrance_dangling',
            type: 'entrance',
            name: 'Dangling Entrance',
            entranceType: '机动车',
            roadId: 'missing_road',
            parcelId: 'missing_parcel',
            point: { x: 170, y: 180 },
        },
    ],
};

const result = runPlanningRules(project, 's1');
const ids = new Set(result.checks.map(check => check.ruleId));
const catalogIds = new Set(RULE_CATALOG.map(rule => rule.id));

for (const id of [
    'parcel_far_max',
    'parcel_green_min',
    'parcel_coverage_max',
    'historic_area_rebuild_risk',
    'landuse_industrial_residential_mix',
    'entrance_dangling_parcel',
    'entrance_dangling_road',
    'entrance_arterial_risk',
    'entrance_intersection_distance',
    'road_redline_width_min',
]) {
    assert(ids.has(id), `${id} did not trigger`);
    assert(catalogIds.has(id), `${id} missing from rule catalog`);
}

assert(catalogIds.has('entrance_road_geometry_missing'), 'entrance road geometry rule missing from rule catalog');
assert(RULE_CATALOG.length >= 15, 'rule catalog should cover current rules');
assert(RULE_CATALOG.every(rule => rule.source?.jurisdiction && rule.source.title && rule.source.clause && rule.source.level), 'rule catalog should expose structured RuleSource');
const catalogReport = buildRuleCatalogReport(result.checks);
assert(catalogReport.includes('规则目录与验证口径'), 'rule catalog report title mismatch');
assert(catalogReport.includes('结构化 RuleSource') && catalogReport.includes('来源层级'), 'rule catalog report should expose structured sources');
assert(catalogReport.includes('规则分布') && catalogReport.includes('交通组织'), 'rule catalog report should summarize rule distribution');
assert(catalogReport.includes('residents * 0.036') && catalogReport.includes('parcelArea * 0.015'), 'rule catalog formulas should expose shared service assumptions');
const malformedCatalogReport = buildRuleCatalogReport('not an array' as unknown as Parameters<typeof buildRuleCatalogReport>[0]);
assert(malformedCatalogReport.includes('有触发记录的规则：0'), 'rule catalog report should ignore malformed triggered checks');
assert(result.recommendations.length > 0, 'recommendations should be generated');
assert(result.checks.some(check => check.source.includes('技术导则') || check.source.includes('原型启发')), 'rule check source should include source level');

console.log('rules smoke passed');
