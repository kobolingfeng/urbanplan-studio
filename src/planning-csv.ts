export type ScenarioDecisionCsvRow = {
    scenario: {
        id: string;
        name: string;
    };
    evaluation: {
        score: number;
        band: string;
        confidence: number;
        dimensions: Array<{
            id: string;
            name: string;
            score: number;
            weight: number;
        }>;
    };
    residents: number;
    residentialGfa: number;
    publicServiceGfa: number;
    errors: number;
    warnings: number;
};

export function buildScenarioDecisionCsv(rows: ScenarioDecisionCsvRow[]): string {
    const header = [
        'scenario_id',
        'scenario_name',
        'score',
        'band',
        'confidence',
        'residents',
        'residential_gfa_sqm',
        'public_service_gfa_sqm',
        'rule_errors',
        'rule_warnings',
    ];
    const body = rows.map(row => [
        row.scenario.id,
        row.scenario.name,
        row.evaluation.score,
        row.evaluation.band,
        row.evaluation.confidence,
        row.residents,
        Math.round(row.residentialGfa),
        Math.round(row.publicServiceGfa),
        row.errors,
        row.warnings,
    ].map(csvCell).join(','));
    return [header.join(','), ...body].join('\n');
}

export function buildScenarioDecisionLongCsv(rows: ScenarioDecisionCsvRow[]): string {
    const header = [
        'scenario_id',
        'scenario_name',
        'metric_group',
        'metric_id',
        'metric_name',
        'value',
        'unit',
    ];
    const body = rows.flatMap(row => [
        metricRow(row, 'summary', 'score', '综合评分', row.evaluation.score, 'score'),
        metricRow(row, 'summary', 'confidence', '可信度', row.evaluation.confidence, 'score'),
        metricRow(row, 'capacity', 'residents', '估算人口', row.residents, 'people'),
        metricRow(row, 'capacity', 'residential_gfa_sqm', '住宅建面', Math.round(row.residentialGfa), 'sqm'),
        metricRow(row, 'capacity', 'public_service_gfa_sqm', '公服建面', Math.round(row.publicServiceGfa), 'sqm'),
        metricRow(row, 'rules', 'rule_errors', '规则错误', row.errors, 'count'),
        metricRow(row, 'rules', 'rule_warnings', '规则警告', row.warnings, 'count'),
        ...row.evaluation.dimensions.flatMap(dimension => [
            metricRow(row, 'dimension_score', `${dimension.id}_score`, `${dimension.name}得分`, dimension.score, 'score'),
            metricRow(row, 'dimension_weight', `${dimension.id}_weight`, `${dimension.name}权重`, Number((dimension.weight * 100).toFixed(2)), 'percent'),
        ]),
    ]).map(row => [
        row.scenarioId,
        row.scenarioName,
        row.metricGroup,
        row.metricId,
        row.metricName,
        row.value,
        row.unit,
    ].map(csvCell).join(','));
    return [header.join(','), ...body].join('\n');
}

function metricRow(
    row: ScenarioDecisionCsvRow,
    metricGroup: string,
    metricId: string,
    metricName: string,
    value: number,
    unit: string,
) {
    return {
        scenarioId: row.scenario.id,
        scenarioName: row.scenario.name,
        metricGroup,
        metricId,
        metricName,
        value,
        unit,
    };
}

function csvCell(value: string | number): string {
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}
