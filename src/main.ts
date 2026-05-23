import {
    clipboard,
    dialog,
    fs,
    isNativeRuntime,
    log,
    win,
    type ResizeEdge,
} from './api';
import {
    buildDataQualityReport,
    buildScenarioComparisonReport,
    calculateDataQuality,
    createUpfDocument,
    parseUpfText,
} from './planning-analytics';
import {
    buildScenarioEvaluationReport,
    evaluateScenario,
    type ScenarioEvaluation,
} from './planning-evaluation';
import {
    UNIT_SYSTEM,
    areaSqm,
    centroid,
    distance,
    distanceToPolyline,
    pointInPolygon,
    rect,
    type Point,
} from './planning-geometry';
import { runPlanningRules } from './planning-rules';

type Tool = 'select' | 'parcel' | 'facility' | 'entrance';
type LayerKey = 'parcels' | 'roads' | 'facilities' | 'entrances' | 'openSpaces' | 'constraints';
type Severity = 'error' | 'warning' | 'info' | 'ok';
type ObjectType = 'parcel' | 'road' | 'facility' | 'entrance' | 'openSpace' | 'constraint';

type Scenario = {
    id: string;
    name: string;
    description: string;
};

type ObjectBase = {
    id: string;
    type: ObjectType;
    name: string;
    evidence: string[];
};

type ParcelScenarioValue = {
    far: number;
    buildingCoverage: number;
    greenRatio: number;
    residentialGfaSqm: number;
    publicServiceGfaSqm: number;
    updateMode: '保留整治' | '综合整治' | '功能置换' | '拆除重建';
    notes: string;
};

type Parcel = ObjectBase & {
    type: 'parcel';
    points: Point[];
    landUseCode: string;
    landUseName: string;
    controls: {
        farMax: number;
        buildingCoverageMax: number;
        greenRatioMin: number;
        heightMaxM: number;
    };
    scenarioValues: Record<string, ParcelScenarioValue>;
};

type Road = ObjectBase & {
    type: 'road';
    points: Point[];
    level: '主干路' | '次干路' | '支路' | '慢行街巷';
    redLineWidthM: number;
    lanes: number;
};

type FacilityKind = '幼儿园' | '社区养老' | '社区卫生' | '文化活动' | '便民商业';

type Facility = ObjectBase & {
    type: 'facility';
    point: Point;
    kind: FacilityKind;
    capacity: number;
    serviceRadiusM: number;
    planned: boolean;
};

type Entrance = ObjectBase & {
    type: 'entrance';
    point: Point;
    entranceType: '机动车' | '人行' | '消防' | '货运';
    parcelId: string;
    roadId: string;
};

type OpenSpace = ObjectBase & {
    type: 'openSpace';
    points: Point[];
    kind: '社区公园' | '口袋公园' | '广场' | '慢行绿廊';
};

type ConstraintOverlay = ObjectBase & {
    type: 'constraint';
    points: Point[];
    kind: '历史风貌控制' | '蓝线' | '绿线' | '轨道保护' | '洪涝风险';
};

type PlanObject = Parcel | Road | Facility | Entrance | OpenSpace | ConstraintOverlay;

type CheckResult = {
    id: string;
    ruleId: string;
    objectId: string;
    objectName: string;
    severity: Severity;
    title: string;
    message: string;
    source: string;
};

type Recommendation = {
    id: string;
    objectId?: string;
    title: string;
    message: string;
    basis: string;
};

type UrbanPlanProject = {
    format: 'UPF';
    formatVersion: '0.1.0';
    project: {
        id: string;
        name: string;
        city: string;
        district: string;
        planningType: string;
        planningHorizon: string;
        crs: string;
    };
    ruleset: {
        jurisdiction: string;
        version: string;
        basis: string[];
    };
    scenarios: Scenario[];
    objects: PlanObject[];
};

