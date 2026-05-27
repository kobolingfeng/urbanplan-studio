import {
    evidenceCompletenessScore,
    evidenceKind,
    isStructuredEvidence,
    type EvidenceItem,
} from './evidence';
import { markdownTableRow } from './markdown-table';
import { SERVICE_DEMAND_ASSUMPTIONS } from './planning-assumptions';
import { parseParcelIndicatorCsv } from './planning-csv';
import { parseGeoJsonProject } from './planning-geojson';
import { finiteNumberOr } from './planning-ranges';

type AnyRecord = Record<string, unknown>;

type ScenarioLike = {
    id: string;
    name: string;
    description?: string;
};

type CheckLike = {
    severity?: string;
    ruleId?: string;
    objectId?: string;
    objectName?: string;
    title?: string;
    message?: string;
    source?: string;
};

type RecommendationLike = {
    title?: string;
    message?: string;
    basis?: string;
};

type PlanningObjectLike = {
    id?: string;
    type?: string;
    name?: string;
    evidence?: EvidenceItem[];
    scenarioValues?: Record<string, {
        far?: number;
        residentialGfaSqm?: number;
        publicServiceGfaSqm?: number;
        greenRatio?: number;
        buildingCoverage?: number;
        updateMode?: string;
    }>;
    points?: Array<{ x: number; y: number }>;
    parcelId?: string;
    roadId?: string;
};

type ProjectLike = {
    format?: string;
    formatVersion?: string;
    project?: {
        id?: string;
        name?: string;
        city?: string;
        district?: string;
        planningType?: string;
        planningHorizon?: string;
        crs?: string;
    };
    ruleset?: {
        jurisdiction?: string;
        version?: string;
        basis?: string[];
    };
    scenarios?: ScenarioLike[];
    objects?: PlanningObjectLike[];
};

export type UpfParseResult<TProject> = {
    project: TProject;
    activeScenarioId: string;
};

export function createUpfDocument<TProject extends ProjectLike>(
    project: TProject,
    activeScenarioId: string,
    checks: CheckLike[],
    recommendations: RecommendationLike[],
    evaluation?: unknown,
) {
    return {
        format: project.format ?? 'UPF',
        formatVersion: project.formatVersion ?? '0.1.0',
        manifest: {
            format: project.format ?? 'UPF',
            formatVersion: project.formatVersion ?? '0.1.0',
            exportedAt: new Date().toISOString(),
            software: {
                name: 'UrbanPlan Studio',
                version: '0.1.0',
                channel: 'prototype',
            },
            unitSystem: {
                name: 'DemoCanvasMetric',
                metersPerCanvasUnit: 0.68,
            },
            activeScenarioId,
        },
        project: project.project,
        ruleset: project.ruleset,
        scenarios: project.scenarios,
        activeScenarioId,
        objects: project.objects,
        checks,
        recommendations,
        evaluation,
    };
}

export function parseUpfText<TProject extends ProjectLike>(
    text: string,
    fallbackProject: TProject,
): UpfParseResult<TProject> {
    const source = text.replace(/^\uFEFF/, '');
    let data: AnyRecord;
    try {
        data = JSON.parse(source) as AnyRecord;
    } catch {
        const csv = parseParcelIndicatorCsv(source, fallbackProject);
        if (csv) return csv;
        throw new Error('不是可识别的 UPF 文件');
    }
    const activeScenarioId = firstIdentifier(
        data.activeScenarioId,
        (data.manifest as AnyRecord | undefined)?.activeScenarioId,
        fallbackProject.scenarios?.[0]?.id,
    ) ?? '';

    if (data.format === 'UPF' && Array.isArray(data.objects) && Array.isArray(data.scenarios)) {
        return {
            project: {
                format: data.format,
                formatVersion: data.formatVersion ?? (data.manifest as AnyRecord | undefined)?.formatVersion ?? '0.1.0',
                project: data.project,
                ruleset: data.ruleset,
                scenarios: data.scenarios,
                objects: data.objects,
            } as TProject,
            activeScenarioId,
        };
    }

    if ((data.manifest as AnyRecord | undefined)?.format === 'UPF' && Array.isArray(data.objects) && Array.isArray(data.scenarios)) {
        return {
            project: {
                format: 'UPF',
                formatVersion: String((data.manifest as AnyRecord).formatVersion ?? '0.1.0'),
                project: data.project,
                ruleset: data.ruleset,
                scenarios: data.scenarios,
                objects: data.objects,
            } as TProject,
            activeScenarioId,
        };
    }

    if (Array.isArray(data.objects)) {
        return {
            project: {
                ...fallbackProject,
                objects: data.objects,
            },
            activeScenarioId,
        };
    }

    const geoJson = parseGeoJsonProject(data, fallbackProject);
    if (geoJson) return geoJson;

    throw new Error('不是可识别的 UPF 文件');
}

