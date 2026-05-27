import type { EvidenceItem } from './evidence';
import { markdownTableRow } from './markdown-table';
import { SERVICE_DEMAND_ASSUMPTIONS } from './planning-assumptions';
import {
    areaSqm,
    centroid,
    distance,
    distanceToPolyline,
    polygonsOverlap,
    segmentIntersection,
    type Point,
} from './planning-geometry';
import { finiteNumberOr } from './planning-ranges';

type Severity = 'error' | 'warning' | 'info' | 'ok';
type FacilityKind = '幼儿园' | '社区养老' | '社区卫生' | '文化活动' | '便民商业';
type RuleSourceLevel = 'statutory' | 'technical' | 'format' | 'prototype';
type AnyRecord = Record<string, unknown>;

type RuleObject = {
    id: string;
    type: string;
    name: string;
    evidence?: EvidenceItem[];
    points?: Point[];
    point?: Point;
    landUseCode?: string;
    landUseName?: string;
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
    }>;
    entranceType?: string;
    parcelId?: string;
    roadId?: string;
    serviceRadiusM?: number;
    capacity?: number;
};

type RuleProject = {
    project?: { name?: string };
    ruleset?: { version?: string };
    objects?: RuleObject[];
};

export type PlanningRuleDefinition = {
    id: string;
    name: string;
    domain: '控规强度' | '用地兼容' | '公共服务' | '交通组织' | '风貌保护' | '数据完整性';
    defaultSeverity: Severity;
    jurisdiction: string;
    basis: string;
    clause: string;
    formula: string;
    prototype: boolean;
    source: RuleSource;
};

export type RuleSource = {
    jurisdiction: string;
    title: string;
    clause: string;
    level: RuleSourceLevel;
    version?: string;
    effectiveDate?: string;
    url?: string;
};

export type PlanningRuleResult = {
    id: string;
    ruleId: string;
    objectId: string;
    objectName: string;
    severity: Severity;
    title: string;
    message: string;
    source: string;
};

export type PlanningRecommendation = {
    id: string;
    objectId?: string;
    title: string;
    message: string;
    basis: string;
};

const SQM_PER_RESIDENT = SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident;

type RuleCatalogDraft = Omit<PlanningRuleDefinition, 'source'>;

