import {
    evidenceCompletenessScore,
    isStructuredEvidence,
    normalizeEvidenceItem,
    type EvidenceItem,
} from './evidence';
import { markdownTableRow } from './markdown-table';
import { SERVICE_DEMAND_ASSUMPTIONS, serviceDemandAssumptionText } from './planning-assumptions';
import {
    areaSqm,
    centroid,
    distance,
    distanceToPolyline,
    type Point,
} from './planning-geometry';
import { finiteNumberOr } from './planning-ranges';

type Severity = 'error' | 'warning' | 'info' | 'ok';
type FacilityKind = '幼儿园' | '社区养老' | '社区卫生' | '文化活动' | '便民商业';
type AnyRecord = Record<string, unknown>;

type ScenarioLike = {
    id: string;
    name: string;
    description?: string;
};

type CheckLike = {
    severity?: Severity | string;
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
    points?: Point[];
    point?: Point;
    kind?: string;
    level?: string;
    redLineWidthM?: number;
    lanes?: number;
    controls?: {
        farMax?: number;
        buildingCoverageMax?: number;
        greenRatioMin?: number;
        heightMaxM?: number;
    };
    scenarioValues?: Record<string, {
        far?: number;
        buildingCoverage?: number;
        greenRatio?: number;
        residentialGfaSqm?: number;
        publicServiceGfaSqm?: number;
        updateMode?: string;
        notes?: string;
    }>;
    entranceType?: string;
    parcelId?: string;
    roadId?: string;
    serviceRadiusM?: number;
    capacity?: number;
    planned?: boolean;
};