export function buildScenarioComparisonReport(
    project: ProjectLike,
    activeScenarioId: string,
    options: { headingLevel?: number } = {},
): string {
    const scenarios = project.scenarios ?? [];
    const parcels = (project.objects ?? []).filter(isComparableParcel);
    const titleLevel = Math.max(1, Math.min(6, options.headingLevel ?? 1));
    const rows = scenarios.map((scenario) => {
        const scenarioId = identifierText(scenario.id) ?? scenario.id;
        let residentialGfa = 0;
        let publicServiceGfa = 0;
        let weightedFarSum = 0;
        let weightedGreenSum = 0;
        let areaSum = 0;
        let valuesCount = 0;
        const missingParcels: string[] = [];
        for (const parcel of parcels) {
            const value = scenarioValueFor(parcel.scenarioValues, scenarioId);
            if (!value) {
                missingParcels.push(String(parcel.name ?? parcel.id ?? '未命名地块'));
                continue;
            }
            const parcelArea = polygonArea(parcel.points ?? []);
            residentialGfa += finiteNumberOr(value.residentialGfaSqm, 0);
            publicServiceGfa += finiteNumberOr(value.publicServiceGfaSqm, 0);
            weightedFarSum += finiteNumberOr(value.far, 0) * parcelArea;
            weightedGreenSum += finiteNumberOr(value.greenRatio, 0) * parcelArea;
            areaSum += parcelArea;
            valuesCount++;
        }
        const residents = Math.round(residentialGfa / SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident);
        const avgFar = areaSum ? weightedFarSum / areaSum : 0;
        const avgGreen = areaSum ? weightedGreenSum / areaSum : 0;
        return {
            scenario,
            scenarioId,
            residentialGfa,
            publicServiceGfa,
            residents,
            avgFar,
            avgGreen,
            valuesCount,
            missingParcels,
        };
    });

    const activeId = identifierText(activeScenarioId) ?? activeScenarioId;
    const active = rows.find(row => row.scenarioId === activeId);
    const dataGapRows = rows.filter(row => row.missingParcels.length);
    const lines = [
        `${heading(titleLevel)} ${project.project?.name ?? 'UrbanPlan'} 方案对比`,
        '',
        `当前方案：${active?.scenario.name ?? activeScenarioId}`,
        '',
        '| 方案 | 参与地块 | 缺失地块 | 住宅建面 | 估算人口 | 公服建面 | 平均 FAR | 平均绿地率 | 判断 |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---|',
        ...rows.map(row => {
            const publicRatio = row.residentialGfa ? row.publicServiceGfa / row.residentialGfa : 0;
            const judgement = publicRatio >= 0.02 && row.avgGreen >= 0.30
                ? '公共性较好'
                : row.avgFar > 4.5
                    ? '强度偏高'
                    : '需专项复核';
            return markdownTableRow([row.scenario.name, `${row.valuesCount}/${parcels.length}`, row.missingParcels.length, number(row.residentialGfa), number(row.residents), number(row.publicServiceGfa), row.avgFar.toFixed(2), `${(row.avgGreen * 100).toFixed(1)}%`, judgement]);
        }),
        '',
        `${heading(titleLevel + 1)} 方案数据缺口`,
        '',
        ...(dataGapRows.length
            ? dataGapRows.map(row => `- ${row.scenario.name} 缺失 ${row.missingParcels.length} 个地块方案值：${row.missingParcels.join('、')}`)
            : ['- 所有方案均覆盖全部地块。']),
        '',
        `${heading(titleLevel + 1)} 产品化启发`,
        '',
        '- 专业规划软件不应只展示单方案指标，而应把多方案容量、公共服务、绿地、风险同步比较。',
        '- 后续应加入政策目标线，例如人口、就业、住房供应、公共服务覆盖率、碳排和财政估算。',
    ];
    return lines.join('\n');
}