const RULE_CATALOG_DRAFT: RuleCatalogDraft[] = [
    {
        id: 'parcel_far_max',
        name: '容积率不超过控制值',
        domain: '控规强度',
        defaultSeverity: 'error',
        jurisdiction: 'CN-GD-SZ / demo',
        basis: '地块控制指标',
        clause: 'FAR <= controls.farMax',
        formula: 'scenario.far > controls.farMax',
        prototype: false,
    },
    {
        id: 'parcel_green_min',
        name: '绿地率不低于控制值',
        domain: '控规强度',
        defaultSeverity: 'error',
        jurisdiction: 'CN-GD-SZ / demo',
        basis: '地块控制指标',
        clause: 'greenRatio >= controls.greenRatioMin',
        formula: 'scenario.greenRatio < controls.greenRatioMin',
        prototype: false,
    },
    {
        id: 'parcel_coverage_max',
        name: '建筑密度不超过控制值',
        domain: '控规强度',
        defaultSeverity: 'warning',
        jurisdiction: 'CN-GD-SZ / demo',
        basis: '地块控制指标',
        clause: 'buildingCoverage <= controls.buildingCoverageMax',
        formula: 'scenario.buildingCoverage > controls.buildingCoverageMax',
        prototype: false,
    },
    {
        id: 'parcel_public_service_ratio',
        name: '地块公共服务空间底线预警',
        domain: '公共服务',
        defaultSeverity: 'info',
        jurisdiction: 'UrbanPlan prototype',
        basis: '完整社区补短板导向',
        clause: '服务人口超过 800 人时提示地块内公共服务空间',
        formula: `publicServiceGfaSqm < parcelArea * ${SERVICE_DEMAND_ASSUMPTIONS.parcelPublicServiceGfaRatio} && residents > 800`,
        prototype: true,
    },
    {
        id: 'landuse_industrial_residential_mix',
        name: '工业用地居住功能兼容性预警',
        domain: '用地兼容',
        defaultSeverity: 'warning',
        jurisdiction: 'UrbanPlan prototype',
        basis: '用地性质兼容性预警',
        clause: '工业用地承载居住建筑面积需先完成用地调整或混合兼容论证',
        formula: 'landUseCode startsWith 1001 && residentialGfaSqm > 0',
        prototype: true,
    },
    {
        id: 'historic_area_rebuild_risk',
        name: '历史风貌区拆除重建风险',
        domain: '风貌保护',
        defaultSeverity: 'warning',
        jurisdiction: 'UrbanPlan prototype',
        basis: '城市更新风貌保护预警',
        clause: '风貌协调区内拆除重建需专项复核',
        formula: 'polygonsOverlap(parcel, heritageOverlay) && updateMode == 拆除重建',
        prototype: true,
    },
    {
        id: 'facility_kindergarten_coverage_gap',
        name: '幼儿园服务半径覆盖缺口',
        domain: '公共服务',
        defaultSeverity: 'warning',
        jurisdiction: 'CN / demo',
        basis: 'GB 50180-2018 生活圈设施导向',
        clause: '高人口居住地块应进入幼儿园服务覆盖',
        formula: 'residents > 900 && !coveredByFacility(kindergarten)',
        prototype: true,
    },
    {
        id: 'facility_elderly_coverage_gap',
        name: '社区养老服务半径覆盖缺口',
        domain: '公共服务',
        defaultSeverity: 'info',
        jurisdiction: 'CN / demo',
        basis: '完整居住社区建设指南',
        clause: '高人口地块建议嵌入养老、助餐、日间照料服务',
        formula: 'residents > 900 && !coveredByFacility(elderly)',
        prototype: true,
    },
    {
        id: 'entrance_dangling_parcel',
        name: '出入口地块引用完整性',
        domain: '数据完整性',
        defaultSeverity: 'error',
        jurisdiction: 'UPF 0.1',
        basis: 'UPF 引用完整性规则',
        clause: 'entrance.parcelId 必须指向存在的 parcel',
        formula: '!parcelIds.has(entrance.parcelId)',
        prototype: false,
    },
    {
        id: 'entrance_dangling_road',
        name: '出入口道路引用完整性',
        domain: '数据完整性',
        defaultSeverity: 'error',
        jurisdiction: 'UPF 0.1',
        basis: 'UPF 引用完整性规则',
        clause: 'entrance.roadId 必须指向存在的 road',
        formula: '!roadIds.has(entrance.roadId)',
        prototype: false,
    },
    {
        id: 'entrance_road_geometry_missing',
        name: '出入口关联道路几何缺失',
        domain: '数据完整性',
        defaultSeverity: 'error',
        jurisdiction: 'UPF 0.1',
        basis: 'UPF 几何完整性规则',
        clause: 'entrance.roadId 指向的 road 必须有可计算线位',
        formula: 'roadIds.has(entrance.roadId) && !road.points.length',
        prototype: false,
    },
    {
        id: 'entrance_arterial_risk',
        name: '机动车出入口主干路开口风险',
        domain: '交通组织',
        defaultSeverity: 'warning',
        jurisdiction: 'UrbanPlan prototype',
        basis: '道路出入口交通影响预警',
        clause: '机动车出入口优先接入支路或内部街巷',
        formula: 'entranceType == 机动车 && road.level == 主干路',
        prototype: true,
    },
    {
        id: 'entrance_road_distance',
        name: '出入口与关联道路几何一致性',
        domain: '交通组织',
        defaultSeverity: 'info',
        jurisdiction: 'UPF 0.1',
        basis: 'UPF 几何一致性检查',
        clause: '出入口应靠近所绑定道路',
        formula: 'distanceToPolyline(entrance.point, road.points) > 45',
        prototype: false,
    },
    {
        id: 'entrance_intersection_distance',
        name: '机动车出入口交叉口间距预警',
        domain: '交通组织',
        defaultSeverity: 'warning',
        jurisdiction: 'UrbanPlan prototype',
        basis: '道路出入口安全间距预警',
        clause: '机动车出入口接近交叉口时需交通组织论证',
        formula: 'distance(entrance, nearestIntersection) < thresholdByRoadLevel',
        prototype: true,
    },
    {
        id: 'road_redline_width_min',
        name: '道路红线宽度与等级匹配',
        domain: '交通组织',
        defaultSeverity: 'warning',
        jurisdiction: 'UrbanPlan prototype',
        basis: '道路等级与车道数经验阈值',
        clause: '道路红线宽度应覆盖道路等级下限和车道基本宽度',
        formula: 'redLineWidthM < max(classMinimum, lanes * 3.5 + 6)',
        prototype: true,
    },
    {
        id: 'facility_kindergarten_gap',
        name: '幼儿园学位容量缺口',
        domain: '公共服务',
        defaultSeverity: 'warning',
        jurisdiction: 'CN / demo',
        basis: 'GB 50180-2018 居住人口推演',
        clause: '幼儿园需求按估算人口比例推演',
        formula: `kindergartenCapacity < ceil(residents * ${SERVICE_DEMAND_ASSUMPTIONS.kindergartenSeatsPerResident})`,
        prototype: true,
    },
    {
        id: 'facility_elderly_gap',
        name: '社区养老服务能力缺口',
        domain: '公共服务',
        defaultSeverity: 'warning',
        jurisdiction: 'CN / demo',
        basis: '完整居住社区建设指南',
        clause: '养老服务能力按估算人口比例推演',
        formula: `elderlyCapacity < ceil(residents * ${SERVICE_DEMAND_ASSUMPTIONS.elderlyServiceCapacityPerResident})`,
        prototype: true,
    },
    {
        id: 'facility_health_gap',
        name: '社区卫生服务承载复核',
        domain: '公共服务',
        defaultSeverity: 'info',
        jurisdiction: 'UrbanPlan prototype',
        basis: '完整社区公共服务推演',
        clause: '卫生服务容量应覆盖估算服务人口',
        formula: 'healthCapacity < residents',
        prototype: true,
    },
];

