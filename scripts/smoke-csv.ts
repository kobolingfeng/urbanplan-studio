import { buildScenarioDecisionCsv, buildScenarioDecisionLongCsv, type ScenarioDecisionCsvRow } from '../src/planning-csv';

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

console.log('csv smoke passed');
