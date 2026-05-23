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

type CsvScenarioLike = {
    id: string;
    name: string;
    description?: string;
};

type CsvScenarioValueLike = {
    far?: number;
    buildingCoverage?: number;
    greenRatio?: number;
    residentialGfaSqm?: number;
    publicServiceGfaSqm?: number;
    updateMode?: string;
    notes?: string;
};

type CsvObjectLike = {
    id?: string;
    type?: string;
    scenarioValues?: Record<string, CsvScenarioValueLike>;
    [key: string]: unknown;
};

type CsvProjectLike = {
    scenarios?: CsvScenarioLike[];
    objects?: CsvObjectLike[];
};

export type CsvParseResult<TProject> = {
    project: TProject;
    activeScenarioId: string;
    importSummary: CsvImportSummary;
};

export type CsvImportSummary = {
    format: 'csv';
    rowCount: number;
    updatedRows: number;
    skippedRows: number;
    unmatchedParcelIds: string[];
    scenarioIds: string[];
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

export function parseParcelIndicatorCsv<TProject extends CsvProjectLike>(
    text: string,
    fallbackProject: TProject,
): CsvParseResult<TProject> | undefined {
    const rows = parseCsvTable(text);
    if (!rows.length) return undefined;
    const headers = new Set(Object.keys(rows[0] ?? {}));
    if (!hasAny(headers, ['parcel_id', 'object_id', 'id']) || !hasAny(headers, ['scenario_id', 'scenario'])) return undefined;

    const scenarios = [...(fallbackProject.scenarios ?? [])];
    const scenarioIds = new Set(scenarios.map(scenario => scenario.id));
    const objects = (fallbackProject.objects ?? []).map(object => ({
        ...object,
        scenarioValues: object.type === 'parcel' ? { ...(object.scenarioValues ?? {}) } : object.scenarioValues,
    }));
    const parcels = new Map(objects.filter(object => object.type === 'parcel' && object.id).map(object => [String(object.id), object]));
    let activeScenarioId = fallbackProject.scenarios?.[0]?.id ?? 'scenario_csv';
    let updatedRows = 0;
    let skippedRows = 0;
    const unmatchedParcelIds = new Set<string>();

    for (const row of rows) {
        const parcelId = cell(row, 'parcel_id', 'object_id', 'id');
        const scenarioId = cell(row, 'scenario_id', 'scenario');
        if (!parcelId || !scenarioId) {
            skippedRows++;
            continue;
        }
        const parcel = parcels.get(parcelId);
        if (!parcel) {
            unmatchedParcelIds.add(parcelId);
            skippedRows++;
            continue;
        }
        if (!scenarioIds.has(scenarioId)) {
            scenarios.push({ id: scenarioId, name: scenarioId, description: '由 CSV 指标表导入。' });
            scenarioIds.add(scenarioId);
        }
        activeScenarioId = scenarioId;
        const current = parcel.scenarioValues?.[scenarioId] ?? {};
        parcel.scenarioValues = parcel.scenarioValues ?? {};
        parcel.scenarioValues[scenarioId] = {
            ...current,
            ...numberField(row, 'far'),
            ...numberField(row, 'buildingCoverage', 'building_coverage', 'building_coverage_ratio'),
            ...numberField(row, 'greenRatio', 'green_ratio', 'green_ratio_min'),
            ...numberField(row, 'residentialGfaSqm', 'residential_gfa_sqm', 'residential_gfa'),
            ...numberField(row, 'publicServiceGfaSqm', 'public_service_gfa_sqm', 'public_service_gfa'),
            ...textField(row, 'updateMode', 'update_mode'),
            ...textField(row, 'notes', 'note'),
        };
        updatedRows++;
    }

    if (!updatedRows) return undefined;
    return {
        project: {
            ...fallbackProject,
            scenarios,
            objects,
        } as TProject,
        activeScenarioId,
        importSummary: {
            format: 'csv',
            rowCount: rows.length,
            updatedRows,
            skippedRows,
            unmatchedParcelIds: [...unmatchedParcelIds].slice(0, 12),
            scenarioIds: [...scenarioIds],
        },
    };
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

function parseCsvTable(text: string): Array<Record<string, string>> {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map(normalizeHeader);
    return lines.slice(1).map((line) => {
        const cells = parseCsvLine(line);
        return headers.reduce<Record<string, string>>((row, header, index) => {
            if (header) row[header] = cells[index]?.trim() ?? '';
            return row;
        }, {});
    });
}

function parseCsvLine(line: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && quoted && next === '"') {
            cell += '"';
            index++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            cells.push(cell);
            cell = '';
        } else {
            cell += char;
        }
    }
    cells.push(cell);
    return cells;
}

function normalizeHeader(value: string): string {
    return value.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function hasAny(headers: Set<string>, names: string[]): boolean {
    return names.some(name => headers.has(normalizeHeader(name)));
}

function cell(row: Record<string, string>, ...names: string[]): string {
    for (const name of names) {
        const value = row[normalizeHeader(name)];
        if (value) return value.trim();
    }
    return '';
}

function numberField(row: Record<string, string>, key: keyof CsvScenarioValueLike, ...names: string[]): Partial<CsvScenarioValueLike> {
    const value = cell(row, String(key), ...names);
    if (!value) return {};
    const numeric = Number(value);
    return Number.isFinite(numeric) ? { [key]: numeric } : {};
}

function textField(row: Record<string, string>, key: keyof CsvScenarioValueLike, ...names: string[]): Partial<CsvScenarioValueLike> {
    const value = cell(row, String(key), ...names);
    return value ? { [key]: value } : {};
}