export const RULE_CATALOG: PlanningRuleDefinition[] = RULE_CATALOG_DRAFT.map(rule => ({
    ...rule,
    source: buildStructuredRuleSource(rule),
}));

const RULE_CATALOG_BY_ID = new Map(RULE_CATALOG.map(rule => [rule.id, rule]));

export function buildRuleCatalogReport(triggered: PlanningRuleResult[] = []): string {
    const counts = triggered.reduce<Record<string, number>>((next, check) => {
        next[check.ruleId] = (next[check.ruleId] ?? 0) + 1;
        return next;
    }, {});
    const prototypeCount = RULE_CATALOG.filter(rule => rule.prototype).length;
    const domainRows = Object.entries(RULE_CATALOG.reduce<Record<string, { total: number; prototype: number; triggered: number }>>((next, rule) => {
        const row = next[rule.domain] ?? { total: 0, prototype: 0, triggered: 0 };
        row.total += 1;
        if (rule.prototype) row.prototype += 1;
        if (counts[rule.id]) row.triggered += counts[rule.id];
        next[rule.domain] = row;
        return next;
    }, {}));
    const sourceRows = Object.entries(RULE_CATALOG.reduce<Record<string, number>>((next, rule) => {
        const label = sourceLevelLabel(rule.source.level);
        next[label] = (next[label] ?? 0) + 1;
        return next;
    }, {}));
    const lines = [
        '# 规则目录与验证口径',
        '',
        `规则总数：${RULE_CATALOG.length}`,
        `原型启发式规则：${prototypeCount}`,
        `有触发记录的规则：${Object.keys(counts).length}`,
        `结构化 RuleSource：${RULE_CATALOG.filter(rule => rule.source).length}/${RULE_CATALOG.length}`,
        '',
        '## 规则分布',
        '',
        '| 领域 | 规则数 | 原型规则 | 本次触发次数 |',
        '|---|---:|---:|---:|',
        ...domainRows.map(([domain, row]) => markdownTableRow([domain, row.total, row.prototype, row.triggered])),
        '',
        '| 来源层级 | 规则数 |',
        '|---|---:|',
        ...sourceRows.map(([level, count]) => markdownTableRow([level, count])),
        '',
        '| 规则 ID | 领域 | 默认等级 | 来源层级 | 原型 | 本次触发 | 适用范围 | 依据 | 条款/口径 | 计算公式 |',
        '|---|---|---|---|---:|---:|---|---|---|---|',
        ...RULE_CATALOG.map(rule => markdownTableRow([rule.id, rule.domain, severityLabel(rule.defaultSeverity), sourceLevelLabel(rule.source.level), rule.prototype ? '是' : '否', counts[rule.id] ?? 0, rule.source.jurisdiction, rule.source.title, rule.source.clause, rule.formula])),
        '',
        '## 论文验证建议',
        '',
        '- 对每条规则抽取若干正例、反例和边界例，记录 TP、FP、FN。',
        '- 对原型启发式规则，不写成法定审查结论，只写成早期方案预警。',
        '- 对规则来源、公式和适用边界保留版本号，避免答辩时被质疑为黑箱判断。',
    ];
    return lines.join('\n');
}

