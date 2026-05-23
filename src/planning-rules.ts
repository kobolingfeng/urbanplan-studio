import {
    areaSqm,
    centroid,
    distance,
    distanceToPolyline,
    polygonsOverlap,
    segmentIntersection,
    type Point,
} from './planning-geometry';

type Severity = 'error' | 'warning' | 'info' | 'ok';
type FacilityKind = '幼儿园' | '社区养老' | '社区卫生' | '文化活动' | '便民商业';

type RuleObject = {
    id: string;
    type: string;
    name: string;
    evidence?: string[];
    points?: Point[];
    point?: Point;
    kind?: string;
    level?: string;
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
    project: { name?: string };
    ruleset: { version?: string };
    objects: RuleObject[];
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

const SQM_PER_RESIDENT = 33;

export function runPlanningRules(project: RuleProject, scenarioId: string) {
    const checks: PlanningRuleResult[] = [];
    const add = (result: Omit<PlanningRuleResult, 'id'>) => {
        checks.push({ ...result, id: `check_${checks.length + 1}` });
    };

    const parcels = project.objects.filter(object => object.type === 'parcel' && object.points?.length);
    const roads = project.objects.filter(object => object.type === 'road' && object.points?.length);
    const facilities = project.objects.filter(object => object.type === 'facility' && object.point);

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
                source: `${project.ruleset.version ?? '规则集'} / 原型规则：地块控制指标`,
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
                source: `${project.ruleset.version ?? '规则集'} / 原型规则：地块控制指标`,
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
                source: `${project.ruleset.version ?? '规则集'} / 原型规则：地块控制指标`,
            });
        }
        if (number(value.publicServiceGfaSqm) < parcelArea * 0.015 && residents > 800) {
            add({
                ruleId: 'parcel_public_service_ratio',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'info',
                title: '公共服务建筑面积偏少',
                message: `服务人口约 ${format(residents)} 人，地块内公共服务空间仅 ${format(number(value.publicServiceGfaSqm))} 平方米。`,
                source: 'UPF 原型推断规则 / 完整社区导向',
            });
        }
        const overlapsHistoric = project.objects.some(item => item.type === 'constraint'
            && item.kind === '历史风貌控制'
            && item.points?.length
            && polygonsOverlap(parcel.points!, item.points));
        if (overlapsHistoric && value.updateMode === '拆除重建') {
            add({
                ruleId: 'historic_area_rebuild_risk',
                objectId: parcel.id,
                objectName: parcel.name,
                severity: 'warning',
                title: '历史风貌区拆除重建风险',
                message: '地块与历史风貌协调区存在空间重叠，拆除重建应优先触发风貌、保留建筑和街道界面复核。',
                source: '原型规则：城市更新风貌保护预警',
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
                source: '原型规则：参考 GB 50180-2018 的生活圈空间覆盖预警',
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
                source: '原型规则：参考完整居住社区建设指南的空间覆盖预警',
            });
        }
    }

    const parcelIds = new Set(parcels.map(parcel => parcel.id));
    for (const entrance of project.objects.filter(object => object.type === 'entrance' && object.point)) {
        if (!entrance.parcelId || !parcelIds.has(entrance.parcelId)) {
            add({
                ruleId: 'entrance_dangling_parcel',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'error',
                title: '出入口地块引用缺失',
                message: '出入口绑定的地块不存在，请重新选择关联地块。',
                source: 'UPF 引用完整性规则',
            });
        }
        const road = roads.find(item => item.id === entrance.roadId);
        if (!road) {
            add({
                ruleId: 'entrance_dangling_road',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'error',
                title: '出入口道路引用缺失',
                message: '出入口绑定的道路不存在，请重新选择关联道路。',
                source: 'UPF 引用完整性规则',
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
                source: '道路出入口原型规则 / 交通影响预警',
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
                source: 'UPF 几何一致性检查',
            });
        }
        const intersection = nearestRoadIntersection(roads, entrance.point!);
        const intersectionDistance = intersection ? distance(entrance.point!, intersection) : Number.POSITIVE_INFINITY;
        if (entrance.entranceType === '机动车' && intersectionDistance < 90) {
            add({
                ruleId: 'entrance_intersection_distance',
                objectId: entrance.id,
                objectName: entrance.name,
                severity: 'warning',
                title: '出入口接近交叉口',
                message: `距离主要交叉口约 ${format(intersectionDistance)} 米，需进一步交通组织论证。`,
                source: '道路出入口原型规则 / 安全间距预警',
            });
        }
    }

    const residents = parcels.reduce((sum, parcel) => sum + parcelResidents(parcel, scenarioId), 0);
    const kindergartenDemand = Math.ceil(residents * 0.036);
    const elderlyDemand = Math.ceil(residents * 0.03);
    const healthDemand = residents;
    const capacity = (kind: FacilityKind) => facilities
        .filter(facility => facility.kind === kind)
        .reduce((sum, facility) => sum + number(facility.capacity), 0);

    if (capacity('幼儿园') < kindergartenDemand) {
        add({
            ruleId: 'facility_kindergarten_gap',
            objectId: 'project',
            objectName: project.project.name ?? '项目',
            severity: 'warning',
            title: '幼儿园学位存在缺口',
            message: `估算需求 ${kindergartenDemand} 个学位，当前配置 ${capacity('幼儿园')}。`,
            source: '原型规则：参考 GB 50180-2018 的居住人口推演',
        });
    }
    if (capacity('社区养老') < elderlyDemand) {
        add({
            ruleId: 'facility_elderly_gap',
            objectId: 'project',
            objectName: project.project.name ?? '项目',
            severity: 'warning',
            title: '社区养老服务能力不足',
            message: `估算需求 ${elderlyDemand} 人服务能力，当前配置 ${capacity('社区养老')}。`,
            source: '完整居住社区建设指南 / 原型规则',
        });
    }
    if (capacity('社区卫生') < healthDemand) {
        add({
            ruleId: 'facility_health_gap',
            objectId: 'project',
            objectName: project.project.name ?? '项目',
            severity: 'info',
            title: '社区卫生服务承载需复核',
            message: `估算服务人口 ${format(healthDemand)} 人，当前卫生服务容量 ${format(capacity('社区卫生'))}。`,
            source: '完整社区公共服务推演 / 原型规则',
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
    return parcel.scenarioValues?.[scenarioId] ?? Object.values(parcel.scenarioValues ?? {})[0] ?? {};
}

function parcelResidents(parcel: RuleObject, scenarioId: string): number {
    return Math.round(number(parcelValue(parcel, scenarioId).residentialGfaSqm) / SQM_PER_RESIDENT);
}

function coveredByFacility(facilities: RuleObject[], point: Point, kind: FacilityKind): boolean {
    return facilities
        .filter(facility => facility.kind === kind && facility.point)
        .some(facility => distance(point, facility.point!) <= number(facility.serviceRadiusM));
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
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function format(value: number): string {
    return Math.round(value).toLocaleString('zh-CN');
}