const SQM_PER_RESIDENT = 33;
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_SCENARIO_VALUE: ParcelScenarioValue = {
    far: 1,
    buildingCoverage: 0.25,
    greenRatio: 0.30,
    residentialGfaSqm: 0,
    publicServiceGfaSqm: 0,
    updateMode: '综合整治',
    notes: '由导入兼容层补齐的默认方案值，请复核。',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg$ = <T extends SVGElement>(name: string) => document.createElementNS(SVG_NS, name) as T;

const ui = {
    titlebar: $('titlebar'),
    resizeLayer: $('resize-layer'),
    scenarioSelect: $('scenario-select') as HTMLSelectElement,
    scenarioNote: $('scenario-note'),
    projectSubtitle: $('project-subtitle'),
    projectSummary: $('project-summary'),
    layerList: $('layer-list'),
    objectList: $('object-list'),
    scenarioList: $('scenario-list'),
    toolGroup: $('tool-group'),
    canvas: document.getElementById('plan-canvas') as unknown as SVGSVGElement,
    canvasHint: $('canvas-hint'),
    canvasMeta: $('canvas-meta'),
    metricsStrip: $('metrics-strip'),
    checkList: $('check-list'),
    checkCount: $('check-count'),
    evaluationList: $('evaluation-list'),
    evaluationScore: $('evaluation-score'),
    recommendationList: $('recommendation-list'),
    suggestionCount: $('suggestion-count'),
    inspector: $('inspector'),
    statusLeft: $('status-left'),
    statusRight: $('status-right'),
    modal: $('modal'),
    modalTitle: $('modal-title'),
    modalText: $('modal-text'),
    modalMeta: $('modal-meta'),
    fileInput: $('file-input') as HTMLInputElement,
    btnRun: $('btn-run') as HTMLButtonElement,
    btnEvaluation: $('btn-evaluation') as HTMLButtonElement,
    btnCompare: $('btn-compare') as HTMLButtonElement,
    btnQuality: $('btn-quality') as HTMLButtonElement,
    btnReport: $('btn-report') as HTMLButtonElement,
    btnUpf: $('btn-upf') as HTMLButtonElement,
    btnSave: $('btn-save') as HTMLButtonElement,
    btnLoad: $('btn-load') as HTMLButtonElement,
    btnRestore: $('btn-restore') as HTMLButtonElement,
    btnReset: $('btn-reset') as HTMLButtonElement,
    btnDelete: $('btn-delete') as HTMLButtonElement,
    btnDuplicateScenario: $('btn-duplicate-scenario') as HTMLButtonElement,
    btnOptimize: $('btn-optimize') as HTMLButtonElement,
    modalClose: $('modal-close') as HTMLButtonElement,
    modalCopy: $('modal-copy') as HTMLButtonElement,
    modalSave: $('modal-save') as HTMLButtonElement,
};

let project = createDemoProject();
let activeScenarioId = 'scenario_update';
let selectedId = 'parcel_01';
let activeTool: Tool = 'select';
let checks: CheckResult[] = [];
let recommendations: Recommendation[] = [];
let evaluation: ScenarioEvaluation = evaluateScenario(project, activeScenarioId, checks, recommendations);
let modalContent = '';
let modalDefaultName = 'project.upf';
let currentFilePath = '';
let dirty = false;
let autosaveTimer: number | undefined;

const visibleLayers: Record<LayerKey, boolean> = {
    parcels: true,
    roads: true,
    facilities: true,
    entrances: true,
    openSpaces: true,
    constraints: true,
};

function createDemoProject(): UrbanPlanProject {
    return {
        format: 'UPF',
        formatVersion: '0.1.0',
        project: {
            id: 'upf_luohu_demo_001',
            name: '罗湖存量片区城市更新推演',
            city: '深圳市',
            district: '罗湖区',
            planningType: '城市更新片区 / 控规辅助审查',
            planningHorizon: '2026-2035',
            crs: 'EPSG:4490',
        },
        ruleset: {
            jurisdiction: 'CN-GD-SZ',
            version: '深圳 2025 修订汇总版 + UPF 原型规则',
            basis: [
                '国土空间调查、规划、用途管制用地用海分类指南',
                'GB 50180-2018 城市居住区规划设计标准',
                '完整居住社区建设指南',
                '深圳市城市规划标准与准则 2025 修订汇总版',
            ],
        },
        scenarios: [
            { id: 'scenario_baseline', name: '现状基准', description: '保留现状强度，识别公共服务和空间短板。' },
            { id: 'scenario_update', name: '更新增强', description: '提升开发强度，同时补齐社区设施和开放空间。' },
            { id: 'scenario_public', name: '公共服务优先', description: '压低局部强度，把更多空间留给养老、活动和慢行。' },
        ],
        objects: [
            {
                id: 'parcel_01',
                type: 'parcel',
                name: 'A-01 居住更新地块',
                evidence: ['地块边界：演示测绘数据', '控制指标：深圳规则库样例'],
                points: rect(120, 110, 260, 170),
                landUseCode: '0701',
                landUseName: '城镇住宅用地',
                controls: { farMax: 4.2, buildingCoverageMax: 0.35, greenRatioMin: 0.30, heightMaxM: 100 },
                scenarioValues: {
                    scenario_baseline: { far: 2.4, buildingCoverage: 0.38, greenRatio: 0.22, residentialGfaSqm: 42000, publicServiceGfaSqm: 260, updateMode: '综合整治', notes: '现状强度中等，绿地和公共活动空间不足。' },
                    scenario_update: { far: 4.6, buildingCoverage: 0.37, greenRatio: 0.26, residentialGfaSqm: 78000, publicServiceGfaSqm: 680, updateMode: '拆除重建', notes: '强度提升明显，需要同步校核交通和公共服务承载。' },
                    scenario_public: { far: 3.8, buildingCoverage: 0.31, greenRatio: 0.33, residentialGfaSqm: 61000, publicServiceGfaSqm: 1600, updateMode: '综合整治', notes: '控制开发强度，底层嵌入社区服务空间。' },
                },
            },
            {
                id: 'parcel_02',
                type: 'parcel',
                name: 'A-02 商住混合地块',
                evidence: ['现状建筑轮廓：公开底图模拟', 'POI：商业和办公活动密集'],
                points: rect(410, 120, 220, 165),
                landUseCode: '0901/0701',
                landUseName: '商业商务与居住混合用地',
                controls: { farMax: 5.0, buildingCoverageMax: 0.45, greenRatioMin: 0.25, heightMaxM: 150 },
                scenarioValues: {
                    scenario_baseline: { far: 3.1, buildingCoverage: 0.42, greenRatio: 0.18, residentialGfaSqm: 22000, publicServiceGfaSqm: 180, updateMode: '功能置换', notes: '底层商业活跃，但慢行界面较差。' },
                    scenario_update: { far: 5.2, buildingCoverage: 0.46, greenRatio: 0.21, residentialGfaSqm: 38000, publicServiceGfaSqm: 520, updateMode: '功能置换', notes: '混合功能增强，但指标接近控制上限。' },
                    scenario_public: { far: 4.6, buildingCoverage: 0.40, greenRatio: 0.27, residentialGfaSqm: 32000, publicServiceGfaSqm: 1100, updateMode: '功能置换', notes: '保留商业活力，增加社区共享空间。' },
                },
            },
            {
                id: 'parcel_03',
                type: 'parcel',
                name: 'B-01 老旧厂房地块',
                evidence: ['夜间灯光：活跃度偏低', '产业空间：低效利用样例'],
                points: rect(155, 335, 245, 150),
                landUseCode: '1001',
                landUseName: '工业用地',
                controls: { farMax: 3.5, buildingCoverageMax: 0.50, greenRatioMin: 0.20, heightMaxM: 80 },
                scenarioValues: {
                    scenario_baseline: { far: 1.2, buildingCoverage: 0.47, greenRatio: 0.12, residentialGfaSqm: 0, publicServiceGfaSqm: 0, updateMode: '保留整治', notes: '低效工业空间，公共界面封闭。' },
                    scenario_update: { far: 3.4, buildingCoverage: 0.42, greenRatio: 0.22, residentialGfaSqm: 16000, publicServiceGfaSqm: 900, updateMode: '功能置换', notes: '转为混合创新和社区服务，需关注就业承载。' },
                    scenario_public: { far: 2.8, buildingCoverage: 0.36, greenRatio: 0.31, residentialGfaSqm: 12000, publicServiceGfaSqm: 1800, updateMode: '综合整治', notes: '保留部分厂房，植入文化活动与养老服务。' },
                },
            },
            {
                id: 'road_01',
                type: 'road',
                name: '东侧城市主干路',
                evidence: ['道路等级：现状路网样例'],
                points: [{ x: 740, y: 70 }, { x: 740, y: 560 }],
                level: '主干路',
                redLineWidthM: 40,
                lanes: 6,
            },
            {
                id: 'road_02',
                type: 'road',
                name: '片区生活性支路',
                evidence: ['道路红线：控规路网样例'],
                points: [{ x: 80, y: 315 }, { x: 860, y: 315 }],
                level: '支路',
                redLineWidthM: 18,
                lanes: 2,
            },
            {
                id: 'road_03',
                type: 'road',
                name: '慢行共享街巷',
                evidence: ['15 分钟生活圈：慢行补短板样例'],
                points: [{ x: 525, y: 90 }, { x: 525, y: 555 }],
                level: '慢行街巷',
                redLineWidthM: 12,
                lanes: 1,
            },
            {
                id: 'facility_01',
                type: 'facility',
                name: '现状社区卫生服务站',
                evidence: ['POI：社区卫生服务'],
                point: { x: 650, y: 226 },
                kind: '社区卫生',
                capacity: 6500,
                serviceRadiusM: 800,
                planned: false,
            },
            {
                id: 'facility_02',
                type: 'facility',
                name: '规划社区养老服务点',
                evidence: ['完整社区补短板推演'],
                point: { x: 438, y: 410 },
                kind: '社区养老',
                capacity: 120,
                serviceRadiusM: 500,
                planned: true,
            },
            {
                id: 'facility_03',
                type: 'facility',
                name: '规划幼儿园',
                evidence: ['居住人口推演'],
                point: { x: 276, y: 242 },
                kind: '幼儿园',
                capacity: 180,
                serviceRadiusM: 500,
                planned: true,
            },
            {
                id: 'entrance_01',
                type: 'entrance',
                name: 'A-01 机动车出入口',
                evidence: ['方案绘制'],
                point: { x: 382, y: 232 },
                entranceType: '机动车',
                parcelId: 'parcel_01',
                roadId: 'road_02',
            },
            {
                id: 'entrance_02',
                type: 'entrance',
                name: 'A-02 机动车出入口',
                evidence: ['方案绘制'],
                point: { x: 735, y: 205 },
                entranceType: '机动车',
                parcelId: 'parcel_02',
                roadId: 'road_01',
            },
            {
                id: 'open_01',
                type: 'openSpace',
                name: '中心口袋公园',
                evidence: ['公共开放空间优化样例'],
                points: rect(430, 330, 120, 95),
                kind: '口袋公园',
            },
            {
                id: 'constraint_01',
                type: 'constraint',
                name: '历史风貌协调区',
                evidence: ['保护控制线：演示数据'],
                points: rect(90, 80, 330, 250),
                kind: '历史风貌控制',
            },
        ],
    };
}

function setStatus(left: string, right = `${project.objects.length} objects`) {
    ui.statusLeft.textContent = dirty ? `${left} · 未保存` : left;
    ui.statusRight.textContent = right;
}

function markDirty(reason = '方案已修改') {
    dirty = true;
    scheduleAutosave();
    setStatus(reason);
}

function scheduleAutosave() {
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
        try {
            localStorage.setItem('urbanplan.autosave', buildUpf());
            localStorage.setItem('urbanplan.autosaveAt', new Date().toISOString());
        } catch {}
    }, 700);
}

function clearAutosave() {
    try {
        localStorage.removeItem('urbanplan.autosave');
        localStorage.removeItem('urbanplan.autosaveAt');
    } catch {}
}

function getObject(id: string): PlanObject | undefined {
    return project.objects.find(object => object.id === id);
}

function activeScenario(): Scenario {
    return project.scenarios.find(scenario => scenario.id === activeScenarioId)
        ?? project.scenarios[0]
        ?? { id: 'scenario_default', name: '默认方案', description: '兼容层生成的默认方案。' };
}

function getParcelScenario(parcel: Parcel): ParcelScenarioValue {
    const value = parcel.scenarioValues?.[activeScenarioId];
    if (value) return value;
    const first = Object.values(parcel.scenarioValues ?? {})[0] ?? DEFAULT_SCENARIO_VALUE;
    parcel.scenarioValues = parcel.scenarioValues ?? {};
    parcel.scenarioValues[activeScenarioId] = { ...DEFAULT_SCENARIO_VALUE, ...first };
    return parcel.scenarioValues[activeScenarioId];
}

