import {
    PARCEL_SCENARIO_VALUE_RANGES,
    UNBOUNDED_RANGE,
    type NumericRange,
} from './planning-ranges';

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
    invalidFields: string[];
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
    const parcels = new Map<string, CsvObjectLike>();
    for (const object of objects) {
        if (object.type !== 'parcel') continue;
        const id = csvIdentifierText(object.id);
        if (id) parcels.set(id, object);
    }
    let activeScenarioId = fallbackProject.scenarios?.[0]?.id ?? 'scenario_csv';
    let updatedRows = 0;
    let skippedRows = 0;
    const unmatchedParcelIds = new Set<string>();
    const invalidFields: string[] = [];

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
        const patch: Partial<CsvScenarioValueLike> = {
            ...numberField(row, 'far', parcelId, invalidFields),
            ...numberField(row, 'buildingCoverage', parcelId, invalidFields, 'building_coverage', 'building_coverage_ratio'),
            ...numberField(row, 'greenRatio', parcelId, invalidFields, 'green_ratio', 'green_ratio_min'),
            ...numberField(row, 'residentialGfaSqm', parcelId, invalidFields, 'residential_gfa_sqm', 'residential_gfa'),
            ...numberField(row, 'publicServiceGfaSqm', parcelId, invalidFields, 'public_service_gfa_sqm', 'public_service_gfa'),
            ...textField(row, 'updateMode', 'update_mode'),
            ...textField(row, 'notes', 'note'),
        };
        if (!Object.keys(patch).length) {
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
            ...patch,
        };
        updatedRows++;
    }

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
            invalidFields: invalidFields.slice(0, 20),
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
    const records = parseCsvRecords(text);
    if (records.length < 2) return [];
    const headers = records[0].map(normalizeHeader);
    return records.slice(1).filter(record => record.some(cell => cell.trim())).map((cells) => {
        return headers.reduce<Record<string, string>>((row, header, index) => {
            if (header) row[header] = cells[index]?.trim() ?? '';
            return row;
        }, {});
    });
}

function parseCsvRecords(text: string): string[][] {
    const records: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    const source = text.replace(/^\uFEFF/, '');

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '"' && quoted && next === '"') {
            cell += '"';
            index++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') index++;
            pushRow();
        } else {
            cell += char;
        }
    }
    pushRow();
    return records;

    function pushRow() {
        row.push(cell);
        cell = '';
        if (row.some(value => value.trim())) records.push(row);
        row = [];
    }
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

function csvIdentifierText(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function numberField(
    row: Record<string, string>,
    key: keyof CsvScenarioValueLike,
    rowLabel: string,
    invalidFields: string[],
    ...names: string[]
): Partial<CsvScenarioValueLike> {
    const value = cell(row, String(key), ...names);
    if (!value) return {};
    const numeric = parseCsvNumber(key, value);
    const range = numberRange(key);
    if (!Number.isFinite(numeric) || numeric < range.min || numeric > range.max) {
        invalidFields.push(`${rowLabel}.${normalizeHeader(String(key))}`);
        return {};
    }
    return { [key]: numeric };
}

function textField(row: Record<string, string>, key: keyof CsvScenarioValueLike, ...names: string[]): Partial<CsvScenarioValueLike> {
    const value = cell(row, String(key), ...names);
    return value ? { [key]: value } : {};
}

function parseCsvNumber(key: keyof CsvScenarioValueLike, value: string): number {
    const text = value.trim().replace(/,/g, '');
    if (text.endsWith('%')) {
        const percent = Number(text.slice(0, -1));
        return isRatioField(key) && Number.isFinite(percent) ? percent / 100 : Number.NaN;
    }
    return Number(text);
}

function isRatioField(key: keyof CsvScenarioValueLike): boolean {
    return key === 'buildingCoverage' || key === 'greenRatio';
}

function numberRange(key: keyof CsvScenarioValueLike): NumericRange {
    const ranges: Record<string, NumericRange> = PARCEL_SCENARIO_VALUE_RANGES;
    return ranges[String(key)] ?? UNBOUNDED_RANGE;
}
