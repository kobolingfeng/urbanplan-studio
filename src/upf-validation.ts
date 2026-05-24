import { isStructuredEvidence, normalizeEvidenceItem } from './evidence';
import { markdownTableRow } from './markdown-table';
import {
    FACILITY_RANGES as FACILITY_NUMERIC_RANGES,
    PARCEL_CONTROL_RANGES,
    PARCEL_SCENARIO_VALUE_RANGES as PARCEL_NUMERIC_RANGES,
    ROAD_RANGES as ROAD_NUMERIC_RANGES,
    formatRange,
    type NumericRange,
} from './planning-ranges';

type AnyRecord = Record<string, unknown>;

export type UpfValidationSeverity = 'error' | 'warning' | 'info';

export type UpfValidationIssue = {
    severity: UpfValidationSeverity;
    path: string;
    message: string;
};

const OBJECT_TYPES = new Set(['parcel', 'road', 'facility', 'entrance', 'openSpace', 'constraint']);
const PARCEL_NUMERIC_VALUES = Object.keys(PARCEL_NUMERIC_RANGES) as Array<keyof typeof PARCEL_NUMERIC_RANGES>;
const PARCEL_CONTROL_VALUES = Object.keys(PARCEL_CONTROL_RANGES) as Array<keyof typeof PARCEL_CONTROL_RANGES>;
const ROAD_NUMERIC_VALUES = Object.keys(ROAD_NUMERIC_RANGES) as Array<keyof typeof ROAD_NUMERIC_RANGES>;
const FACILITY_NUMERIC_VALUES = Object.keys(FACILITY_NUMERIC_RANGES) as Array<keyof typeof FACILITY_NUMERIC_RANGES>;