function normalizeProject(input: UrbanPlanProject): UrbanPlanProject {
    const fallback = createDemoProject();
    const normalized: UrbanPlanProject = {
        format: input.format === 'UPF' ? input.format : 'UPF',
        formatVersion: input.formatVersion === '0.1.0' ? input.formatVersion : '0.1.0',
        project: { ...fallback.project, ...(input.project ?? {}) },
        ruleset: { ...fallback.ruleset, ...(input.ruleset ?? {}) },
        scenarios: Array.isArray(input.scenarios) && input.scenarios.length
            ? input.scenarios.filter(scenario => scenario?.id && scenario?.name)
            : fallback.scenarios,
        objects: Array.isArray(input.objects) ? input.objects : fallback.objects,
    };

    if (!normalized.scenarios.length) normalized.scenarios = fallback.scenarios;
    const scenarioIds = normalized.scenarios.map(scenario => scenario.id);
    const firstParcel = normalized.objects.find((object): object is Parcel => object.type === 'parcel');
    const firstRoad = normalized.objects.find((object): object is Road => object.type === 'road');

    normalized.objects = normalized.objects.flatMap((object): PlanObject[] => {
        if (!object || typeof object !== 'object' || !('type' in object)) return [];
        const base = object as PlanObject;
        base.id = base.id || `object_${Date.now().toString(36)}`;
        base.name = base.name || base.id;
        base.evidence = Array.isArray(base.evidence) ? base.evidence : ['导入数据缺少证据来源，已由兼容层标记'];
        if (base.type === 'parcel') {
            base.points = validPoints(base.points, rect(120, 120, 120, 90));
            base.controls = {
                farMax: finiteOr(base.controls?.farMax, 4),
                buildingCoverageMax: finiteOr(base.controls?.buildingCoverageMax, 0.35),
                greenRatioMin: finiteOr(base.controls?.greenRatioMin, 0.30),
                heightMaxM: finiteOr(base.controls?.heightMaxM, 80),
            };
            base.scenarioValues = base.scenarioValues ?? {};
            for (const scenarioId of scenarioIds) {
                base.scenarioValues[scenarioId] = {
                    ...DEFAULT_SCENARIO_VALUE,
                    ...(Object.values(base.scenarioValues)[0] ?? {}),
                    ...(base.scenarioValues[scenarioId] ?? {}),
                };
            }
            base.landUseCode = base.landUseCode || '0701';
            base.landUseName = base.landUseName || '城镇住宅用地';
            return [base];
        }
        if (base.type === 'road') {
            base.points = validPoints(base.points, [{ x: 80, y: 300 }, { x: 820, y: 300 }], 2);
            base.level = base.level || '支路';
            base.redLineWidthM = finiteOr(base.redLineWidthM, 18);
            base.lanes = Math.round(finiteOr(base.lanes, 2));
            return [base];
        }
        if (base.type === 'facility') {
            base.point = validPoint(base.point, { x: 420, y: 320 });
            base.kind = base.kind || '社区养老';
            base.capacity = finiteOr(base.capacity, 80);
            base.serviceRadiusM = finiteOr(base.serviceRadiusM, 500);
            base.planned = Boolean(base.planned);
            return [base];
        }
        if (base.type === 'entrance') {
            base.point = validPoint(base.point, { x: 420, y: 320 });
            base.entranceType = base.entranceType || '机动车';
            base.parcelId = base.parcelId || firstParcel?.id || '';
            base.roadId = base.roadId || firstRoad?.id || '';
            return [base];
        }
        if (base.type === 'openSpace') {
            base.points = validPoints(base.points, rect(420, 320, 80, 60));
            base.kind = base.kind || '口袋公园';
            return [base];
        }
        if (base.type === 'constraint') {
            base.points = validPoints(base.points, rect(100, 100, 160, 120));
            base.kind = base.kind || '历史风貌控制';
            return [base];
        }
        return [];
    });

    return normalized;
}

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validPoint(point: unknown, fallback: Point): Point {
    if (!point || typeof point !== 'object') return fallback;
    const candidate = point as Partial<Point>;
    return {
        x: finiteOr(candidate.x, fallback.x),
        y: finiteOr(candidate.y, fallback.y),
    };
}

function validPoints(points: unknown, fallback: Point[], min = 3): Point[] {
    if (!Array.isArray(points) || points.length < min) return fallback;
    return points.map((point, index) => validPoint(point, fallback[index % fallback.length]));
}

function distanceToRoad(point: Point, road: Road): number {
    return distanceToPolyline(point, road.points);
}

function formatNumber(value: number, digits = 0): string {
    return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatArea(value: number): string {
    if (value >= 10000) return `${formatNumber(value / 10000, 2)} 公顷`;
    return `${formatNumber(value)} 平方米`;
}

function formatCompactArea(value: number): string {
    if (value >= 10000) return `${formatNumber(value / 10000, 1)}万㎡`;
    return `${formatNumber(value)}㎡`;
}

function parcelResidents(parcel: Parcel): number {
    const value = getParcelScenario(parcel);
    return Math.round(value.residentialGfaSqm / SQM_PER_RESIDENT);
}

function totalResidents(): number {
    return project.objects
        .filter((object): object is Parcel => object.type === 'parcel')
        .reduce((sum, parcel) => sum + parcelResidents(parcel), 0);
}

function totalResidentialGfa(): number {
    return project.objects
        .filter((object): object is Parcel => object.type === 'parcel')
        .reduce((sum, parcel) => sum + getParcelScenario(parcel).residentialGfaSqm, 0);
}

function totalArea(): number {
    return project.objects
        .filter((object): object is Parcel => object.type === 'parcel')
        .reduce((sum, parcel) => sum + areaSqm(parcel.points), 0);
}

function checkClass(severity: Severity): string {
    if (severity === 'error') return 'error';
    if (severity === 'warning') return 'warn';
    if (severity === 'ok') return 'ok';
    return 'info';
}

function scoreClass(score: number): string {
    if (score >= 85) return 'ok';
    if (score >= 70) return 'info';
    if (score >= 55) return 'warn';
    return 'error';
}

function parcelScoreColor(score: number): string {
    if (score >= 85) return '#dbe9e5';
    if (score >= 70) return '#e4eef8';
    if (score >= 55) return '#f6d9a9';
    return '#f3c3bd';
}

function severityLabel(severity: Severity): string {
    if (severity === 'error') return '错误';
    if (severity === 'warning') return '警告';
    if (severity === 'ok') return '通过';
    return '提示';
}

function runRuleChecks(): void {
    const result = runPlanningRules(project, activeScenarioId);
    checks = result.checks as CheckResult[];
    recommendations = result.recommendations as Recommendation[];
    evaluation = evaluateScenario(project, activeScenarioId, checks, recommendations);
    setStatus('规则检查完成', `${evaluation.score}/100 · ${checks.filter(check => check.severity === 'error').length} 错误 · ${checks.filter(check => check.severity === 'warning').length} 警告`);
    return;
}

function renderAll() {
    runRuleChecks();
    renderScenarios();
    renderProjectSummary();
    renderLayers();
    renderObjectList();
    renderCanvas();
    renderMetrics();
    renderChecks();
    renderEvaluation();
    renderRecommendations();
    renderInspector();
}

function renderScenarios() {
    ui.scenarioSelect.replaceChildren();
    for (const scenario of project.scenarios) {
        const option = document.createElement('option');
        option.value = scenario.id;
        option.textContent = scenario.name;
        ui.scenarioSelect.append(option);
    }
    ui.scenarioSelect.value = activeScenarioId;
    ui.scenarioNote.textContent = activeScenario().description;

    ui.scenarioList.replaceChildren();
    for (const scenario of project.scenarios) {
        const button = document.createElement('button');
        button.className = `scenario-row${scenario.id === activeScenarioId ? ' selected' : ''}`;
        button.addEventListener('click', () => {
            activeScenarioId = scenario.id;
            renderAll();
        });
        button.append(rowText(scenario.name, scenario.description), pill(scenario.id === activeScenarioId ? '当前' : '方案', scenario.id === activeScenarioId ? 'ok' : ''));
        ui.scenarioList.append(button);
    }
}

function renderProjectSummary() {
    ui.projectSubtitle.textContent = `${project.project.city}${project.project.district} · ${project.format} ${project.formatVersion}`;
    ui.projectSummary.replaceChildren(
        summaryLine('项目', project.project.name),
        summaryLine('类型', project.project.planningType),
        summaryLine('规则', project.ruleset.version),
        summaryLine('对象', `${project.objects.length} 个`),
        summaryLine('坐标', project.project.crs),
        summaryLine('文件', currentFilePath || '未保存'),
        summaryLine('自动备份', autosaveLabel()),
    );
}

function autosaveLabel(): string {
    try {
        const value = localStorage.getItem('urbanplan.autosaveAt');
        return value ? new Date(value).toLocaleTimeString('zh-CN') : '无';
    } catch {
        return '不可用';
    }
}

function renderLayers() {
    const rows: Array<[LayerKey, string, string]> = [
        ['parcels', '地块', `${countType('parcel')} 个`],
        ['roads', '道路', `${countType('road')} 条`],
        ['facilities', '公共设施', `${countType('facility')} 个`],
        ['entrances', '出入口', `${countType('entrance')} 个`],
        ['openSpaces', '开放空间', `${countType('openSpace')} 个`],
        ['constraints', '控制线', `${countType('constraint')} 个`],
    ];
    ui.layerList.replaceChildren();
    for (const [key, label, meta] of rows) {
        const row = document.createElement('label');
        row.className = 'layer-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = visibleLayers[key];
        checkbox.addEventListener('change', () => {
            visibleLayers[key] = checkbox.checked;
            renderCanvas();
        });
        row.append(checkbox, rowText(label, meta), pill(visibleLayers[key] ? '开' : '关', visibleLayers[key] ? 'ok' : ''));
        ui.layerList.append(row);
    }
}

function renderObjectList() {
    ui.objectList.replaceChildren();
    for (const object of project.objects) {
        const row = document.createElement('button');
        row.className = `object-row${object.id === selectedId ? ' selected' : ''}`;
        row.addEventListener('click', () => selectObject(object.id));
        row.append(typeDot(object), rowText(object.name, objectMeta(object)), issuePill(object.id));
        ui.objectList.append(row);
    }
}

function renderCanvas() {
    syncToolButtons();
    ui.canvas.classList.toggle('selecting', activeTool === 'select');
    ui.canvas.replaceChildren();

    if (visibleLayers.constraints) {
        forEachObject('constraint', object => renderPolygon(object, 'control-shape', '#6d5aa8'));
    }
    if (visibleLayers.openSpaces) {
        forEachObject('openSpace', object => renderPolygon(object, 'open-space-shape', '#77b881'));
    }
    if (visibleLayers.parcels) {
        forEachObject('parcel', object => renderParcel(object));
    }
    if (visibleLayers.roads) {
        forEachObject('road', object => renderRoad(object));
    }
    if (visibleLayers.facilities) {
        forEachObject('facility', object => renderFacility(object));
    }
    if (visibleLayers.entrances) {
        forEachObject('entrance', object => renderEntrance(object));
    }
    renderLabels();
    ui.canvasHint.textContent = activeTool === 'select'
        ? '选择对象查看规则、指标和证据链；地块颜色按综合评分热力显示。'
        : `在画布上点击即可新增${activeTool === 'parcel' ? '地块' : activeTool === 'facility' ? '设施' : '出入口'}对象。`;
    ui.canvasMeta.textContent = `${project.project.crs} · 1 unit≈${UNIT_SYSTEM.metersPerCanvasUnit}m · ${activeScenario().name} · ${activeTool}`;
}

function syncToolButtons() {
    ui.toolGroup.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
        button.classList.toggle('active', button.dataset.tool === activeTool);
    });
}