type ProjectLike = {
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

export type EvaluationBand = '优秀' | '良好' | '需优化' | '高风险';

export type DimensionScore = {
    id: string;
    name: string;
    score: number;
    weight: number;
    reason: string;
};

export type ParcelEvaluation = {
    objectId: string;
    name: string;
    score: number;
    band: EvaluationBand;
    drivers: string[];
};

type ParcelServiceAllocation = {
    name: string;
    residents: number;
    kindergartenNeed: number;
    elderlyNeed: number;
    publicServicePerThousand: number;
    kindergartenCovered: boolean;
    elderlyCovered: boolean;
};

export type ScenarioEvaluation = {
    scenarioId: string;
    scenarioName: string;
    modelId: string;
    modelName: string;
    weightSource: string;
    weights: EvaluationWeightSet;
    score: number;
    band: EvaluationBand;
    confidence: number;
    dimensions: DimensionScore[];
    parcels: ParcelEvaluation[];
    highlights: string[];
    riskRegister: string[];
};

export type EvaluationWeightSet = {
    compliance: number;
    publicService: number;
    mobility: number;
    ecology: number;
    renewalValue: number;
    evidence: number;
};

export type EvaluationWeightProfile = {
    id: string;
    name: string;
    description: string;
    weights: EvaluationWeightSet;
};

const SQM_PER_RESIDENT = SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident;
export const DEFAULT_EVALUATION_WEIGHTS: EvaluationWeightSet = {
    compliance: 0.24,
    publicService: 0.22,
    mobility: 0.16,
    ecology: 0.16,
    renewalValue: 0.12,
    evidence: 0.10,
};

export const EVALUATION_WEIGHT_PROFILES: EvaluationWeightProfile[] = [
    {
        id: 'balanced',
        name: '均衡模型',
        description: '适合作为论文默认模型，兼顾规则、服务、交通、生态、价值和证据。',
        weights: DEFAULT_EVALUATION_WEIGHTS,
    },
    {
        id: 'public_service_first',
        name: '公共服务优先',
        description: '强调完整社区、设施补短板和公共性增益。',
        weights: {
            compliance: 0.20,
            publicService: 0.32,
            mobility: 0.13,
            ecology: 0.14,
            renewalValue: 0.11,
            evidence: 0.10,
        },
    },
    {
        id: 'conservation_first',
        name: '保护与生态优先',
        description: '强调历史风貌、低冲击更新和蓝绿开放空间。',
        weights: {
            compliance: 0.24,
            publicService: 0.16,
            mobility: 0.12,
            ecology: 0.28,
            renewalValue: 0.08,
            evidence: 0.12,
        },
    },
    {
        id: 'implementation_risk',
        name: '实施风险优先',
        description: '强调控规合规、证据可信度和可落地性。',
        weights: {
            compliance: 0.32,
            publicService: 0.16,
            mobility: 0.14,
            ecology: 0.12,
            renewalValue: 0.10,
            evidence: 0.16,
        },
    },
];

export function evaluateScenario(
    project: ProjectLike,
    scenarioId: string,
    checks: CheckLike[] = [],
    recommendations: RecommendationLike[] = [],
    weightProfile: EvaluationWeightProfile = EVALUATION_WEIGHT_PROFILES[0],
): ScenarioEvaluation {
    const safeChecks = Array.isArray(checks) ? checks : [];
    const safeRecommendations = Array.isArray(recommendations) ? recommendations : [];
    const safeWeightProfile = normalizeWeightProfile(weightProfile);
    const objects = projectObjects(project);
    const parcels = objects.filter(isParcel);
    const roads = objects.filter(isRoad);
    const facilities = objects.filter(isFacility);
    const openSpaces = objects.filter(isOpenSpace);
    const entrances = objects.filter(isEntrance);
    const targetScenarioId = identifierText(scenarioId);
    const scenario = projectScenarios(project).find(item => identifierText(item.id) === targetScenarioId);
    const totals = summarizeParcels(parcels, scenarioId);

    const dimensions: DimensionScore[] = [
        complianceDimension(safeChecks, safeWeightProfile.weights.compliance),
        publicServiceDimension(parcels, facilities, scenarioId, totals.residents, totals.residentialGfa, safeWeightProfile.weights.publicService),
        mobilityDimension(parcels, roads, entrances, safeChecks, safeWeightProfile.weights.mobility),
        ecologyDimension(parcels, openSpaces, scenarioId, totals.residents, safeWeightProfile.weights.ecology),
        renewalValueDimension(project, parcels, scenarioId, safeWeightProfile.weights.renewalValue),
        evidenceDimension(project, safeChecks, safeRecommendations, safeWeightProfile.weights.evidence),
    ];

    const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
    const score = roundScore(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
    const parcelScores = parcels
        .map(parcel => evaluateParcel(parcel, scenarioId, safeChecks))
        .sort((a, b) => a.score - b.score);
    const confidence = evidenceConfidence(project, safeChecks);

    return {
        scenarioId,
        scenarioName: scenario?.name ?? scenarioId,
        modelId: safeWeightProfile.id,
        modelName: safeWeightProfile.name,
        weightSource: 'UrbanPlan Studio prototype built-in profile',
        weights: { ...safeWeightProfile.weights },
        score,
        band: scoreBand(score),
        confidence,
        dimensions,
        parcels: parcelScores,
        highlights: buildHighlights(dimensions, parcelScores, safeRecommendations),
        riskRegister: buildRiskRegister(safeChecks, parcelScores),
    };
}

export function buildScenarioEvaluationReport(
    project: ProjectLike,
    scenarioId: string,
    checks: CheckLike[] = [],
    recommendations: RecommendationLike[] = [],
): string {
    const evaluation = evaluateScenario(project, scenarioId, checks, recommendations);
    const projectName = project.project?.name ?? 'UrbanPlan';
    const serviceRows = buildParcelServiceAllocation(project, scenarioId);
    const lines = [
        `# ${projectName} 方案综合评估`,
        '',
        `当前方案：${evaluation.scenarioName}`,
        `评价模型：${evaluation.modelName}（${evaluation.modelId}）`,
        `权重来源：${evaluation.weightSource}`,
        `综合评分：${evaluation.score}/100（${evaluation.band}）`,
        `证据可信度：${evaluation.confidence}/100`,
        `规则版本：${project.ruleset?.version ?? '未声明'}`,
        '',
        '## 一、维度评分',
        '',
        '| 维度 | 权重 | 得分 | 解释 |',
        '|---|---:|---:|---|',
        ...evaluation.dimensions.map(item => markdownTableRow([item.name, `${(item.weight * 100).toFixed(0)}%`, item.score, item.reason])),
        '',
        '## 二、地块优先级',
        '',
        '| 地块 | 评分 | 状态 | 主要驱动因素 |',
        '|---|---:|---|---|',
        ...evaluation.parcels.map(parcel => markdownTableRow([parcel.name, parcel.score, parcel.band, parcel.drivers.join('；')])),
        '',
        '## 三、服务人口分摊',
        '',
        '| 地块 | 估算人口 | 幼儿园需求 | 养老服务需求 | 公服建面/千人 | 幼儿园覆盖 | 养老覆盖 |',
        '|---|---:|---:|---:|---:|---|---|',
        ...(serviceRows.length
            ? serviceRows.map(row => markdownTableRow([row.name, row.residents, row.kindergartenNeed, row.elderlyNeed, row.publicServicePerThousand.toFixed(0), row.kindergartenCovered ? '是' : '否', row.elderlyCovered ? '是' : '否']))
            : ['| 暂无 | 0 | 0 | 0 | 0 | - | - |']),
        '',
        '## 四、答辩可解释结论',
        '',
        ...evaluation.highlights.map(item => `- ${item}`),
        '',
        '## 五、风险登记',
        '',
        ...(evaluation.riskRegister.length ? evaluation.riskRegister.map(item => `- ${item}`) : ['- 当前基础规则未识别高优先级风险，可继续补充交通、消防、日照、市政承载等专项模型。']),
        '',
        '## 六、方法说明',
        '',
        '- 本模块采用可解释的多指标加权评分，不把评分包装成法定结论。',
        '- 评分维度包括控规符合性、公共服务、交通可达、生态开放空间、更新价值和证据可信度。',
        `- 服务人口分摊假设：${serviceDemandAssumptionText()}。`,
        '- 每个维度均保留文字原因，便于在硕士论文中对应“指标体系、权重、计算过程、案例验证”。',
        '- 当前权重为原型默认权重，后续可通过专家打分、AHP 或熵权法校准。',
    ];
    return lines.join('\n');
}

function complianceDimension(checks: CheckLike[], weight: number): DimensionScore {
    const score = clamp(100 - checks.reduce((sum, check) => sum + severityPenalty(check.severity), 0));
    const errors = checks.filter(check => check.severity === 'error').length;
    const warnings = checks.filter(check => check.severity === 'warning').length;
    return {
        id: 'compliance',
        name: '控规符合性',
        weight,
        score,
        reason: errors || warnings
            ? `${errors} 个错误、${warnings} 个警告拉低得分`
            : '当前规则集未发现明显红线问题',
    };
}

function publicServiceDimension(
    parcels: PlanningObjectLike[],
    facilities: PlanningObjectLike[],
    scenarioId: string,
    residents: number,
    residentialGfa: number,
    weight: number,
): DimensionScore {
    const publicServiceGfa = parcels.reduce((sum, parcel) => sum + number(parcelValue(parcel, scenarioId).publicServiceGfaSqm), 0);
    const publicRatioScore = targetRatioScore(residentialGfa ? publicServiceGfa / residentialGfa : 0, SERVICE_DEMAND_ASSUMPTIONS.publicServiceGfaToResidentialTarget);
    const kindergarten = facilityScore(parcels, facilities, scenarioId, '幼儿园', residents * SERVICE_DEMAND_ASSUMPTIONS.kindergartenSeatsPerResident);
    const elderly = facilityScore(parcels, facilities, scenarioId, '社区养老', residents * SERVICE_DEMAND_ASSUMPTIONS.elderlyServiceCapacityPerResident);
    const health = facilityScore(parcels, facilities, scenarioId, '社区卫生', residents);
    const score = roundScore(average([publicRatioScore, kindergarten, elderly, health]));
    return {
        id: 'publicService',
        name: '公共服务',
        weight,
        score,
        reason: `公服建面/住宅建面约 ${asPercent(residentialGfa ? publicServiceGfa / residentialGfa : 0)}，并综合幼儿园、养老、卫生覆盖`,
    };
}

function mobilityDimension(
    parcels: PlanningObjectLike[],
    roads: PlanningObjectLike[],
    entrances: PlanningObjectLike[],
    checks: CheckLike[],
    weight: number,
): DimensionScore {
    const areaHa = Math.max(0.1, parcels.reduce((sum, parcel) => sum + areaSqm(parcel.points ?? []), 0) / 10000);
    const roadDensity = roads.reduce((sum, road) => sum + polylineLength(road.points ?? []), 0) / areaHa;
    const densityScore = targetRatioScore(roadDensity, 140);
    const accessScore = parcels.length
        ? average(parcels.map(parcel => nearestRoadDistanceScore(centroid(parcel.points ?? []), roads)))
        : 100;
    const entranceRiskCount = checks.filter(check => String(check.ruleId ?? '').startsWith('entrance_')).length;
    const entranceScore = clamp(100 - entranceRiskCount * 12 - Math.max(0, entrances.length - parcels.length * 2) * 6);
    const score = roundScore(average([densityScore, accessScore, entranceScore]));
    return {
        id: 'mobility',
        name: '交通组织',
        weight,
        score,
        reason: `路网密度约 ${roadDensity.toFixed(0)} m/ha，叠加出入口风险和地块到路网距离`,
    };
}

function ecologyDimension(
    parcels: PlanningObjectLike[],
    openSpaces: PlanningObjectLike[],
    scenarioId: string,
    residents: number,
    weight: number,
): DimensionScore {
    const parcelArea = parcels.reduce((sum, parcel) => sum + areaSqm(parcel.points ?? []), 0);
    const greenScore = parcelArea
        ? parcels.reduce((sum, parcel) => {
            const area = areaSqm(parcel.points ?? []);
            const value = parcelValue(parcel, scenarioId);
            const target = Math.max(0.01, number(parcel.controls?.greenRatioMin, 0.3));
            return sum + targetRatioScore(number(value.greenRatio), target) * area;
        }, 0) / parcelArea
        : 100;
    const openSpaceSqm = openSpaces.reduce((sum, space) => sum + areaSqm(space.points ?? []), 0);
    const openSpacePerCapitaScore = targetRatioScore(residents ? openSpaceSqm / residents : openSpaceSqm, 4);
    const score = roundScore(average([greenScore, openSpacePerCapitaScore]));
    return {
        id: 'ecology',
        name: '生态与开放空间',
        weight,
        score,
        reason: `综合地块绿地率达标度和人均开放空间，开放空间约 ${Math.round(openSpaceSqm).toLocaleString('zh-CN')} 平方米`,
    };
}

function renewalValueDimension(project: ProjectLike, parcels: PlanningObjectLike[], scenarioId: string, weight: number): DimensionScore {
    const baselineId = projectScenarios(project).find(scenario => identifierText(scenario.id)?.toLowerCase().includes('baseline'))?.id;
    const fitScores = parcels.map(parcel => {
        const value = parcelValue(parcel, scenarioId);
        const farMax = number(parcel.controls?.farMax, 4);
        const far = number(value.far);
        const ratio = farMax ? far / farMax : 0;
        const fit = ratio > 1 ? 100 - (ratio - 1) * 180 : ratio < 0.45 ? 72 + ratio * 32 : 100 - Math.abs(0.82 - ratio) * 32;
        const modeBonus = value.updateMode === '拆除重建' ? -4 : value.updateMode === '综合整治' ? 4 : 0;
        return clamp(fit + modeBonus);
    });
    const upliftScores = baselineId
        ? parcels.map(parcel => {
            const current = number(parcelValue(parcel, scenarioId).publicServiceGfaSqm);
            const baseline = number(parcelValue(parcel, baselineId).publicServiceGfaSqm);
            return clamp(70 + Math.min(30, (current - baseline) / 40));
        })
        : [];
    const score = roundScore(average([...fitScores, ...upliftScores]));
    return {
        id: 'renewalValue',
        name: '更新价值',
        weight,
        score,
        reason: baselineId
            ? '比较现状基准与当前方案的强度适配和公服增量'
            : '根据强度适配、更新方式和公共性增益估算',
    };
}

function evidenceDimension(project: ProjectLike, checks: CheckLike[], recommendations: RecommendationLike[], weight: number): DimensionScore {
    const score = evidenceConfidence(project, checks, recommendations);
    const objects = projectObjects(project);
    const evidenceObjects = objects.filter(object => objectEvidence(object).length).length;
    const structuredObjects = objects.filter(object => objectEvidence(object).some(isStructuredEvidence)).length;
    return {
        id: 'evidence',
        name: '证据可信度',
        weight,
        score,
        reason: `${evidenceObjects}/${objects.length || 1} 个对象有证据来源，${structuredObjects} 个对象含结构化 EvidenceSource，规则依据 ${countBasis(project)} 条`,
    };
}

function evaluateParcel(parcel: PlanningObjectLike, scenarioId: string, checks: CheckLike[]): ParcelEvaluation {
    const value = parcelValue(parcel, scenarioId);
    const parcelChecks = checks.filter(check => check.objectId === parcel.id);
    const controls = parcel.controls ?? {};
    const far = number(value.far);
    const farMax = number(controls.farMax, 4);
    const greenRatio = number(value.greenRatio);
    const greenMin = number(controls.greenRatioMin, 0.3);
    const serviceRatio = number(value.residentialGfaSqm) ? number(value.publicServiceGfaSqm) / number(value.residentialGfaSqm) : 0;
    const compliance = clamp(100 - parcelChecks.reduce((sum, check) => sum + severityPenalty(check.severity), 0));
    const farScore = farMax ? clamp(100 - Math.max(0, far - farMax) * 35 - Math.max(0, farMax * 0.45 - far) * 8) : 80;
    const greenScore = targetRatioScore(greenRatio, greenMin);
    const serviceScore = targetRatioScore(serviceRatio, SERVICE_DEMAND_ASSUMPTIONS.publicServiceGfaToResidentialTarget);
    const evidence = objectEvidence(parcel);
    const evidenceScore = evidence.length
        ? Math.max(60, average(evidence.map(evidenceCompletenessScore)))
        : 45;
    const score = roundScore(compliance * 0.35 + greenScore * 0.20 + serviceScore * 0.20 + farScore * 0.15 + evidenceScore * 0.10);
    return {
        objectId: String(parcel.id ?? ''),
        name: String(parcel.name ?? parcel.id ?? '未命名地块'),
        score,
        band: scoreBand(score),
        drivers: parcelDrivers(parcelChecks, far, farMax, greenRatio, greenMin, serviceRatio, evidence.length),
    };
}

function buildHighlights(
    dimensions: DimensionScore[],
    parcels: ParcelEvaluation[],
    recommendations: RecommendationLike[],
): string[] {
    const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
    const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
    const priorityParcel = parcels[0];
    const highlights = [
        `最强维度是“${strongest.name}”（${strongest.score}/100），可以作为方案论证的稳定支撑。`,
        `最弱维度是“${weakest.name}”（${weakest.score}/100），适合作为下一轮优化和论文实验的主变量。`,
    ];
    if (priorityParcel) {
        highlights.push(`优先复核地块为“${priorityParcel.name}”（${priorityParcel.score}/100），主要原因：${priorityParcel.drivers.join('；')}。`);
    }
    if (recommendations.length) {
        highlights.push(`系统生成 ${recommendations.length} 条可追溯建议，可作为“规则引擎辅助规划判断”的展示材料。`);
    }
    return highlights;
}

function buildRiskRegister(checks: CheckLike[], parcels: ParcelEvaluation[]): string[] {
    const ruleRisks = checks
        .filter(check => check.severity === 'error' || check.severity === 'warning')
        .slice(0, 8)
        .map(check => `${check.objectName ?? check.objectId ?? '项目'}：${check.title ?? check.ruleId}。${check.message ?? ''}`.trim());
    const parcelRisks = parcels
        .filter(parcel => parcel.score < 70)
        .slice(0, 4)
        .map(parcel => `${parcel.name} 评分偏低，需要优先处理 ${parcel.drivers[0] ?? '指标短板'}`);
    return [...new Set([...ruleRisks, ...parcelRisks])];
}

function facilityScore(
    parcels: PlanningObjectLike[],
    facilities: PlanningObjectLike[],
    scenarioId: string,
    kind: FacilityKind,
    demand: number,
): number {
    const matched = facilities.filter(facility => facility.kind === kind && facility.point);
    const capacity = matched.reduce((sum, facility) => sum + number(facility.capacity), 0);
    const totalResidents = parcels.reduce((sum, parcel) => sum + parcelResidents(parcel, scenarioId), 0);
    const coveredResidents = parcels.reduce((sum, parcel) => {
        const center = centroid(parcel.points ?? []);
        const covered = matched.some(facility => distance(center, facility.point!) <= number(facility.serviceRadiusM, 0));
        return sum + (covered ? parcelResidents(parcel, scenarioId) : 0);
    }, 0);
    const coverageScore = totalResidents ? coveredResidents / totalResidents * 100 : 100;
    const capacityScore = demand ? Math.min(100, capacity / demand * 100) : 100;
    return average([coverageScore, capacityScore]);
}

function buildParcelServiceAllocation(project: ProjectLike, scenarioId: string): ParcelServiceAllocation[] {
    const parcels = projectObjects(project).filter(isParcel);
    const facilities = projectObjects(project).filter(isFacility);
    return parcels.map((parcel) => {
        const value = parcelValue(parcel, scenarioId);
        const residents = parcelResidents(parcel, scenarioId);
        const publicServiceGfa = number(value.publicServiceGfaSqm);
        return {
            name: String(parcel.name ?? parcel.id ?? '未命名地块'),
            residents,
            kindergartenNeed: Math.ceil(residents * SERVICE_DEMAND_ASSUMPTIONS.kindergartenSeatsPerResident),
            elderlyNeed: Math.ceil(residents * SERVICE_DEMAND_ASSUMPTIONS.elderlyServiceCapacityPerResident),
            publicServicePerThousand: residents ? publicServiceGfa / residents * 1000 : 0,
            kindergartenCovered: parcelCoveredByFacility(parcel, facilities, '幼儿园'),
            elderlyCovered: parcelCoveredByFacility(parcel, facilities, '社区养老'),
        };
    }).sort((a, b) => a.publicServicePerThousand - b.publicServicePerThousand || b.residents - a.residents);
}

function parcelCoveredByFacility(
    parcel: PlanningObjectLike,
    facilities: PlanningObjectLike[],
    kind: FacilityKind,
): boolean {
    const center = centroid(parcel.points ?? []);
    return facilities.some(facility => facility.kind === kind
        && facility.point
        && distance(center, facility.point) <= number(facility.serviceRadiusM));
}

function nearestRoadDistanceScore(point: Point, roads: PlanningObjectLike[]): number {
    if (!roads.length) return 40;
    const best = Math.min(...roads.map(road => distanceToPolyline(point, road.points ?? [])));
    if (!Number.isFinite(best)) return 40;
    return clamp(100 - Math.max(0, best - 45) * 1.6);
}

function summarizeParcels(parcels: PlanningObjectLike[], scenarioId: string) {
    return parcels.reduce((sum, parcel) => {
        const value = parcelValue(parcel, scenarioId);
        return {
            residents: sum.residents + parcelResidents(parcel, scenarioId),
            residentialGfa: sum.residentialGfa + number(value.residentialGfaSqm),
        };
    }, { residents: 0, residentialGfa: 0 });
}

function parcelDrivers(
    parcelChecks: CheckLike[],
    far: number,
    farMax: number,
    greenRatio: number,
    greenMin: number,
    serviceRatio: number,
    evidenceCount: number,
): string[] {
    const drivers = parcelChecks
        .filter(check => check.severity === 'error' || check.severity === 'warning')
        .slice(0, 3)
        .map(check => String(check.title ?? check.ruleId));
    if (far > farMax) drivers.push(`FAR 超控制值 ${farMax.toFixed(1)}`);
    if (greenRatio < greenMin) drivers.push(`绿地率低于 ${(greenMin * 100).toFixed(0)}%`);
    if (serviceRatio < 0.02) drivers.push('公共服务空间偏少');
    if (!evidenceCount) drivers.push('缺少证据来源');
    if (!drivers.length) drivers.push('指标较均衡，适合进入专项深化');
    return [...new Set(drivers)].slice(0, 4);
}

function evidenceConfidence(project: ProjectLike, checks: CheckLike[], recommendations: RecommendationLike[] = []): number {
    const objects = projectObjects(project);
    const evidenceCoverage = objects.length
        ? objects.filter(object => objectEvidence(object).length).length / objects.length * 100
        : 100;
    const structuredEvidenceCoverage = objects.length
        ? objects.filter(object => objectEvidence(object).some(isStructuredEvidence)).length / objects.length * 100
        : 100;
    const evidenceItems = objects.flatMap(objectEvidence);
    const evidenceQuality = evidenceItems.length ? average(evidenceItems.map(evidenceCompletenessScore)) : 45;
    const basisScore = Math.min(100, countBasis(project) * 18 + 28);
    const prototypePenalty = checks.filter(check => String(check.source ?? '').includes('原型')).length * 3;
    const recommendationPenalty = Math.max(0, recommendations.length - 8) * 2;
    return roundScore(average([evidenceCoverage, structuredEvidenceCoverage, evidenceQuality, basisScore]) - prototypePenalty - recommendationPenalty);
}

function parcelValue(parcel: PlanningObjectLike, scenarioId: string) {
    const values = scenarioValueMap(parcel.scenarioValues);
    return scenarioValueFor(values, scenarioId) ?? Object.values(values)[0] ?? {};
}

function projectObjects(project: ProjectLike): PlanningObjectLike[] {
    return Array.isArray(project.objects) ? project.objects : [];
}

function projectScenarios(project: ProjectLike): ScenarioLike[] {
    return Array.isArray(project.scenarios) ? project.scenarios : [];
}

function countBasis(project: ProjectLike): number {
    return Array.isArray(project.ruleset?.basis) ? project.ruleset.basis.length : 0;
}

function normalizeWeightProfile(value: EvaluationWeightProfile): EvaluationWeightProfile {
    const fallback = EVALUATION_WEIGHT_PROFILES[0];
    const profile = value && typeof value === 'object' ? value as Partial<EvaluationWeightProfile> : {};
    if (!profile.weights || typeof profile.weights !== 'object') return fallback;
    const rawWeights = profile.weights as Record<string, unknown>;
    const weights: EvaluationWeightSet = {
        compliance: nonNegativeWeight(rawWeights.compliance, fallback.weights.compliance),
        publicService: nonNegativeWeight(rawWeights.publicService, fallback.weights.publicService),
        mobility: nonNegativeWeight(rawWeights.mobility, fallback.weights.mobility),
        ecology: nonNegativeWeight(rawWeights.ecology, fallback.weights.ecology),
        renewalValue: nonNegativeWeight(rawWeights.renewalValue, fallback.weights.renewalValue),
        evidence: nonNegativeWeight(rawWeights.evidence, fallback.weights.evidence),
    };
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    if (!Number.isFinite(total) || total <= 0) return fallback;
    return {
        id: textOr(profile.id, fallback.id),
        name: textOr(profile.name, fallback.name),
        description: textOr(profile.description, fallback.description),
        weights,
    };
}

function nonNegativeWeight(value: unknown, fallback: number): number {
    const weight = finiteNumberOr(value, fallback);
    return weight >= 0 ? weight : fallback;
}

function textOr(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function objectEvidence(object: PlanningObjectLike): EvidenceItem[] {
    const value = (object as AnyRecord).evidence;
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => {
        const normalized = normalizeEvidenceItem(item);
        return normalized ? [normalized] : [];
    });
}

function parcelResidents(parcel: PlanningObjectLike, scenarioId: string): number {
    return Math.round(number(parcelValue(parcel, scenarioId).residentialGfaSqm) / SQM_PER_RESIDENT);
}

function polylineLength(points: Point[]): number {
    return points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
}

function targetRatioScore(value: number, target: number): number {
    if (target <= 0) return 100;
    return clamp(value / target * 100);
}

function severityPenalty(severity: unknown): number {
    if (severity === 'error') return 18;
    if (severity === 'warning') return 9;
    if (severity === 'info') return 3;
    return 0;
}

function average(values: number[]): number {
    const valid = values.filter(value => Number.isFinite(value));
    if (!valid.length) return 100;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function roundScore(value: number): number {
    return Math.round(clamp(value));
}

function clamp(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function scoreBand(score: number): EvaluationBand {
    if (score >= 85) return '优秀';
    if (score >= 70) return '良好';
    if (score >= 55) return '需优化';
    return '高风险';
}

function number(value: unknown, fallback = 0): number {
    return finiteNumberOr(value, fallback);
}

function scenarioValueFor<T>(values: Record<string, T> | undefined, scenarioId: unknown): T | undefined {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined;
    const target = identifierText(scenarioId);
    if (!target) return undefined;
    if (Object.prototype.hasOwnProperty.call(values, target)) return values[target];
    return Object.entries(values).find(([key]) => identifierText(key) === target)?.[1];
}

function scenarioValueMap<T>(values: Record<string, T> | undefined): Record<string, T> {
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
}

function identifierText(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function asPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function isParcel(object: PlanningObjectLike): boolean {
    return object.type === 'parcel' && isUsablePolygon(object.points);
}

function isRoad(object: PlanningObjectLike): boolean {
    return object.type === 'road' && isUsableLine(object.points);
}

function isFacility(object: PlanningObjectLike): boolean {
    return object.type === 'facility' && isFinitePoint(object.point);
}

function isEntrance(object: PlanningObjectLike): boolean {
    return object.type === 'entrance' && isFinitePoint(object.point);
}

function isOpenSpace(object: PlanningObjectLike): boolean {
    return object.type === 'openSpace' && isUsablePolygon(object.points);
}

function isUsablePolygon(points: Point[] | undefined): boolean {
    return (points?.length ?? 0) >= 3 && areaSqm(points ?? []) > 0.0001;
}

function isUsableLine(points: Point[] | undefined): boolean {
    if (!points || points.length < 2 || !points.every(isFinitePoint)) return false;
    return points.slice(1).some((point, index) => {
        const previous = points[index];
        return point.x !== previous.x || point.y !== previous.y;
    });
}

function isFinitePoint(point: Point | undefined): point is Point {
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}