export function validateUpfDocument(input: unknown): UpfValidationIssue[] {
    const issues: UpfValidationIssue[] = [];
    const add = (severity: UpfValidationSeverity, path: string, message: string) => {
        issues.push({ severity, path, message });
    };
    const data = asRecord(input);
    if (!data) {
        return [{ severity: 'error', path: '$', message: 'UPF 文档必须是 JSON 对象。' }];
    }

    const manifest = asRecord(data.manifest);
    const format = data.format ?? manifest?.format;
    if (format !== 'UPF') add('error', 'format', '必须声明 format: UPF，或在 manifest.format 中声明 UPF。');
    const formatVersion = String(data.formatVersion ?? manifest?.formatVersion ?? '');
    if (formatVersion && formatVersion !== '0.1.0') add('info', 'formatVersion', `当前版本 ${formatVersion} 将按 0.1.0 兼容处理。`);
    if (!formatVersion) add('warning', 'formatVersion', '缺少 formatVersion，导入时会按 0.1.0 兼容处理。');

    const project = asRecord(data.project);
    if (!project) add('error', 'project', '缺少 project 元数据。');
    else {
        for (const field of ['id', 'name', 'city', 'district', 'planningType', 'planningHorizon', 'crs']) {
            if (!isNonEmptyString(project[field])) add(field === 'id' || field === 'name' ? 'error' : 'warning', `project.${field}`, `project.${field} 不能为空。`);
        }
    }

    const ruleset = asRecord(data.ruleset);
    if (!ruleset) add('warning', 'ruleset', '缺少 ruleset，规则来源和适用地区将不完整。');
    else {
        if (!isNonEmptyString(ruleset.jurisdiction)) add('warning', 'ruleset.jurisdiction', '缺少规则适用地区。');
        if (!isNonEmptyString(ruleset.version)) add('warning', 'ruleset.version', '缺少规则版本。');
        if (!Array.isArray(ruleset.basis) || !ruleset.basis.length) add('warning', 'ruleset.basis', '缺少规则依据清单。');
    }

    const scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
    if (!scenarios.length) add('error', 'scenarios', '至少需要 1 个情景方案。');
    const scenarioIds = new Set<string>();
    scenarios.forEach((scenario, index) => {
        const item = asRecord(scenario);
        const path = `scenarios[${index}]`;
        if (!item) {
            add('error', path, '情景方案必须是对象。');
            return;
        }
        const scenarioId = identifierText(item.id);
        if (!scenarioId) add('error', `${path}.id`, '情景方案缺少 id。');
        else if (scenarioIds.has(scenarioId)) add('error', `${path}.id`, `情景方案 id 重复：${scenarioId}`);
        else scenarioIds.add(scenarioId);
        if (!isNonEmptyString(item.name)) add('error', `${path}.name`, '情景方案缺少名称。');
        if (!isNonEmptyString(item.description)) add('info', `${path}.description`, '建议补充情景说明，便于论文解释方案差异。');
    });

    const activeScenarioId = identifierText(data.activeScenarioId ?? manifest?.activeScenarioId) ?? '';
    if (activeScenarioId && !scenarioIds.has(activeScenarioId)) add('warning', 'activeScenarioId', `当前方案 ${activeScenarioId} 不在 scenarios 中。`);

    const objects = Array.isArray(data.objects) ? data.objects : [];
    if (!objects.length) add('error', 'objects', '至少需要 1 个规划对象。');
    const objectIds = new Set<string>();
    objects.forEach((object, index) => {
        const item = asRecord(object);
        const path = `objects[${index}]`;
        if (!item) {
            add('error', path, '规划对象必须是对象。');
            return;
        }
        const objectId = identifierText(item.id);
        if (!objectId) add('error', `${path}.id`, '对象缺少 id。');
        else if (objectIds.has(objectId)) add('error', `${path}.id`, `对象 id 重复：${objectId}`);
        else objectIds.add(objectId);
        if (!isNonEmptyString(item.name)) add('warning', `${path}.name`, '对象缺少名称。');
        validateEvidenceList(item.evidence, `${path}.evidence`, add);
        if (!isNonEmptyString(item.type) || !OBJECT_TYPES.has(item.type)) {
            add('error', `${path}.type`, `未知对象类型：${String(item.type ?? '')}`);
            return;
        }
    });

    const parcelIds = new Set(objects.map(asRecord).filter(item => item?.type === 'parcel').map(item => identifierText(item?.id)).filter((id): id is string => Boolean(id)));
    const roadIds = new Set(objects.map(asRecord).filter(item => item?.type === 'road').map(item => identifierText(item?.id)).filter((id): id is string => Boolean(id)));

    objects.forEach((object, index) => {
        const item = asRecord(object);
        if (!item || !OBJECT_TYPES.has(String(item.type))) return;
        const path = `objects[${index}]`;
        if (item.type === 'parcel') validateParcel(item, path, scenarioIds, add);
        if (item.type === 'road') {
            if (!hasPoints(item.points, 2)) add('error', `${path}.points`, '道路至少需要 2 个点。');
            if (!isNonEmptyString(item.level)) add('warning', `${path}.level`, '道路缺少等级。');
            for (const field of ROAD_NUMERIC_VALUES) {
                validateNumberInRange(item, field, path, `道路 ${field}`, ROAD_NUMERIC_RANGES[field], add);
            }
        }
        if (item.type === 'facility') {
            if (!isPoint(item.point)) add('error', `${path}.point`, '公共服务设施缺少有效点位。');
            if (!isNonEmptyString(item.kind)) add('warning', `${path}.kind`, '公共服务设施缺少类型。');
            for (const field of FACILITY_NUMERIC_VALUES) {
                validateNumberInRange(item, field, path, `公共服务设施 ${field}`, FACILITY_NUMERIC_RANGES[field], add);
            }
        }
        if (item.type === 'entrance') {
            if (!isPoint(item.point)) add('error', `${path}.point`, '出入口缺少有效点位。');
            if (!isNonEmptyString(item.entranceType)) add('warning', `${path}.entranceType`, '出入口缺少类型。');
            const parcelId = identifierText(item.parcelId);
            const roadId = identifierText(item.roadId);
            if (!parcelId) add('error', `${path}.parcelId`, '出入口缺少地块引用。');
            else if (!parcelIds.has(parcelId)) add('error', `${path}.parcelId`, `出入口引用不存在的地块：${parcelId}`);
            if (!roadId) add('error', `${path}.roadId`, '出入口缺少道路引用。');
            else if (!roadIds.has(roadId)) add('error', `${path}.roadId`, `出入口引用不存在的道路：${roadId}`);
        }
        if (item.type === 'openSpace' || item.type === 'constraint') {
            if (!hasPoints(item.points, 3)) add('error', `${path}.points`, '面状对象至少需要 3 个点。');
            else validatePolygonGeometry(item.points, `${path}.points`, '面状对象', add);
            if (!isNonEmptyString(item.kind)) add('warning', `${path}.kind`, '面状对象缺少类型。');
        }
    });

    validateCoordinateReference(project, manifest, objects, add);

    return issues;
}

