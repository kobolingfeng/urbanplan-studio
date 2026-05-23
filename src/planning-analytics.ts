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
    evidence?: string[];
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
    const data = JSON.parse(text) as AnyRecord;
    const activeScenarioId = String(data.activeScenarioId
        ?? (data.manifest as AnyRecord | undefined)?.activeScenarioId
        ?? fallbackProject.scenarios?.[0]?.id
        ?? '');

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

    throw new Error('不是可识别的 UPF 文件');
}

export function buildScenarioComparisonReport(project: ProjectLike, activeScenarioId: string): string {
    const scenarios = project.scenarios ?? [];
    const parcels = (project.objects ?? []).filter(object => object.type === 'parcel');
    const rows = scenarios.map((scenario) => {
        let residentialGfa = 0;
        let publicServiceGfa = 0;
        let weightedFarSum = 0;
        let weightedGreenSum = 0;
        let areaSum = 0;
        let valuesCount = 0;
        for (const parcel of parcels) {
            const value = parcel.scenarioValues?.[scenario.id];
            if (!value) continue;
            const parcelArea = polygonArea(parcel.points ?? []);
            residentialGfa += Number(value.residentialGfaSqm ?? 0);
            publicServiceGfa += Number(value.publicServiceGfaSqm ?? 0);
            weightedFarSum += Number(value.far ?? 0) * parcelArea;
            weightedGreenSum += Number(value.greenRatio ?? 0) * parcelArea;
            areaSum += parcelArea;
            valuesCount++;
        }
        const residents = Math.round(residentialGfa / 33);
        const avgFar = areaSum ? weightedFarSum / areaSum : 0;
        const avgGreen = areaSum ? weightedGreenSum / areaSum : 0;
        return {
            scenario,
            residentialGfa,
            publicServiceGfa,
            residents,
            avgFar,
            avgGreen,
        };
    });

    const active = rows.find(row => row.scenario.id === activeScenarioId);
    const lines = [
        `# ${project.project?.name ?? 'UrbanPlan'} 方案对比`,
        '',
        `当前方案：${active?.scenario.name ?? activeScenarioId}`,
        '',
        '| 方案 | 住宅建面 | 估算人口 | 公服建面 | 平均 FAR | 平均绿地率 | 判断 |',
        '|---|---:|---:|---:|---:|---:|---|',
        ...rows.map(row => {
            const publicRatio = row.residentialGfa ? row.publicServiceGfa / row.residentialGfa : 0;
            const judgement = publicRatio >= 0.02 && row.avgGreen >= 0.30
                ? '公共性较好'
                : row.avgFar > 4.5
                    ? '强度偏高'
                    : '需专项复核';
            return `| ${row.scenario.name} | ${number(row.residentialGfa)} | ${number(row.residents)} | ${number(row.publicServiceGfa)} | ${row.avgFar.toFixed(2)} | ${(row.avgGreen * 100).toFixed(1)}% | ${judgement} |`;
        }),
        '',
        '## 产品化启发',
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
        '',
        '## 检查项',
        '',
        `- 对象总数：${quality.objectCount}`,
        `- 缺少证据来源的对象：${quality.missingEvidence.length}`,
        `- 规则依据条数：${quality.basisCount}`,
        `- 仍依赖原型规则的检查：${quality.prototypeRuleCount}`,
        `- 未绑定地块或道路的出入口：${quality.unboundEntrances.length}`,
        `- 地块方案值缺口：${quality.parcelScenarioGaps.length}`,
        `- 智能建议数量：${recommendations.length}`,
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
    const evidenceTypeCounts = objects
        .flatMap(object => object.evidence ?? [])
        .reduce<Record<string, number>>((counts, item) => {
            const kind = evidenceKind(item);
            counts[kind] = (counts[kind] ?? 0) + 1;
            return counts;
        }, {});
    const prototypeRuleCount = checks.filter(check => String(check.source ?? '').includes('原型')).length;
    const unboundEntrances = objects.filter(object => object.type === 'entrance' && (!object.parcelId || !object.roadId));
    const scenarioIds = new Set((project.scenarios ?? []).map(scenario => scenario.id));
    const parcelScenarioGaps = objects
        .filter(object => object.type === 'parcel')
        .flatMap(object => [...scenarioIds].filter(id => !object.scenarioValues?.[id]).map(id => `${object.name ?? object.id} 缺少 ${id}`));

    const score = Math.max(0, Math.min(100, 100
        - missingEvidence.length * 8
        - prototypeRuleCount * 4
        - unboundEntrances.length * 12
        - parcelScenarioGaps.length * 10
        - Math.max(0, recommendations.length - 8)));

    return {
        score,
        objectCount: objects.length,
        evidenceCoverage,
        evidenceTypeCounts,
        basisCount: project.ruleset?.basis?.length ?? 0,
        missingEvidence,
        prototypeRuleCount,
        unboundEntrances,
        parcelScenarioGaps,
    };
}

function evidenceKind(text: string): string {
    if (/GB|CJJ|规范|标准|导则|指南|控规|法定|修订|条例/.test(text)) return '规范/规划依据';
    if (/调研|实测|现场|访谈|问卷|遥感|手机信令|POI|路网/.test(text)) return '调研/空间数据';
    if (/演示|样例|原型|兼容层|用户/.test(text)) return '原型/用户输入';
    return '其他证据';
}

function number(value: number): string {
    return Math.round(value).toLocaleString('zh-CN');
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
    if (points.length < 3) return 1;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.max(1, Math.abs(sum / 2));
}