function renderParcel(parcel: Parcel) {
    const value = getParcelScenario(parcel);
    const parcelEvaluation = evaluation.parcels.find(item => item.objectId === parcel.id);
    const color = parcelEvaluation
        ? parcelScoreColor(parcelEvaluation.score)
        : value.greenRatio < parcel.controls.greenRatioMin
        ? '#f3c3bd'
        : value.far > parcel.controls.farMax
            ? '#f6d9a9'
            : '#dbe9e5';
    renderPolygon(parcel, 'parcel-shape', color);
}

function renderPolygon(object: Parcel | OpenSpace | ConstraintOverlay, className: string, fill: string) {
    const polygon = svg$<SVGPolygonElement>('polygon');
    polygon.setAttribute('points', object.points.map(point => `${point.x},${point.y}`).join(' '));
    polygon.setAttribute('class', `${className}${object.id === selectedId ? ' selected' : ''}`);
    polygon.setAttribute('fill', fill);
    polygon.addEventListener('click', event => {
        event.stopPropagation();
        selectObject(object.id);
    });
    ui.canvas.append(polygon);
}

function renderRoad(road: Road) {
    const path = svg$<SVGPolylineElement>('polyline');
    path.setAttribute('points', road.points.map(point => `${point.x},${point.y}`).join(' '));
    path.setAttribute('class', `road-shape${road.id === selectedId ? ' selected' : ''}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', String(Math.max(7, road.redLineWidthM * 0.42)));
    path.addEventListener('click', event => {
        event.stopPropagation();
        selectObject(road.id);
    });
    ui.canvas.append(path);
}

function renderFacility(facility: Facility) {
    const circle = svg$<SVGCircleElement>('circle');
    circle.setAttribute('cx', String(facility.point.x));
    circle.setAttribute('cy', String(facility.point.y));
    circle.setAttribute('r', facility.kind === '幼儿园' ? '13' : '11');
    circle.setAttribute('class', `facility-shape${facility.id === selectedId ? ' selected' : ''}`);
    circle.setAttribute('fill', facility.planned ? '#2563a8' : '#2f8f5b');
    circle.addEventListener('click', event => {
        event.stopPropagation();
        selectObject(facility.id);
    });
    ui.canvas.append(circle);
}

function renderEntrance(entrance: Entrance) {
    const polygon = svg$<SVGPolygonElement>('polygon');
    const p = entrance.point;
    polygon.setAttribute('points', `${p.x},${p.y - 11} ${p.x + 11},${p.y} ${p.x},${p.y + 11} ${p.x - 11},${p.y}`);
    polygon.setAttribute('class', `entrance-shape${entrance.id === selectedId ? ' selected' : ''}`);
    polygon.setAttribute('fill', entrance.entranceType === '机动车' ? '#b7791f' : '#0f766e');
    polygon.addEventListener('click', event => {
        event.stopPropagation();
        selectObject(entrance.id);
    });
    ui.canvas.append(polygon);
}

function renderLabels() {
    for (const object of project.objects) {
        if (object.type === 'parcel' && visibleLayers.parcels) {
            const center = centroid(object.points);
            addText(center.x, center.y, object.name.split(' ')[0], 'map-label');
        }
        if (object.type === 'road' && visibleLayers.roads) {
            const mid = polylineMidpoint(object.points);
            addText(mid.x, mid.y, object.level, 'road-label');
        }
        if (object.type === 'facility' && visibleLayers.facilities) {
            addText(object.point.x, object.point.y + 28, object.kind, 'map-label');
        }
    }
}

function polylineMidpoint(points: Point[]): Point {
    if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
    const segmentLengths = points.slice(0, -1).map((point, index) => Math.hypot(points[index + 1].x - point.x, points[index + 1].y - point.y));
    const half = segmentLengths.reduce((sum, value) => sum + value, 0) / 2;
    let walked = 0;
    for (let i = 0; i < segmentLengths.length; i++) {
        const length = segmentLengths[i];
        if (walked + length >= half) {
            const ratio = length ? (half - walked) / length : 0;
            return {
                x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
                y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
            };
        }
        walked += length;
    }
    return points[points.length - 1];
}

function addText(x: number, y: number, text: string, className: string) {
    const label = svg$<SVGTextElement>('text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(y));
    label.setAttribute('class', className);
    label.textContent = text;
    ui.canvas.append(label);
}

function renderMetrics() {
    const errors = checks.filter(check => check.severity === 'error').length;
    const warnings = checks.filter(check => check.severity === 'warning').length;
    ui.metricsStrip.replaceChildren(
        metric('综合评分', `${evaluation.score}/100`),
        metric('规划面积', formatArea(totalArea())),
        metric('住宅建面', formatCompactArea(totalResidentialGfa())),
        metric('估算人口', `${formatNumber(totalResidents())}人`),
        metric('规则风险', `${errors}错/${warnings}警`),
        metric('可信度', `${evaluation.confidence}/100`),
    );
}

function renderChecks() {
    ui.checkCount.textContent = String(checks.length);
    ui.checkCount.className = `pill ${checks.some(check => check.severity === 'error') ? 'error' : checks.some(check => check.severity === 'warning') ? 'warn' : 'ok'}`;
    ui.checkList.replaceChildren();
    for (const check of checks) {
        const row = document.createElement('button');
        row.className = 'check-row';
        row.addEventListener('click', () => {
            if (check.objectId !== 'project') selectObject(check.objectId);
        });
        row.append(pill(severityLabel(check.severity), checkClass(check.severity)), rowText(check.title, `${check.objectName} · ${check.message}`));
        ui.checkList.append(row);
    }
}

function renderEvaluation() {
    ui.evaluationScore.textContent = `${evaluation.score}`;
    ui.evaluationScore.className = `pill ${scoreClass(evaluation.score)}`;
    ui.evaluationList.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'evaluation-row';
    summary.append(
        pill(evaluation.band, scoreClass(evaluation.score)),
        rowText('方案综合评分', `${evaluation.score}/100 · 证据可信度 ${evaluation.confidence}/100`),
    );
    ui.evaluationList.append(summary);
    for (const dimension of evaluation.dimensions) {
        const row = document.createElement('button');
        row.className = 'evaluation-row';
        row.addEventListener('click', () => showModal('方案综合评估', buildScenarioEvaluationReport(project, activeScenarioId, checks, recommendations), activeScenario().name, 'scenario-evaluation.md'));
        const main = document.createElement('span');
        main.className = 'evaluation-main';
        const title = document.createElement('strong');
        title.textContent = `${dimension.name} · ${dimension.score}/100`;
        const reason = document.createElement('span');
        reason.textContent = dimension.reason;
        const bar = document.createElement('span');
        bar.className = 'dimension-bar';
        const fill = document.createElement('i');
        fill.style.width = `${dimension.score}%`;
        fill.style.background = dimension.score >= 85 ? 'var(--green)' : dimension.score >= 70 ? 'var(--teal)' : dimension.score >= 55 ? 'var(--amber)' : 'var(--red)';
        bar.append(fill);
        main.append(title, reason, bar);
        row.append(pill(`${(dimension.weight * 100).toFixed(0)}%`, 'info'), main);
        ui.evaluationList.append(row);
    }
}

function renderRecommendations() {
    ui.suggestionCount.textContent = String(recommendations.length);
    ui.recommendationList.replaceChildren();
    for (const recommendation of recommendations) {
        const row = document.createElement('button');
        row.className = 'recommendation-row';
        row.addEventListener('click', () => {
            if (recommendation.objectId) selectObject(recommendation.objectId);
        });
        row.append(pill('建议', 'info'), rowText(recommendation.title, `${recommendation.message} · ${recommendation.basis}`));
        ui.recommendationList.append(row);
    }
}

function renderInspector() {
    ui.inspector.replaceChildren();
    const object = getObject(selectedId);
    ui.btnDelete.disabled = !object || object.type === 'road' || object.type === 'constraint';
    if (!object) {
        ui.inspector.append(emptyInspector());
        return;
    }

    const identity = document.createElement('div');
    identity.className = 'identity';
    const title = document.createElement('strong');
    title.textContent = object.name;
    const sub = document.createElement('span');
    sub.textContent = `${object.type} · ${object.id}`;
    identity.append(title, sub);
    ui.inspector.append(identity);

    const nameField = textField('名称', object.name, value => {
        object.name = value;
        renderAll();
    });
    ui.inspector.append(fieldGrid([nameField], true));

    if (object.type === 'parcel') renderParcelInspector(object);
    if (object.type === 'road') renderRoadInspector(object);
    if (object.type === 'facility') renderFacilityInspector(object);
    if (object.type === 'entrance') renderEntranceInspector(object);
    if (object.type === 'openSpace') renderReadonlyInspector(object, [['类型', object.kind], ['面积', formatArea(areaSqm(object.points))]]);
    if (object.type === 'constraint') renderReadonlyInspector(object, [['控制线类型', object.kind], ['覆盖面积', formatArea(areaSqm(object.points))]]);

    ui.inspector.append(fieldGrid([
        textAreaField('证据来源（每行一条）', object.evidence.join('\n'), next => {
            object.evidence = parseEvidenceList(next);
            renderAll();
        }),
    ], true));

    const objectChecks = checks.filter(check => check.objectId === object.id);
    const parcelEvaluation = evaluation.parcels.find(item => item.objectId === object.id);
    ui.inspector.append(kvList([
        ['规则问题', objectChecks.length ? `${objectChecks.length} 条` : '暂无'],
        ['综合评分', parcelEvaluation ? `${parcelEvaluation.score}/100 · ${parcelEvaluation.band}` : '未纳入地块评分'],
        ['证据条数', `${object.evidence.length} 条`],
    ]));
}

function parseEvidenceList(text: string): string[] {
    return text
        .split(/\r?\n|；|;/)
        .map(item => item.trim())
        .filter(Boolean);
}

function renderParcelInspector(parcel: Parcel) {
    const value = getParcelScenario(parcel);
    ui.inspector.append(fieldGrid([
        textField('用地代码', parcel.landUseCode, next => { parcel.landUseCode = next; renderAll(); }),
        textField('用地名称', parcel.landUseName, next => { parcel.landUseName = next; renderAll(); }),
    ]));
    ui.inspector.append(fieldGrid([
        numberField('容积率', value.far, 0.1, next => { value.far = next; renderAll(); }),
        numberField('控制 FAR', parcel.controls.farMax, 0.1, next => { parcel.controls.farMax = next; renderAll(); }),
        percentField('建筑密度', value.buildingCoverage, next => { value.buildingCoverage = next; renderAll(); }),
        percentField('绿地率', value.greenRatio, next => { value.greenRatio = next; renderAll(); }),
        numberField('住宅建面', value.residentialGfaSqm, 1000, next => { value.residentialGfaSqm = next; renderAll(); }),
        numberField('公服建面', value.publicServiceGfaSqm, 100, next => { value.publicServiceGfaSqm = next; renderAll(); }),
    ]));
    ui.inspector.append(fieldGrid([
        selectField('更新方式', value.updateMode, ['保留整治', '综合整治', '功能置换', '拆除重建'], next => { value.updateMode = next as ParcelScenarioValue['updateMode']; renderAll(); }),
        numberField('限高 m', parcel.controls.heightMaxM, 5, next => { parcel.controls.heightMaxM = next; renderAll(); }),
    ]));
    ui.inspector.append(fieldGrid([
        textAreaField('方案备注', value.notes, next => { value.notes = next; renderAll(); }),
    ], true));
    ui.inspector.append(kvList([
        ['地块面积', formatArea(areaSqm(parcel.points))],
        ['估算人口', `${formatNumber(parcelResidents(parcel))} 人`],
        ['建筑密度控制', `${(parcel.controls.buildingCoverageMax * 100).toFixed(1)}%`],
        ['绿地率控制', `${(parcel.controls.greenRatioMin * 100).toFixed(1)}%`],
    ]));
}

function renderRoadInspector(road: Road) {
    ui.inspector.append(fieldGrid([
        selectField('道路等级', road.level, ['主干路', '次干路', '支路', '慢行街巷'], next => { road.level = next as Road['level']; renderAll(); }),
        numberField('红线宽度 m', road.redLineWidthM, 1, next => { road.redLineWidthM = next; renderAll(); }),
        numberField('车道数', road.lanes, 1, next => { road.lanes = Math.max(0, Math.round(next)); renderAll(); }),
    ]));
    renderReadonlyInspector(road, [['线位点数', `${road.points.length}`], ['说明', '道路对象可参与出入口、断面和慢行连续性检查。']]);
}

function renderFacilityInspector(facility: Facility) {
    ui.inspector.append(fieldGrid([
        selectField('设施类型', facility.kind, ['幼儿园', '社区养老', '社区卫生', '文化活动', '便民商业'], next => { facility.kind = next as FacilityKind; renderAll(); }),
        numberField('服务能力', facility.capacity, 10, next => { facility.capacity = Math.max(0, Math.round(next)); renderAll(); }),
        numberField('服务半径 m', facility.serviceRadiusM, 50, next => { facility.serviceRadiusM = Math.max(0, Math.round(next)); renderAll(); }),
        selectField('状态', facility.planned ? '规划' : '现状', ['现状', '规划'], next => { facility.planned = next === '规划'; renderAll(); }),
    ]));
    renderReadonlyInspector(facility, [['坐标', `${facility.point.x.toFixed(0)}, ${facility.point.y.toFixed(0)}`]]);
}

function renderEntranceInspector(entrance: Entrance) {
    const parcelOptions = project.objects.filter((object): object is Parcel => object.type === 'parcel').map(parcel => parcel.id);
    const roadOptions = project.objects.filter((object): object is Road => object.type === 'road').map(road => road.id);
    ui.inspector.append(fieldGrid([
        selectField('出入口类型', entrance.entranceType, ['机动车', '人行', '消防', '货运'], next => { entrance.entranceType = next as Entrance['entranceType']; renderAll(); }),
        selectField('服务地块', entrance.parcelId, parcelOptions, next => { entrance.parcelId = next; renderAll(); }),
        selectField('关联道路', entrance.roadId, roadOptions, next => { entrance.roadId = next; renderAll(); }),
    ]));
    const road = getObject(entrance.roadId);
    renderReadonlyInspector(entrance, [
        ['坐标', `${entrance.point.x.toFixed(0)}, ${entrance.point.y.toFixed(0)}`],
        ['道路距离', road && road.type === 'road' ? `${formatNumber(distanceToRoad(entrance.point, road))} m` : '未绑定'],
    ]);
}

function renderReadonlyInspector(_object: PlanObject, rows: Array<[string, string]>) {
    ui.inspector.append(kvList(rows));
}

function emptyInspector() {
    const box = document.createElement('div');
    box.className = 'identity';
    const title = document.createElement('strong');
    title.textContent = '未选择对象';
    const text = document.createElement('span');
    text.textContent = '在画布或对象列表中选择一个规划对象。';
    box.append(title, text);
    return box;
}

function selectObject(id: string) {
    selectedId = id;
    renderObjectList();
    renderCanvas();
    renderInspector();
}

function countType(type: ObjectType): number {
    return project.objects.filter(object => object.type === type).length;
}

function forEachObject<T extends PlanObject['type']>(type: T, callback: (object: Extract<PlanObject, { type: T }>) => void) {
    for (const object of project.objects) {
        if (object.type === type) callback(object as Extract<PlanObject, { type: T }>);
    }
}

function rowText(titleText: string, metaText: string): HTMLElement {
    const wrap = document.createElement('span');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    title.className = 'row-title';
    meta.className = 'row-meta';
    title.textContent = titleText;
    meta.textContent = metaText;
    wrap.append(title, meta);
    return wrap;
}

function summaryLine(label: string, value: string): HTMLElement {
    const line = document.createElement('div');
    line.className = 'summary-line';
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    span.textContent = label;
    strong.textContent = value;
    line.append(span, strong);
    return line;
}

function pill(text: string, kind: string): HTMLElement {
    const span = document.createElement('span');
    span.className = `pill ${kind}`.trim();
    span.textContent = text;
    return span;
}

function metric(label: string, value: string): HTMLElement {
    const box = document.createElement('div');
    box.className = 'metric';
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    span.textContent = label;
    strong.textContent = value;
    box.append(span, strong);
    return box;
}

function typeDot(object: PlanObject): HTMLElement {
    const colors: Record<ObjectType, string> = {
        parcel: '#0f766e',
        road: '#6d7680',
        facility: '#2563a8',
        entrance: '#b7791f',
        openSpace: '#2f8f5b',
        constraint: '#6d5aa8',
    };
    const dot = document.createElement('span');
    dot.className = 'pill';
    dot.style.width = '22px';
    dot.style.minWidth = '22px';
    dot.style.padding = '0';
    dot.style.background = colors[object.type];
    dot.style.borderColor = colors[object.type];
    dot.textContent = '';
    return dot;
}

function issuePill(objectId: string): HTMLElement {
    const related = checks.filter(check => check.objectId === objectId);
    if (!related.length) return pill('OK', 'ok');
    if (related.some(check => check.severity === 'error')) return pill(String(related.length), 'error');
    if (related.some(check => check.severity === 'warning')) return pill(String(related.length), 'warn');
    return pill(String(related.length), 'info');
}

function objectMeta(object: PlanObject): string {
    if (object.type === 'parcel') {
        const value = getParcelScenario(object);
        return `${object.landUseName} · FAR ${value.far.toFixed(1)} · ${formatNumber(parcelResidents(object))} 人`;
    }
    if (object.type === 'road') return `${object.level} · ${object.redLineWidthM}m · ${object.lanes} 车道`;
    if (object.type === 'facility') return `${object.kind} · ${object.capacity} · ${object.planned ? '规划' : '现状'}`;
    if (object.type === 'entrance') return `${object.entranceType} · ${object.parcelId}`;
    if (object.type === 'openSpace') return `${object.kind} · ${formatArea(areaSqm(object.points))}`;
    return `${object.kind} · ${formatArea(areaSqm(object.points))}`;
}

function fieldGrid(children: HTMLElement[], one = false): HTMLElement {
    const grid = document.createElement('div');
    grid.className = `field-grid${one ? ' one' : ''}`;
    grid.append(...children);
    return grid;
}

function textField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
    const input = document.createElement('input');
    input.value = value;
    input.addEventListener('change', () => {
        markDirty();
        onChange(input.value.trim());
    });
    return field(label, input);
}

function textAreaField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
    const input = document.createElement('textarea');
    input.value = value;
    input.addEventListener('change', () => {
        markDirty();
        onChange(input.value.trim());
    });
    return field(label, input);
}

function numberField(label: string, value: number, step: number, onChange: (value: number) => void): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('change', () => {
        markDirty();
        onChange(Number(input.value) || 0);
    });
    return field(label, input);
}

function percentField(label: string, value: number, onChange: (value: number) => void): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.value = String(Math.round(value * 100));
    input.addEventListener('change', () => {
        markDirty();
        onChange((Number(input.value) || 0) / 100);
    });
    return field(`${label} %`, input);
}

function selectField(label: string, value: string, options: string[], onChange: (value: string) => void): HTMLElement {
    const select = document.createElement('select');
    for (const optionValue of options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        select.append(option);
    }
    select.value = value;
    select.addEventListener('change', () => {
        markDirty();
        onChange(select.value);
    });
    return field(label, select);
}

function field(labelText: string, control: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.append(label, control);
    return wrap;
}

function kvList(rows: Array<[string, string]>): HTMLElement {
    const list = document.createElement('div');
    list.className = 'kv-list';
    for (const [labelText, value] of rows) {
        list.append(summaryLine(labelText, value));
    }
    return list;
}

function canvasPoint(event: MouseEvent): Point {
    const point = ui.canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = ui.canvas.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
}

function addObjectAt(point: Point) {
    if (activeTool === 'parcel') {
        const id = `parcel_${Date.now().toString(36)}`;
        const newScenarioValues: Record<string, ParcelScenarioValue> = {};
        for (const scenario of project.scenarios) {
            newScenarioValues[scenario.id] = {
                far: 2.5,
                buildingCoverage: 0.32,
                greenRatio: 0.30,
                residentialGfaSqm: 18000,
                publicServiceGfaSqm: 300,
                updateMode: '综合整治',
                notes: '新建语义地块，可继续编辑指标。',
            };
        }
        project.objects.push({
            id,
            type: 'parcel',
            name: `新建地块 ${countType('parcel') + 1}`,
            evidence: ['用户在语义规划画布中新建'],
            points: rect(point.x - 60, point.y - 45, 120, 90),
            landUseCode: '0701',
            landUseName: '城镇住宅用地',
            controls: { farMax: 4.0, buildingCoverageMax: 0.35, greenRatioMin: 0.30, heightMaxM: 80 },
            scenarioValues: newScenarioValues,
        });
        selectedId = id;
    }
    if (activeTool === 'facility') {
        const id = `facility_${Date.now().toString(36)}`;
        project.objects.push({
            id,
            type: 'facility',
            name: `新建公共设施 ${countType('facility') + 1}`,
            evidence: ['用户在语义规划画布中新建'],
            point,
            kind: '社区养老',
            capacity: 80,
            serviceRadiusM: 500,
            planned: true,
        });
        selectedId = id;
    }
    if (activeTool === 'entrance') {
        const id = `entrance_${Date.now().toString(36)}`;
        const parcel = containingParcel(point) ?? nearestParcel(point);
        const road = nearestRoad(point);
        project.objects.push({
            id,
            type: 'entrance',
            name: `新建出入口 ${countType('entrance') + 1}`,
            evidence: ['用户在语义规划画布中新建'],
            point,
            entranceType: '机动车',
            parcelId: parcel?.id ?? '',
            roadId: road?.id ?? '',
        });
        selectedId = id;
    }
    activeTool = 'select';
    markDirty('已新增规划对象');
    renderAll();
}

function nearestRoad(point: Point): Road | undefined {
    const roads = project.objects.filter((object): object is Road => object.type === 'road');
    return roads.sort((a, b) => distanceToRoad(point, a) - distanceToRoad(point, b))[0];
}

function containingParcel(point: Point): Parcel | undefined {
    return project.objects.find((object): object is Parcel => object.type === 'parcel' && pointInPolygon(point, object.points));
}

function nearestParcel(point: Point): Parcel | undefined {
    const parcels = project.objects.filter((object): object is Parcel => object.type === 'parcel');
    return parcels.sort((a, b) => distance(point, centroid(a.points)) - distance(point, centroid(b.points)))[0];
}

function duplicateScenario() {
    const source = activeScenario();
    const id = `scenario_${Date.now().toString(36)}`;
    project.scenarios.push({
        id,
        name: `${source.name} 副本`,
        description: `从 ${source.name} 复制，可继续调整地块指标。`,
    });
    for (const object of project.objects) {
        if (object.type === 'parcel') {
            object.scenarioValues[id] = { ...getParcelScenario(object) };
        }
    }
    activeScenarioId = id;
    markDirty('已复制方案');
    renderAll();
}

function applyConservativeOptimization() {
    for (const object of project.objects) {
        if (object.type !== 'parcel') continue;
        const value = getParcelScenario(object);
        value.far = Math.min(value.far, object.controls.farMax);
        value.buildingCoverage = Math.min(value.buildingCoverage, object.controls.buildingCoverageMax);
        value.greenRatio = Math.max(value.greenRatio, object.controls.greenRatioMin);
        if (parcelResidents(object) > 1000) {
            value.publicServiceGfaSqm = Math.max(value.publicServiceGfaSqm, areaSqm(object.points) * 0.018);
        }
        if (value.updateMode === '拆除重建') value.updateMode = '综合整治';
    }
    setStatus('已应用保守优化', '指标已回调');
    markDirty('已应用保守优化');
    renderAll();
}

function deleteSelected() {
    const object = getObject(selectedId);
    if (!object || object.type === 'road' || object.type === 'constraint') return;
    const references = project.objects.filter(item => item.type === 'entrance'
        && (item.parcelId === object.id || item.roadId === object.id));
    if (references.length) {
        showModal(
            '无法删除对象',
            [
                `${object.name} 仍被以下出入口引用。`,
                '',
                ...references.map(reference => `- ${reference.name} (${reference.id})`),
                '',
                '专业数据模型不允许静默产生悬挂引用。请先删除或改绑这些出入口。',
            ].join('\n'),
            '引用完整性保护',
        );
        return;
    }
    project.objects = project.objects.filter(item => item.id !== selectedId);
    selectedId = project.objects.find(item => item.type === 'parcel')?.id ?? project.objects[0]?.id ?? '';
    markDirty('已删除对象');
    renderAll();
}

function buildUpf(): string {
    return JSON.stringify(createUpfDocument(project, activeScenarioId, checks, recommendations, evaluation), null, 2);
}

function buildReport(): string {
    const errors = checks.filter(check => check.severity === 'error');
    const warnings = checks.filter(check => check.severity === 'warning');
    const lines = [
        `# ${project.project.name} 规划诊断报告`,
        '',
        `生成时间：${new Date().toLocaleString('zh-CN')}`,
        `当前方案：${activeScenario().name}`,
        `规则版本：${project.ruleset.version}`,
        '',
        '## 一、核心指标',
        '',
        `- 综合评分：${evaluation.score}/100（${evaluation.band}）`,
        `- 证据可信度：${evaluation.confidence}/100`,
        `- 规划地块面积：${formatArea(totalArea())}`,
        `- 住宅建筑面积：${formatNumber(totalResidentialGfa())} 平方米`,
        `- 估算居住人口：${formatNumber(totalResidents())} 人`,
        `- 规则问题：${errors.length} 个错误，${warnings.length} 个警告，${checks.length} 条总提示`,
        '',
        '## 二、综合评估',
        '',
        '| 维度 | 权重 | 得分 | 解释 |',
        '|---|---:|---:|---|',
        ...evaluation.dimensions.map(dimension => `| ${dimension.name} | ${(dimension.weight * 100).toFixed(0)}% | ${dimension.score} | ${dimension.reason} |`),
        '',
        '## 三、地块优先级',
        '',
        '| 地块 | 得分 | 状态 | 主要原因 |',
        '|---|---:|---|---|',
        ...evaluation.parcels.map(parcel => `| ${parcel.name} | ${parcel.score} | ${parcel.band} | ${parcel.drivers.join('；')} |`),
        '',
        '## 四、主要问题',
        '',
        ...checks.map(check => `- [${severityLabel(check.severity)}] ${check.objectName}：${check.title}。${check.message} 来源：${check.source}`),
        '',
        '## 五、智能建议',
        '',
        ...recommendations.map(recommendation => `- ${recommendation.title}：${recommendation.message} 依据：${recommendation.basis}`),
        '',
        '## 六、答辩说明',
        '',
        ...evaluation.highlights.map(item => `- ${item}`),
        '',
        '## 七、说明',
        '',
        '本报告来自 UPF 0.1 原型规则引擎，是规划辅助判断，不替代法定审查、专项交通影响评价、消防审查或正式控规成果。',
    ];
    return lines.join('\n');
}