function validateEvidenceList(
    value: unknown,
    path: string,
    add: (severity: UpfValidationSeverity, path: string, message: string) => void,
) {
    if (!Array.isArray(value) || !value.length) {
        add('warning', path, '对象缺少证据来源，会降低可信度。');
        return;
    }
    value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        const normalized = normalizeEvidenceItem(item);
        if (!normalized) {
            add('error', itemPath, '证据必须是非空字符串或 EvidenceSource 对象。');
            return;
        }
        if (typeof normalized === 'string') {
            add('info', itemPath, '当前为旧版字符串证据，建议升级为含 title/type/collectedAt/precision/confidence/license 的 EvidenceSource。');
            return;
        }
        if (!isStructuredEvidence(normalized)) add('warning', itemPath, 'EvidenceSource 缺少 title。');
        if (!isNonEmptyString(normalized.type)) add('warning', `${itemPath}.type`, 'EvidenceSource 建议声明来源类型。');
        if (!isNonEmptyString(normalized.collectedAt)) add('warning', `${itemPath}.collectedAt`, 'EvidenceSource 建议声明获取或生效时间。');
        if (!isNonEmptyString(normalized.precision)) add('info', `${itemPath}.precision`, '建议补充精度或适用尺度。');
        if (!isNonEmptyString(normalized.license)) add('info', `${itemPath}.license`, '建议补充许可或使用约束。');
        const raw = asRecord(item);
        if (raw && raw.confidence !== undefined) {
            const confidence = numberLike(raw.confidence);
            if (confidence === undefined || confidence < 0 || confidence > 100) {
                add('warning', `${itemPath}.confidence`, 'confidence 应为 0-1 或 0-100 区间数值。');
            } else if (typeof raw.confidence === 'string') {
                add('info', `${itemPath}.confidence`, 'confidence 为字符串数字，兼容层可解析；建议导出为 JSON number。');
            }
        }
    });
}

function validateCoordinateReference(
    project: AnyRecord | undefined,
    manifest: AnyRecord | undefined,
    objects: unknown[],
    add: (severity: UpfValidationSeverity, path: string, message: string) => void,
) {
    const crs = String(project?.crs ?? '').trim();
    const unitSystem = asRecord(manifest?.unitSystem);
    const unitName = String(unitSystem?.name ?? '').trim();
    if (crs && unitName && crs !== unitName && unitName === 'DemoCanvasMetric') {
        add('warning', 'project.crs', `project.crs 为 ${crs}，但 manifest.unitSystem 为 ${unitName}，请确认是否混用了真实 CRS 与演示画布单位。`);
    }
    if (crs !== 'EPSG:4490') return;
    for (const item of collectObjectPoints(objects)) {
        const { point, path } = item;
        if (point.x < -180 || point.x > 180 || point.y < -90 || point.y > 90) {
            add('error', path, `EPSG:4490 应使用经纬度坐标，当前点 (${point.x}, ${point.y}) 超出范围，疑似混入画布或投影坐标。`);
            return;
        }
    }
}

function collectObjectPoints(objects: unknown[]): Array<{ path: string; point: { x: number; y: number } }> {
    const points: Array<{ path: string; point: { x: number; y: number } }> = [];
    objects.forEach((object, index) => {
        const item = asRecord(object);
        if (!item) return;
        const point = asRecord(item.point);
        if (point && isFiniteNumber(point.x) && isFiniteNumber(point.y)) {
            points.push({ path: `objects[${index}].point`, point: { x: point.x, y: point.y } });
        }
        if (Array.isArray(item.points)) {
            item.points.forEach((candidate, pointIndex) => {
                const next = asRecord(candidate);
                if (next && isFiniteNumber(next.x) && isFiniteNumber(next.y)) {
                    points.push({ path: `objects[${index}].points[${pointIndex}]`, point: { x: next.x, y: next.y } });
                }
            });
        }
    });
    return points;
}

export function summarizeUpfValidation(issues: UpfValidationIssue[]) {
    return {
        errors: issues.filter(issue => issue.severity === 'error').length,
        warnings: issues.filter(issue => issue.severity === 'warning').length,
        infos: issues.filter(issue => issue.severity === 'info').length,
    };
}