export function runPlanningRules(project: RuleProject, scenarioId: string) {
    const checks: PlanningRuleResult[] = [];
    const add = (result: Omit<PlanningRuleResult, 'id'>) => {
        checks.push({ ...result, id: `check_${checks.length + 1}` });
    };
    const rulesetVersion = project.ruleset?.version;
    const objects = project.objects ?? [];

    const parcels = objects.filter(object => object.type === 'parcel' && isUsablePolygon(object.points));
    const roads = objects.filter(object => object.type === 'road' && isUsableLine(object.points));
    const facilities = objects.filter(object => object.type === 'facility' && isFinitePoint(object.point));

    for (const parcel of parcels) {
        const value = parcelValue(parcel, scenarioId);
        const controls = parcel.controls ?? {};
        const parcelArea = areaSqm(parcel.points!);
        const residents = parcelResidents(parcel, scenarioId);
        if (number(value.far) > number(controls.farMax, 99)) {
            add({
                ruleId: 'parcel_far_max',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'error',
                title: '容积率超过控制值',
                message: `当前 FAR ${number(value.far).toFixed(2)}，控制值 ${number(controls.farMax).toFixed(2)}。`,
                source: ruleSource('parcel_far_max', rulesetVersion),
            });
        }
        if (number(value.greenRatio) < number(controls.greenRatioMin, 0)) {
            add({
                ruleId: 'parcel_green_min',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'error',
                title: '绿地率低于控制值',
                message: `当前 ${(number(value.greenRatio) * 100).toFixed(1)}%，要求不低于 ${(number(controls.greenRatioMin) * 100).toFixed(1)}%。`,
                source: ruleSource('parcel_green_min', rulesetVersion),
            });
        }
        if (number(value.buildingCoverage) > number(controls.buildingCoverageMax, 99)) {
            add({
                ruleId: 'parcel_coverage_max',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'warning',
                title: '建筑密度偏高',
                message: `当前 ${(number(value.buildingCoverage) * 100).toFixed(1)}%，控制值 ${(number(controls.buildingCoverageMax) * 100).toFixed(1)}%。`,
                source: ruleSource('parcel_coverage_max', rulesetVersion),
            });
        }
        if (number(value.publicServiceGfaSqm) < parcelArea * SERVICE_DEMAND_ASSUMPTIONS.parcelPublicServiceGfaRatio && residents > 800) {
            add({
                ruleId: 'parcel_public_service_ratio',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'info',
                title: '公共服务建筑面积偏少',
                message: `服务人口约 ${format(residents)} 人，地块内公共服务空间仅 ${format(number(value.publicServiceGfaSqm))} 平方米。`,
                source: ruleSource('parcel_public_service_ratio', rulesetVersion),
            });
        }
        if (isIndustrialLand(parcel) && number(value.residentialGfaSqm) > 0) {
            add({
                ruleId: 'landuse_industrial_residential_mix',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'warning',
                title: '工业用地承载居住功能',
                message: `${parcel.landUseName ?? parcel.landUseCode ?? '当前用地'} 中包含 ${format(number(value.residentialGfaSqm))} 平方米住宅建面，需补充用地调整、混合兼容或更新单元论证。`,
                source: ruleSource('landuse_industrial_residential_mix', rulesetVersion),
            });
        }
        const overlapsHistoric = objects.some(item => item.type === 'constraint'
            && item.kind === '历史风貌控制'
            && isUsablePolygon(item.points)
            && polygonsOverlap(parcel.points!, item.points!));
        if (overlapsHistoric && value.updateMode === '拆除重建') {
            add({
                ruleId: 'historic_area_rebuild_risk',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'warning',
                title: '历史风貌区拆除重建风险',
                message: '地块与历史风貌协调区存在空间重叠，拆除重建应优先触发风貌、保留建筑和街道界面复核。',
                source: ruleSource('historic_area_rebuild_risk', rulesetVersion),
            });
        }
        const center = centroid(parcel.points!);
        if (residents > 900 && !coveredByFacility(facilities, center, '幼儿园')) {
            add({
                ruleId: 'facility_kindergarten_coverage_gap',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'warning',
                title: '幼儿园服务半径未覆盖地块',
                message: '该居住地块估算人口较高，但地块中心未落入现有或规划幼儿园服务半径。',
                source: ruleSource('facility_kindergarten_coverage_gap', rulesetVersion),
            });
        }
        if (residents > 900 && !coveredByFacility(facilities, center, '社区养老')) {
            add({
                ruleId: 'facility_elderly_coverage_gap',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'info',
                title: '社区养老服务半径未覆盖地块',
                message: '该地块服务人口较高，建议在 5-10 分钟步行范围内嵌入养老、助餐或日间照料点。',
                source: ruleSource('facility_elderly_coverage_gap', rulesetVersion),
            });
        }
    }

    const allParcelIds = new Set(objects
        .filter(object => object.type === 'parcel')
        .map(normalizedObjectId)
        .filter((id): id is string => Boolean(id)));
    const allRoadIds = new Set(objects
        .filter(object => object.type === 'road')
        .map(normalizedObjectId)
        .filter((id): id is string => Boolean(id)));
    for (const road of roads) {
        const width = number(road.redLineWidthM);
        const minimum = roadRedLineMinimum(road);
        if (width < minimum) {
            add({
                ruleId: 'road_redline_width_min',
                objectId: road.id,
                objectName: road.name,
                severity: 'warning',
                title: '道路红线宽度偏窄',
                message: `${road.level ?? '未声明等级'}、${format(number(road.lanes))} 车道建议红线不低于 ${minimum.toFixed(1)} 米，当前 ${width.toFixed(1)} 米。`,
                source: ruleSource('road_redline_width_min', rulesetVersion),
            });
        }
    }

    for (const entrance of objects.filter(object => object.type === 'entrance' && isFinitePoint(object.point))) {
        const parcelId = identifierText((entrance as unknown as AnyRecord).parcelId);
        const roadId = identifierText((entrance as unknown as AnyRecord).roadId);
        if (!parcelId || !allParcelIds.has(parcelId)) {
            add({
                ruleId: 'entrance_dangling_parcel',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'error',
                title: '出入口地块引用缺失',
                message: '出入口绑定的地块不存在，请重新选择关联地块。',
                source: ruleSource('entrance_dangling_parcel', rulesetVersion),
            });
        }
        const road = roads.find(item => normalizedObjectId(item) === roadId);
        if (!roadId || !allRoadIds.has(roadId)) {
            add({
                ruleId: 'entrance_dangling_road',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'error',
                title: '出入口道路引用缺失',
                message: '出入口绑定的道路不存在，请重新选择关联道路。',
                source: ruleSource('entrance_dangling_road', rulesetVersion),
            });
            continue;
        }
        if (!road) {
            add({
                ruleId: 'entrance_road_geometry_missing',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'error',
                title: '出入口关联道路缺少线位',
                message: '出入口绑定的道路对象存在，但缺少可计算线位；请补齐道路 points 后再复核距离和交叉口间距。',
                source: ruleSource('entrance_road_geometry_missing', rulesetVersion),
            });
            continue;
        }
        if (entrance.entranceType === '机动车' && road.level === '主干路') {
            add({
                ruleId: 'entrance_arterial_risk',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'warning',
                title: '机动车出入口不宜直接开向主干路',
                message: `${entrance.name} 关联 ${road.name}，建议优先转向支路或内部街巷组织交通。`,
                source: ruleSource('entrance_arterial_risk', rulesetVersion),
            });
        }
        const roadDistance = distanceToPolyline(entrance.point!, road.points!);
        if (roadDistance > 45) {
            add({
                ruleId: 'entrance_road_distance',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'info',
                title: '出入口与关联道路距离偏大',
                message: `出入口到关联道路约 ${format(roadDistance)} 米，请确认路网绑定是否正确。`,
                source: ruleSource('entrance_road_distance', rulesetVersion),
            });
        }
        const intersection = nearestRoadIntersection(roads, entrance.point!);
        const intersectionDistance = intersection ? distance(entrance.point!, intersection) : Number.POSITIVE_INFINITY;
        const intersectionThreshold = entranceIntersectionThreshold(road);
        if (entrance.entranceType === '机动车' && intersectionDistance < intersectionThreshold) {
            add({
                ruleId: 'entrance_intersection_distance',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'warning',
                title: '出入口接近交叉口',
                message: `${road.level ?? '未声明等级'}建议控制在 ${format(intersectionThreshold)} 米以外，当前距离主要交叉口约 ${format(intersectionDistance)} 米。`,
                source: ruleSource('entrance_intersection_distance', rulesetVersion),
            });
        }
    }

    const residents = parcels.reduce((sum, parcel) => sum + parcelResidents(parcel, scenarioId), 0);
    const kindergartenDemand = Math.ceil(residents * SERVICE_DEMAND_ASSUMPTIONS.kindergartenSeatsPerResident);
    const elderlyDemand = Math.ceil(residents * SERVICE_DEMAND_ASSUMPTIONS.elderlyServiceCapacityPerResident);
    const healthDemand = residents;
    const capacity = (kind: FacilityKind) => facilities
        .filter(facility => facility.kind === kind)
        .reduce((sum, facility) => sum + number(facility.capacity), 0);

    if (capacity('幼儿园') < kindergartenDemand) {
        add({
            ruleId: 'facility_kindergarten_gap',
            objectId: 'project',
            objectName: project.project?.name ?? '项目',
            severity: 'warning',
            title: '幼儿园学位存在缺口',
            message: `估算需求 ${kindergartenDemand} 个学位，当前配置 ${capacity('幼儿园')}。`,
            source: ruleSource('facility_kindergarten_gap', rulesetVersion),
        });
    }
    if (capacity('社区养老') < elderlyDemand) {
        add({
            ruleId: 'facility_elderly_gap',
            objectId: 'project',
            objectName: project.project?.name ?? '项目',
            severity: 'warning',
            title: '社区养老服务能力不足',
            message: `估算需求 ${elderlyDemand} 人服务能力，当前配置 ${capacity('社区养老')}。`,
            source: ruleSource('facility_elderly_gap', rulesetVersion),
        });
    }
    if (capacity('社区卫生') < healthDemand) {
        add({
            ruleId: 'facility_health_gap',
            objectId: 'project',
            objectName: project.project?.name ?? '项目',
            severity: 'info',
            title: '社区卫生服务承载需复核',
            message: `估算服务人口 ${format(healthDemand)} 人，当前卫生服务容量 ${format(capacity('社区卫生'))}。`,
            source: ruleSource('facility_health_gap', rulesetVersion),
        });
    }

    return {
        checks,
        recommendations: buildRecommendations(checks),
    };
}