function buildDecisionMatrixReport(): string {
    const rows = project.scenarios.map((scenario) => {
        const ruleResult = runPlanningRules(project, scenario.id);
        const scenarioEvaluation = evaluateScenario(project, scenario.id, ruleResult.checks, ruleResult.recommendations);
        const errors = ruleResult.checks.filter(check => check.severity === 'error').length;
        const warnings = ruleResult.checks.filter(check => check.severity === 'warning').length;
        return {
            scenario,
            evaluation: scenarioEvaluation,
            residents: scenarioResidents(scenario.id),
            residentialGfa: scenarioResidentialGfa(scenario.id),
            publicServiceGfa: scenarioPublicServiceGfa(scenario.id),
            errors,
            warnings,
        };
    });
    const best = [...rows].sort((a, b) => b.evaluation.score - a.evaluation.score)[0];
    const lines = [
        `# ${project.project.name} 方案决策矩阵`,
        '',
        `推荐方案：${best?.scenario.name ?? '暂无'}${best ? `（${best.evaluation.score}/100，${best.evaluation.band}）` : ''}`,
        `生成时间：${new Date().toLocaleString('zh-CN')}`,
        '',
        '## 一、综合对比',
        '',
        '| 方案 | 综合评分 | 可信度 | 估算人口 | 住宅建面 | 公服建面 | 规则错误 | 规则警告 | 判断 |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---|',
        ...rows.map(row => `| ${row.scenario.name} | ${row.evaluation.score} | ${row.evaluation.confidence} | ${formatNumber(row.residents)} | ${formatNumber(row.residentialGfa)} | ${formatNumber(row.publicServiceGfa)} | ${row.errors} | ${row.warnings} | ${row.evaluation.band} |`),
        '',
        '## 二、推荐理由',
        '',
        ...(best?.evaluation.highlights.map(item => `- ${item}`) ?? ['- 当前缺少可评价方案。']),
        '',
        '## 三、风险对照',
        '',
        ...rows.flatMap(row => [
            `### ${row.scenario.name}`,
            ...(row.evaluation.riskRegister.length ? row.evaluation.riskRegister.map(item => `- ${item}`) : ['- 基础规则未识别主要风险。']),
            '',
        ]),
        '## 四、原始指标表',
        '',
        buildScenarioComparisonReport(project, activeScenarioId),
    ];
    return lines.join('\n');
}