export function buildDataQualityReport(
    project: ProjectLike,
    checks: CheckLike[],
    recommendations: RecommendationLike[],
): string {
    const quality = calculateDataQuality(project, checks, recommendations);

    const lines = [
        `# ${project.project?.name ?? 'UrbanPlan'} 数据质量诊断`,
        '',
        `质量分：${quality.score}/100`,
        `证据覆盖率：${quality.evidenceCoverage.toFixed(1)}%`,
        `结构化证据覆盖率：${quality.structuredEvidenceCoverage.toFixed(1)}%`,
        `平均证据可信度：${quality.averageEvidenceConfidence}/100`,
        '',
        '## 检查项',
        '',
        `- 对象总数：${quality.objectCount}`,
        `- 缺少证据来源的对象：${quality.missingEvidence.length}`,
        `- 含结构化 EvidenceSource 的对象：${quality.structuredEvidenceObjects}`,
        `- 规则依据条数：${quality.basisCount}`,
        `- 仍依赖原型规则的检查：${quality.prototypeRuleCount}`,
        `- 未绑定或悬挂引用的出入口：${quality.unboundEntrances.length}`,
        `- 地块方案值缺口：${quality.parcelScenarioGaps.length}`,
        `- 智能建议数量：${recommendations.length}`,
        '',
        '## 扣分项',
        '',
        '| 项目 | 数量 | 单项扣分 | 扣分 |',
        '|---|---:|---:|---:|',
        ...quality.deductions.map(item => markdownTableRow([item.label, item.count, item.weight, item.points])),
        '',
        '## 规则依据清单',
        '',
        '| 规则 | 触发 | 最高等级 | 来源 |',
        '|---|---:|---|---|',
        ...quality.ruleCatalog.map(rule => markdownTableRow([rule.ruleId, rule.count, rule.maxSeverity, rule.source])),
        '',
        '## 证据类型分布',
        '',
        ...Object.entries(quality.evidenceTypeCounts).map(([kind, count]) => `- ${kind}：${count}`),
        '',
        '## 专业化要求',
        '',
        '- 所有对象必须有证据来源、获取时间、精度等级和可信度等级。',
        '- 所有规则必须有城市、版本、生效时间、条文来源、严重等级和可解释输出。',
        '- 导入文件必须保留格式版本，并支持向后兼容。',
        '- 出入口、设施和地块之间必须建立显式关系，不能只靠图面位置猜测。',
    ];

    if (quality.missingEvidence.length) {
        lines.push('', '## 证据缺口', '', ...quality.missingEvidence.map(object => `- ${object.name ?? object.id}`));
    }
    if (quality.parcelScenarioGaps.length) {
        lines.push('', '## 方案数据缺口', '', ...quality.parcelScenarioGaps.map(item => `- ${item}`));
    }
    if (quality.entranceReferenceIssues.length) {
        lines.push('', '## 引用完整性问题', '', ...quality.entranceReferenceIssues.map(item => `- ${item}`));
    }
    return lines.join('\n');
}

export function calculateDataQuality(
    project: ProjectLike,
    checks: CheckLike[],
    recommendations: RecommendationLike[] = [],
) {
    const objects = project.objects ?? [];
    const missingEvidence = objects.filter(object => !object.evidence?.length);
    const evidenceCoverage = objects.length ? (objects.length - missingEvidence.length) / objects.length * 100 : 100;
    const structuredEvidenceObjects = objects.filter(object => object.evidence?.some(isStructuredEvidence)).length;
    const structuredEvidenceCoverage = objects.length ? structuredEvidenceObjects / objects.length * 100 : 100;
    const evidenceItems = objects.flatMap(object => object.evidence ?? []);
    const averageEvidenceConfidence = evidenceItems.length
        ? Math.round(average(evidenceItems.map(evidenceCompletenessScore)))
        : 0;
    const evidenceTypeCounts = objects
        .flatMap(object => object.evidence ?? [])
        .reduce<Record<string, number>>((counts, item) => {
            const kind = evidenceKind(item);
            counts[kind] = (counts[kind] ?? 0) + 1;
            return counts;
        }, {});
    const prototypeRuleCount = checks.filter(check => String(check.source ?? '').includes('原型')).length;
    const ruleCatalog = buildRuleCatalog(checks);
    const entranceReferenceDiagnostics = buildEntranceReferenceDiagnostics(objects);
    const entranceReferenceIssues = entranceReferenceDiagnostics.issues;
    const unboundEntrances = objects.filter(object => object.type === 'entrance'
        && entranceReferenceDiagnostics.objectKeys.has(referenceObjectKey(object)));
    const scenarioIds = new Set((project.scenarios ?? []).map(scenario => identifierText(scenario.id)).filter((id): id is string => Boolean(id)));
    const parcelScenarioGaps = objects
        .filter(object => object.type === 'parcel')
        .flatMap(object => [...scenarioIds].filter(id => !scenarioValueFor(object.scenarioValues, id)).map(id => `${object.name ?? object.id} 缺少 ${id}`));

    const deductions = [
        deduction('缺少证据来源', missingEvidence.length, 8),
        deduction('缺少结构化证据', Math.max(0, objects.length - structuredEvidenceObjects), 3),
        deduction('原型规则触发', prototypeRuleCount, 4),
        deduction('出入口引用问题', entranceReferenceIssues.length, 12),
        deduction('地块方案值缺口', parcelScenarioGaps.length, 10),
        deduction('建议过多需归并', Math.max(0, recommendations.length - 8), 1),
    ];
    const score = Math.max(0, Math.min(100, 100 - deductions.reduce((sum, item) => sum + item.points, 0)));

    return {
        score,
        objectCount: objects.length,
        evidenceCoverage,
        structuredEvidenceCoverage,
        structuredEvidenceObjects,
        averageEvidenceConfidence,
        evidenceTypeCounts,
        deductions,
        basisCount: project.ruleset?.basis?.length ?? 0,
        ruleCatalog,
        missingEvidence,
        prototypeRuleCount,
        unboundEntrances,
        entranceReferenceIssues,
        parcelScenarioGaps,
    };
}