export function buildUpfValidationReport(issues: UpfValidationIssue[]): string {
    const summary = summarizeUpfValidation(issues);
    const lines = [
        '# UPF 结构校验报告',
        '',
        `错误：${summary.errors}，警告：${summary.warnings}，提示：${summary.infos}`,
        '',
        '| 等级 | 路径 | 问题 |',
        '|---|---|---|',
        ...(issues.length
            ? issues.map(issue => markdownTableRow([severityLabel(issue.severity), issue.path, issue.message]))
            : ['| 通过 | $ | 当前未发现结构问题 |']),
    ];
    return lines.join('\n');
}

function validateParcel(
    item: AnyRecord,
    path: string,
    scenarioIds: Set<string>,
    add: (severity: UpfValidationSeverity, path: string, message: string) => void,
) {
    if (!hasPoints(item.points, 3)) add('error', `${path}.points`, '地块至少需要 3 个点。');
    else validatePolygonGeometry(item.points, `${path}.points`, '地块', add);
    if (!isNonEmptyString(item.landUseCode)) add('warning', `${path}.landUseCode`, '地块缺少用地代码。');
    if (!isNonEmptyString(item.landUseName)) add('warning', `${path}.landUseName`, '地块缺少用地名称。');
    const controls = asRecord(item.controls);
    if (!controls) add('error', `${path}.controls`, '地块缺少控制指标。');
    else {
        for (const field of PARCEL_CONTROL_VALUES) {
            validateNumberInRange(controls, field, `${path}.controls`, `控制指标 ${field}`, PARCEL_CONTROL_RANGES[field], add);
        }
    }
    const values = asRecord(item.scenarioValues);
    if (!values) {
        add('error', `${path}.scenarioValues`, '地块缺少情景指标。');
        return;
    }
    for (const scenarioId of scenarioIds) {
        const value = asRecord(values[scenarioId]);
        if (!value) {
            add('warning', `${path}.scenarioValues.${scenarioId}`, `缺少 ${scenarioId} 的地块情景指标。`);
            continue;
        }
        for (const field of PARCEL_NUMERIC_VALUES) {
            validateNumberInRange(value, field, `${path}.scenarioValues.${scenarioId}`, field, PARCEL_NUMERIC_RANGES[field], add);
        }
        if (!isNonEmptyString(value.updateMode)) add('warning', `${path}.scenarioValues.${scenarioId}.updateMode`, '缺少更新方式。');
    }
}

function validateNumberInRange(
    record: AnyRecord,
    field: string,
    path: string,
    label: string,
    range: NumericRange | undefined,
    add: (severity: UpfValidationSeverity, path: string, message: string) => void,
) {
    const value = record[field];
    if (!isFiniteNumber(value)) {
        add('error', `${path}.${field}`, `${label} 必须是数字。`);
        return;
    }
    if (range && (value < range.min || value > range.max)) {
        add('error', `${path}.${field}`, `${label} 超出允许范围 ${formatRange(range)}。`);
    }
}

function validatePolygonGeometry(
    value: unknown,
    path: string,
    label: string,
    add: (severity: UpfValidationSeverity, path: string, message: string) => void,
) {
    if (!Array.isArray(value)) return;
    const points = value.flatMap((item) => {
        const point = asRecord(item);
        return point && isFiniteNumber(point.x) && isFiniteNumber(point.y) ? [{ x: point.x, y: point.y }] : [];
    });
    const uniquePoints = new Set(points.map(point => `${point.x},${point.y}`));
    if (uniquePoints.size < 3) {
        add('error', path, `${label} 至少需要 3 个不重复坐标点。`);
        return;
    }
    if (Math.abs(rawPolygonArea(points)) < 0.0001) add('error', path, `${label} 面积接近 0，可能存在共线或重复点。`);
}

function rawPolygonArea(points: Array<{ x: number; y: number }>): number {
    let sum = 0;
    for (let index = 0; index < points.length; index++) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum / 2);
}

function asRecord(value: unknown): AnyRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function identifierText(value: unknown): string | undefined {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function numberLike(value: unknown): number | undefined {
    if (isFiniteNumber(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function isPoint(value: unknown): boolean {
    const point = asRecord(value);
    return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function hasPoints(value: unknown, minLength: number): boolean {
    return Array.isArray(value) && value.length >= minLength && value.every(isPoint);
}

function severityLabel(severity: UpfValidationSeverity): string {
    if (severity === 'error') return '错误';
    if (severity === 'warning') return '警告';
    return '提示';
}