function scenarioResidentialGfa(scenarioId: string): number {
    return project.objects
        .filter((object): object is Parcel => object.type === 'parcel')
        .reduce((sum, parcel) => sum + parcelScenario(parcel, scenarioId).residentialGfaSqm, 0);
}

function scenarioPublicServiceGfa(scenarioId: string): number {
    return project.objects
        .filter((object): object is Parcel => object.type === 'parcel')
        .reduce((sum, parcel) => sum + parcelScenario(parcel, scenarioId).publicServiceGfaSqm, 0);
}

function scenarioResidents(scenarioId: string): number {
    return Math.round(scenarioResidentialGfa(scenarioId) / SQM_PER_RESIDENT);
}

function parcelScenario(parcel: Parcel, scenarioId: string): ParcelScenarioValue {
    return parcel.scenarioValues[scenarioId] ?? Object.values(parcel.scenarioValues)[0] ?? DEFAULT_SCENARIO_VALUE;
}

function showModal(title: string, text: string, meta = 'UrbanPlan Studio', defaultName = 'urbanplan-output.txt') {
    modalContent = text;
    modalDefaultName = defaultName;
    ui.modalTitle.textContent = title;
    ui.modalText.textContent = text;
    ui.modalMeta.textContent = meta;
    ui.modal.classList.add('open');
}