function buildEntranceReferenceDiagnostics(objects: PlanningObjectLike[]): { issues: string[]; objectKeys: Set<string> } {
    const parcelIds = new Set(objects.filter(object => object.type === 'parcel').map(object => identifierText((object as AnyRecord).id)).filter((id): id is string => Boolean(id)));
    const roadIds = new Set(objects.filter(object => object.type === 'road').map(object => identifierText((object as AnyRecord).id)).filter((id): id is string => Boolean(id)));
    const objectKeys = new Set<string>();
    const issues = objects
        .filter(object => object.type === 'entrance')
        .flatMap((object) => {
            const name = String(object.name ?? object.id ?? '未命名出入口');
            const parcelId = identifierText((object as AnyRecord).parcelId);
            const roadId = identifierText((object as AnyRecord).roadId);
            const issues: string[] = [];
            if (!parcelId) issues.push(`${name} 缺少地块引用`);
            else if (!parcelIds.has(parcelId)) issues.push(`${name} 引用不存在的地块 ${parcelId}`);
            if (!roadId) issues.push(`${name} 缺少道路引用`);
            else if (!roadIds.has(roadId)) issues.push(`${name} 引用不存在的道路 ${roadId}`);
            if (issues.length) objectKeys.add(referenceObjectKey(object));
            return issues;
        });
    return { issues, objectKeys };
}

function identifierText(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function firstIdentifier(...values: unknown[]): string | undefined {
    for (const value of values) {
        const id = identifierText(value);
        if (id) return id;
    }
    return undefined;
}

function scenarioValueFor<T>(values: Record<string, T> | undefined, scenarioId: unknown): T | undefined {
    const target = identifierText(scenarioId);
    if (!values || !target) return undefined;
    if (values[target]) return values[target];
    return Object.entries(values).find(([key]) => identifierText(key) === target)?.[1];
}

function referenceObjectKey(object: PlanningObjectLike): string {
    return identifierText((object as AnyRecord).id) ?? String(object.name ?? '未命名出入口');
}

function deduction(label: string, count: number, weight: number) {
    return {
        label,
        count,
        weight,
        points: count * weight,
    };
}

function buildRuleCatalog(checks: CheckLike[]) {
    const rank: Record<string, number> = { ok: 0, info: 1, warning: 2, error: 3 };
    const label: Record<string, string> = { ok: '通过', info: '提示', warning: '警告', error: '错误' };
    const map = new Map<string, { ruleId: string; count: number; maxSeverity: string; source: string }>();
    for (const check of checks) {
        const ruleId = String(check.ruleId ?? 'unknown_rule');
        const severity = String(check.severity ?? 'info');
        const current = map.get(ruleId) ?? {
            ruleId,
            count: 0,
            maxSeverity: severity,
            source: String(check.source ?? '未声明'),
        };
        current.count += 1;
        if ((rank[severity] ?? 1) > (rank[current.maxSeverity] ?? 1)) current.maxSeverity = severity;
        if (current.source === '未声明' && check.source) current.source = check.source;
        map.set(ruleId, current);
    }
    return [...map.values()]
        .sort((a, b) => (rank[b.maxSeverity] ?? 0) - (rank[a.maxSeverity] ?? 0) || b.count - a.count)
        .map(rule => ({ ...rule, maxSeverity: label[rule.maxSeverity] ?? rule.maxSeverity }));
}

function heading(level: number): string {
    return '#'.repeat(Math.max(1, Math.min(6, level)));
}

function number(value: number): string {
    return Math.round(value).toLocaleString('zh-CN');
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
    return Math.max(1, rawPolygonArea(points));
}

function isComparableParcel(object: PlanningObjectLike): boolean {
    return object.type === 'parcel'
        && Array.isArray(object.points)
        && object.points.length >= 3
        && rawPolygonArea(object.points) > 0.0001;
}

function rawPolygonArea(points: Array<{ x: number; y: number }>): number {
    if (points.length < 3 || !points.every(isFinitePoint)) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum / 2);
}

function isFinitePoint(point: { x: number; y: number } | undefined): point is { x: number; y: number } {
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