function buildRecommendations(results: PlanningRuleResult[]): PlanningRecommendation[] {
    const next: PlanningRecommendation[] = [];
    const add = (recommendation: Omit<PlanningRecommendation, 'id'>) => {
        next.push({ ...recommendation, id: `rec_${next.length + 1}` });
    };

    for (const result of results) {
        if (result.ruleId === 'parcel_far_max') {
            add({
                objectId: result.objectId,
                title: '先降强度，再补设施',
                message: '建议把容积率压回控制值以内，再用释放的空间补充绿地、社区服务或慢行连接。',
                basis: result.source,
            });
        }
        if (result.ruleId === 'parcel_green_min') {
            add({
                objectId: result.objectId,
                title: '优先修复法定绿地指标',
                message: '可减少建筑基底、合并零散边角空间，或把开放空间与慢行绿廊连续组织。',
                basis: result.source,
            });
        }
        if (result.ruleId === 'entrance_arterial_risk') {
            add({
                objectId: result.objectId,
                title: '把车行入口转向低等级道路',
                message: '机动车出入口优先接入支路，主干路侧保留连续人行界面和公交换乘条件。',
                basis: result.source,
            });
        }
        if (result.ruleId === 'road_redline_width_min') {
            add({
                objectId: result.objectId,
                title: '复核道路红线与断面',
                message: '建议按道路等级、车道数、慢行空间和绿化带重新核算断面，必要时调整车道组织而不是只压缩人行空间。',
                basis: result.source,
            });
        }
        if (result.ruleId === 'landuse_industrial_residential_mix') {
            add({
                objectId: result.objectId,
                title: '先闭合用地性质论证',
                message: '建议在方案比选表中单列用地调整、混合用地准入、产业保留比例和公共利益贡献说明。',
                basis: result.source,
            });
        }
        if (result.ruleId === 'facility_kindergarten_coverage_gap' || result.ruleId === 'facility_elderly_coverage_gap') {
            add({
                objectId: result.objectId,
                title: '把设施缺口落到具体地块',
                message: '优先在未覆盖地块周边寻找可嵌入底层、公园边界或存量公共建筑的服务空间。',
                basis: result.source,
            });
        }
    }

    if (results.some(result => result.ruleId === 'facility_elderly_gap')) {
        add({
            title: '用存量空间嵌入养老服务',
            message: '可优先在老厂房更新地块或商住混合地块底层嵌入日间照料、助餐和康复服务。',
            basis: '完整居住社区建设指南 / 城市更新补短板逻辑',
        });
    }
    if (next.length === 0) {
        add({
            title: '当前方案基础规则表现较稳',
            message: '可以继续深化消防、日照、市政承载、交通影响和风貌控制等专项检查。',
            basis: 'UPF 原型规则检查',
        });
    }
    return next.slice(0, 8);
}