async function saveText(defaultName: string, content: string) {
    if (isNativeRuntime) {
        try {
            const target = await dialog.saveFile({
                defaultName,
                filters: [
                    { name: 'UPF / 文本', extensions: ['upf', 'json', 'md', 'txt'] },
                    { name: '所有文件', extensions: ['*'] },
                ],
            });
            if (target) {
                await fs.writeTextFile(target, content);
                if (defaultName.endsWith('.upf')) {
                    currentFilePath = target;
                    dirty = false;
                    clearAutosave();
                }
                setStatus(`已保存 ${target}`);
            }
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showModal('导入失败', message, 'UPF 导入校验');
            setStatus(message);
        }
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    URL.revokeObjectURL(url);
    if (defaultName.endsWith('.upf')) {
        dirty = false;
        clearAutosave();
    }
}

async function loadUpf() {
    if (isNativeRuntime) {
        try {
            const target = await dialog.openFile({
                filters: [
                    { name: 'UPF / JSON', extensions: ['upf', 'json'] },
                    { name: '所有文件', extensions: ['*'] },
                ],
            });
            if (typeof target === 'string') {
                loadUpfText(await fs.readTextFile(target));
                currentFilePath = target;
                dirty = false;
                clearAutosave();
                setStatus(`已载入 ${target}`);
            }
            return;
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
        }
    }
    ui.fileInput.click();
}

function loadUpfText(text: string) {
    const parsed = parseUpfText(text, project);
    project = normalizeProject(parsed.project as UrbanPlanProject);
    activeScenarioId = project.scenarios.some(scenario => scenario.id === parsed.activeScenarioId)
        ? parsed.activeScenarioId
        : project.scenarios[0]?.id ?? '';
    selectedId = project.objects[0]?.id ?? '';
    renderAll();
}

async function copyModal() {
    try {
        if (isNativeRuntime) await clipboard.writeText(modalContent);
        else await navigator.clipboard.writeText(modalContent);
        setStatus('已复制到剪贴板');
    } catch {
        setStatus('复制失败');
    }
}

function bindControls() {
    ui.scenarioSelect.addEventListener('change', () => {
        activeScenarioId = ui.scenarioSelect.value;
        renderAll();
    });
    ui.toolGroup.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
        button.addEventListener('click', () => {
            activeTool = button.dataset.tool as Tool;
            renderCanvas();
        });
    });
    ui.canvas.addEventListener('click', event => {
        if (activeTool === 'select') return;
        addObjectAt(canvasPoint(event));
    });
    ui.btnRun.addEventListener('click', renderAll);
    ui.btnEvaluation.addEventListener('click', () => showModal('方案综合评估', buildScenarioEvaluationReport(project, activeScenarioId, checks, recommendations), activeScenario().name, 'scenario-evaluation.md'));
    ui.btnCompare.addEventListener('click', () => showModal('方案决策矩阵', buildDecisionMatrixReport(), project.project.name, 'scenario-decision-matrix.md'));
    ui.btnQuality.addEventListener('click', () => showModal('数据质量诊断', buildDataQualityReport(project, checks, recommendations), project.ruleset.version, 'data-quality-report.md'));
    ui.btnReport.addEventListener('click', () => showModal('规划诊断报告', buildReport(), activeScenario().name, 'planning-report.md'));
    ui.btnUpf.addEventListener('click', () => showModal('UPF 数据', buildUpf(), `${project.format} ${project.formatVersion}`, `${project.project.id}.upf`));
    ui.btnSave.addEventListener('click', () => void saveText(`${project.project.id}.upf`, buildUpf()));
    ui.btnLoad.addEventListener('click', () => void loadUpf());
    ui.btnRestore.addEventListener('click', restoreAutosave);
    ui.btnReset.addEventListener('click', () => {
        project = createDemoProject();
        activeScenarioId = 'scenario_update';
        selectedId = 'parcel_01';
        activeTool = 'select';
        currentFilePath = '';
        dirty = false;
        renderAll();
    });
    ui.btnDelete.addEventListener('click', deleteSelected);
    ui.btnDuplicateScenario.addEventListener('click', duplicateScenario);
    ui.btnOptimize.addEventListener('click', applyConservativeOptimization);
    ui.modalClose.addEventListener('click', () => ui.modal.classList.remove('open'));
    ui.modal.addEventListener('click', event => {
        if (event.target === ui.modal) ui.modal.classList.remove('open');
    });
    ui.modalCopy.addEventListener('click', () => void copyModal());
    ui.modalSave.addEventListener('click', () => void saveText(modalDefaultName, modalContent));
    ui.fileInput.addEventListener('change', () => {
        const file = ui.fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            try {
                loadUpfText(String(reader.result ?? ''));
                currentFilePath = file.name;
                dirty = false;
                clearAutosave();
                setStatus(`已载入 ${file.name}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                showModal('导入失败', `${message}\n\n文件：${file.name}`, 'UPF 导入校验');
                setStatus(message);
            }
        });
        reader.readAsText(file);
        ui.fileInput.value = '';
    });
    window.addEventListener('keydown', (event) => {
        if (ui.modal.classList.contains('open')) {
            if (event.key === 'Escape') ui.modal.classList.remove('open');
            return;
        }
        if (event.key === 'Escape') {
            activeTool = 'select';
            renderCanvas();
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
            deleteSelected();
        }
    });
}

function restoreAutosave() {
    try {
        const text = localStorage.getItem('urbanplan.autosave');
        if (!text) {
            showModal('没有自动备份', '当前浏览器/桌面环境没有找到可恢复的自动备份。', '自动备份');
            return;
        }
        loadUpfText(text);
        currentFilePath = '自动备份';
        dirty = true;
        setStatus('已恢复自动备份');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showModal('恢复失败', message, '自动备份');
    }
}

function setupDiagnostics() {
    window.addEventListener('beforeunload', (event) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
    });
    window.addEventListener('error', (event) => {
        const message = event.error instanceof Error ? event.error.stack ?? event.error.message : event.message;
        if (isNativeRuntime) void log.error(message).catch(() => {});
        showModal('运行错误', message, '前端诊断');
        setStatus('发生运行错误');
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
        if (isNativeRuntime) void log.error(reason).catch(() => {});
        showModal('异步错误', reason, '前端诊断');
        setStatus('发生异步错误');
    });
}

async function setupWindowChrome() {
    if (!isNativeRuntime) return;
    try {
        await win.setTitle('UrbanPlan Studio');
        await win.setBackgroundColor('#f6f7f9');
        const frameless = await win.isFrameless();
        if (!frameless) return;

        ui.titlebar.classList.add('active');
        ui.titlebar.addEventListener('mousedown', (event) => {
            if ((event.target as HTMLElement).closest('.titlebar-controls')) return;
            win.startDrag();
        });

        $('tb-min').addEventListener('click', () => win.minimize());
        $('tb-max').addEventListener('click', async () => {
            if (await win.isMaximized()) await win.restore();
            else await win.maximize();
        });
        $('tb-close').addEventListener('click', () => win.close());

        ui.resizeLayer.classList.add('active');
        ui.resizeLayer.querySelectorAll<HTMLElement>('[data-resize-edge]').forEach((zone) => {
            zone.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                const edge = zone.dataset.resizeEdge as ResizeEdge | undefined;
                if (!edge) return;
                event.preventDefault();
                event.stopPropagation();
                win.startResize(edge);
            });
        });
    } catch {}
}

function boot() {
    setupDiagnostics();
    bindControls();
    void setupWindowChrome();
    renderAll();
}

boot();