function parcelValue(parcel: RuleObject, scenarioId: string) {
    return scenarioValueFor(parcel.scenarioValues, scenarioId) ?? Object.values(parcel.scenarioValues ?? {})[0] ?? {};
}

function parcelResidents(parcel: RuleObject, scenarioId: string): number {
    return Math.round(number(parcelValue(parcel, scenarioId).residentialGfaSqm) / SQM_PER_RESIDENT);
}

function coveredByFacility(facilities: RuleObject[], point: Point, kind: FacilityKind): boolean {
    return facilities
        .filter(facility => facility.kind === kind && facility.point)
        .some(facility => distance(point, facility.point!) <= number(facility.serviceRadiusM));
}

function roadRedLineMinimum(road: RuleObject): number {
    const byClass: Record<string, number> = {
        '主干路': 30,
        '次干路': 24,
        '支路': 12,
        '慢行街巷': 6,
    };
    const classMinimum = byClass[String(road.level ?? '')] ?? 12;
    return Math.max(classMinimum, number(road.lanes, 1) * 3.5 + 6);
}

function entranceIntersectionThreshold(road: RuleObject): number {
    const byClass: Record<string, number> = {
        '主干路': 120,
        '次干路': 90,
        '支路': 50,
        '慢行街巷': 30,
    };
    return byClass[String(road.level ?? '')] ?? 60;
}

function isIndustrialLand(parcel: RuleObject): boolean {
    const code = String(parcel.landUseCode ?? '');
    const name = String(parcel.landUseName ?? '');
    return code.startsWith('1001') || /工业|厂房|产业/.test(name);
}

function nearestRoadIntersection(roads: RuleObject[], point: Point): Point | null {
    const intersections: Point[] = [];
    for (let i = 0; i < roads.length; i++) {
        for (let j = i + 1; j < roads.length; j++) {
            const aRoad = roads[i].points ?? [];
            const bRoad = roads[j].points ?? [];
            for (let a = 0; a < aRoad.length - 1; a++) {
                for (let b = 0; b < bRoad.length - 1; b++) {
                    const candidate = segmentIntersection(aRoad[a], aRoad[a + 1], bRoad[b], bRoad[b + 1]);
                    if (candidate) intersections.push(candidate);
                }
            }
        }
    }
    return intersections.sort((a, b) => distance(point, a) - distance(point, b))[0] ?? null;
}

function number(value: unknown, fallback = 0): number {
    return finiteNumberOr(value, fallback);
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

function normalizedObjectId(object: RuleObject): string | undefined {
    return identifierText((object as unknown as AnyRecord).id);
}

function identifierText(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value).trim();
    return text || undefined;
}

function scenarioValueFor<T>(values: Record<string, T> | undefined, scenarioId: unknown): T | undefined {
    if (!values) return undefined;
    const target = identifierText(scenarioId);
    if (!target) return undefined;
    if (values[target]) return values[target];
    return Object.entries(values).find(([key]) => identifierText(key) === target)?.[1];
}

function buildStructuredRuleSource(rule: RuleCatalogDraft): RuleSource {
    const version = sourceVersion(rule);
    return {
        jurisdiction: rule.jurisdiction,
        title: rule.basis,
        clause: rule.clause,
        level: sourceLevel(rule),
        ...(version ? { version } : {}),
        ...(rule.jurisdiction === 'UPF 0.1' ? { effectiveDate: '2026-05-23' } : {}),
    };
}

function sourceLevel(rule: RuleCatalogDraft): RuleSourceLevel {
    if (rule.prototype) return 'prototype';
    if (rule.jurisdiction.startsWith('UPF')) return 'format';
    if (rule.jurisdiction.includes('CN')) return 'technical';
    return 'statutory';
}

function sourceVersion(rule: RuleCatalogDraft): string {
    if (rule.jurisdiction === 'UPF 0.1') return '0.1.0';
    if (rule.basis.includes('GB 50180-2018')) return 'GB 50180-2018';
    if (rule.basis.includes('完整居住社区建设指南')) return '完整居住社区建设指南';
    if (rule.jurisdiction.includes('SZ')) return '深圳 2025 修订汇总版';
    if (rule.prototype) return 'UrbanPlan Studio prototype';
    return '';
}

function ruleSource(ruleId: string, rulesetVersion?: string): string {
    const rule = RULE_CATALOG_BY_ID.get(ruleId);
    if (!rule) return rulesetVersion ?? '未声明规则';
    const parts = [
        rule.source.title,
        rule.source.clause,
        rulesetVersion ?? rule.source.version,
        sourceLevelLabel(rule.source.level),
    ].filter(Boolean);
    return parts.join(' / ');
}

function format(value: number): string {
    return Math.round(value).toLocaleString('zh-CN');
}

function severityLabel(severity: Severity): string {
    if (severity === 'error') return '错误';
    if (severity === 'warning') return '警告';
    if (severity === 'ok') return '通过';
    return '提示';
}

function sourceLevelLabel(level: RuleSourceLevel): string {
    if (level === 'statutory') return '法定/强制';
    if (level === 'technical') return '技术导则';
    if (level === 'format') return '格式约束';
    return '原型启发';
}
