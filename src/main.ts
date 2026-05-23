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
    evidenceSearchText,
    formatEvidenceForEditing,
    isStructuredEvidence,
    normalizeEvidenceList,
    parseEvidenceText,
    type EvidenceItem,
    type EvidenceSource,
    type EvidenceSourceType,
} from './evidence';
import { SERVICE_DEMAND_ASSUMPTIONS } from './planning-assumptions';
import {
    buildDataQualityReport,
    buildScenarioComparisonReport,
    calculateDataQuality,
    createUpfDocument,
    parseUpfText,
} from './planning-analytics';
import {
    buildScenarioEvaluationReport,
    EVALUATION_WEIGHT_PROFILES,
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
import { buildRuleCatalogReport, RULE_CATALOG, runPlanningRules } from './planning-rules';
import { buildUpfValidationReport, validateUpfDocument, type UpfValidationIssue } from './upf-validation';

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
    evidence: EvidenceItem[];
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

type ImportFinding = {
    severity: 'warning' | 'info';
    objectId: string;
    message: string;
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

const SQM_PER_RESIDENT = SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident;
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
    objectSearch: $('object-search') as HTMLInputElement,
    objectFilter: $('object-filter') as HTMLSelectElement,
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
    btnSensitivity: $('btn-sensitivity') as HTMLButtonElement,
    btnCompare: $('btn-compare') as HTMLButtonElement,
    btnCsv: $('btn-csv') as HTMLButtonElement,
    btnQuality: $('btn-quality') as HTMLButtonElement,
    btnValidation: $('btn-validation') as HTMLButtonElement,
    btnReport: $('btn-report') as HTMLButtonElement,
    btnUpf: $('btn-upf') as HTMLButtonElement,
    btnGeojson: $('btn-geojson') as HTMLButtonElement,
    btnSave: $('btn-save') as HTMLButtonElement,
    btnLoad: $('btn-load') as HTMLButtonElement,
    btnRestore: $('btn-restore') as HTMLButtonElement,
    btnReset: $('btn-reset') as HTMLButtonElement,
    btnDelete: $('btn-delete') as HTMLButtonElement,
    btnDuplicateScenario: $('btn-duplicate-scenario') as HTMLButtonElement,
    optimizePreset: $('optimize-preset') as HTMLSelectElement,
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
let importFindings: ImportFinding[] = [];
let dirty = false;
let autosaveTimer: number | undefined;
let objectSearchText = '';
let objectFilter = 'all';

const visibleLayers: Record<LayerKey, boolean> = {
    parcels: true,
    roads: true,
    facilities: true,
    entrances: true,
    openSpaces: true,
    constraints: true,
};

function evidenceSource(
    title: string,
    type: EvidenceSourceType,
    collectedAt: string,
    precision = '教学案例级',
    confidence = 0.72,
    license = '课程演示',
    note = '',
): EvidenceSource {
    return { title, type, collectedAt, precision, confidence, license, ...(note ? { note } : {}) };
}

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
            crs: 'DemoCanvasMetric',
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
                evidence: [
                    evidenceSource('地块边界：演示测绘数据', 'basemap', '2026-05-01', '地块级示意', 0.74),
                    evidenceSource('控制指标：深圳规则库样例', 'planning', '2026-05-01', '教学规则集', 0.70),
                ],
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
                evidence: [
                    evidenceSource('现状建筑轮廓：公开底图模拟', 'basemap', '2026-05-01', '地块级示意', 0.68),
                    evidenceSource('POI：商业和办公活动密集', 'poi', '2026-05-01', '片区级示意', 0.66),
                ],
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
                evidence: [
                    evidenceSource('夜间灯光：活跃度偏低', 'remote_sensing', '2026-05-01', '片区级示意', 0.62),
                    evidenceSource('产业空间：低效利用样例', 'survey', '2026-05-01', '教学案例级', 0.70),
                ],
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
                evidence: [evidenceSource('道路等级：现状路网样例', 'traffic', '2026-05-01', '道路级示意', 0.72)],
                points: [{ x: 740, y: 70 }, { x: 740, y: 560 }],
                level: '主干路',
                redLineWidthM: 40,
                lanes: 6,
            },
            {
                id: 'road_02',
                type: 'road',
                name: '片区生活性支路',
                evidence: [evidenceSource('道路红线：控规路网样例', 'planning', '2026-05-01', '道路级示意', 0.70)],
                points: [{ x: 80, y: 315 }, { x: 860, y: 315 }],
                level: '支路',
                redLineWidthM: 18,
                lanes: 2,
            },
            {
                id: 'road_03',
                type: 'road',
                name: '慢行共享街巷',
                evidence: [evidenceSource('15 分钟生活圈：慢行补短板样例', 'community', '2026-05-01', '片区级示意', 0.69)],
                points: [{ x: 525, y: 90 }, { x: 525, y: 555 }],
                level: '慢行街巷',
                redLineWidthM: 12,
                lanes: 1,
            },
            {
                id: 'facility_01',
                type: 'facility',
                name: '现状社区卫生服务站',
                evidence: [evidenceSource('POI：社区卫生服务', 'poi', '2026-05-01', '设施点位示意', 0.67)],
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
                evidence: [evidenceSource('完整社区补短板推演', 'planning', '2026-05-01', '方案推演级', 0.71)],
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
                evidence: [evidenceSource('居住人口推演', 'planning', '2026-05-01', '方案推演级', 0.70)],
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
                evidence: [evidenceSource('方案绘制', 'user_input', '2026-05-01', '示意线位', 0.58)],
                point: { x: 382, y: 232 },
                entranceType: '机动车',
                parcelId: 'parcel_01',
                roadId: 'road_02',
            },
            {
                id: 'entrance_02',
                type: 'entrance',
                name: 'A-02 机动车出入口',
                evidence: [evidenceSource('方案绘制', 'user_input', '2026-05-01', '示意线位', 0.58)],
                point: { x: 735, y: 205 },
                entranceType: '机动车',
                parcelId: 'parcel_02',
                roadId: 'road_01',
            },
            {
                id: 'open_01',
                type: 'openSpace',
                name: '中心口袋公园',
                evidence: [evidenceSource('公共开放空间优化样例', 'planning', '2026-05-01', '方案推演级', 0.70)],
                points: rect(430, 330, 120, 95),
                kind: '口袋公园',
            },
            {
                id: 'constraint_01',
                type: 'constraint',
                name: '历史风貌协调区',
                evidence: [evidenceSource('保护控制线：演示数据', 'planning', '2026-05-01', '片区级示意', 0.68)],
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
        base.evidence = normalizeEvidenceList(base.evidence, [
            evidenceSource('导入数据缺少证据来源，已由兼容层标记', 'user_input', '导入时', '待复核', 0.25, '用户导入'),
        ]);
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

function auditImportedProject(input: UrbanPlanProject): ImportFinding[] {
    const findings: ImportFinding[] = [];
    const scenarios = Array.isArray(input.scenarios) ? input.scenarios.filter(scenario => scenario?.id) : [];
    const scenarioIds = scenarios.map(scenario => scenario.id);
    if (input.format !== 'UPF') {
        findings.push({ severity: 'warning', objectId: 'project', message: '文件未声明 UPF 格式，已按兼容模式导入。' });
    }
    if (input.formatVersion !== '0.1.0') {
        findings.push({ severity: 'info', objectId: 'project', message: `格式版本为 ${input.formatVersion || '未声明'}，已按 UPF 0.1.0 兼容。` });
    }
    if (!scenarios.length) {
        findings.push({ severity: 'warning', objectId: 'project', message: '未找到有效方案列表，系统会使用演示方案结构补齐。' });
    }
    if (!Array.isArray(input.objects) || !input.objects.length) {
        findings.push({ severity: 'warning', objectId: 'project', message: '未找到有效规划对象，导入后可能退回演示对象或空项目。' });
    }
    const parcelIds = new Set((input.objects ?? []).filter(object => object?.type === 'parcel').map(object => object.id).filter(Boolean));
    const roadIds = new Set((input.objects ?? []).filter(object => object?.type === 'road').map(object => object.id).filter(Boolean));
    for (const raw of input.objects ?? []) {
        const object = raw as Partial<PlanObject>;
        const objectId = object.id || 'unknown_object';
        if (!object.id) findings.push({ severity: 'warning', objectId, message: '对象缺少 id，兼容层会生成临时 id。' });
        if (!object.name) findings.push({ severity: 'info', objectId, message: '对象缺少名称，兼容层会使用 id 代替。' });
        if (!object.evidence?.length) findings.push({ severity: 'warning', objectId, message: '对象缺少证据来源，会降低数据质量和可信度。' });
        else if (!object.evidence.some(isStructuredEvidence)) findings.push({ severity: 'info', objectId, message: '对象证据仍是旧版字符串，建议升级为结构化 EvidenceSource。' });
        if (object.type === 'parcel') {
            const parcel = object as Partial<Parcel>;
            if (!Array.isArray(parcel.points) || parcel.points.length < 3) findings.push({ severity: 'warning', objectId, message: '地块几何点不足，兼容层会补默认矩形。' });
            if (!parcel.controls) findings.push({ severity: 'warning', objectId, message: '地块缺少控制指标，兼容层会补默认 FAR/密度/绿地率。' });
            for (const scenarioId of scenarioIds) {
                if (!parcel.scenarioValues?.[scenarioId]) findings.push({ severity: 'info', objectId, message: `地块缺少 ${scenarioId} 的方案值，兼容层会复制或补默认值。` });
            }
        } else if (object.type === 'road') {
            const road = object as Partial<Road>;
            if (!Array.isArray(road.points) || road.points.length < 2) findings.push({ severity: 'warning', objectId, message: '道路线位点不足，兼容层会补默认线段。' });
        } else if (object.type === 'facility') {
            const facility = object as Partial<Facility>;
            if (!facility.point) findings.push({ severity: 'warning', objectId, message: '公共设施缺少点位，兼容层会补默认坐标。' });
        } else if (object.type === 'entrance') {
            const entrance = object as Partial<Entrance>;
            if (!entrance.parcelId || !entrance.roadId) findings.push({ severity: 'warning', objectId, message: '出入口缺少地块或道路引用，需要导入后复核。' });
            if (entrance.parcelId && !parcelIds.has(entrance.parcelId)) findings.push({ severity: 'warning', objectId, message: `出入口引用不存在的地块 ${entrance.parcelId}，需要重新绑定。` });
            if (entrance.roadId && !roadIds.has(entrance.roadId)) findings.push({ severity: 'warning', objectId, message: `出入口引用不存在的道路 ${entrance.roadId}，需要重新绑定。` });
        } else if (!['openSpace', 'constraint'].includes(String(object.type))) {
            findings.push({ severity: 'warning', objectId, message: `未知对象类型 ${String(object.type)}，兼容层会过滤。` });
        }
    }
    return findings.slice(0, 80);
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

function asPercent(value: number): string {
    return `${(value * 100).toFixed(0)}%`;
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
        const scenarioScore = evaluateScenarioForSummary(scenario.id);
        const button = document.createElement('button');
        button.className = `scenario-row${scenario.id === activeScenarioId ? ' selected' : ''}`;
        button.addEventListener('click', () => {
            activeScenarioId = scenario.id;
            renderAll();
        });
        button.append(
            rowText(scenario.name, `${scenario.description} · ${scenarioScore.score}/100 · ${scenarioScore.band}`),
            pill(scenario.id === activeScenarioId ? '当前' : `${scenarioScore.score}`, scenario.id === activeScenarioId ? scoreClass(scenarioScore.score) : scoreClass(scenarioScore.score)),
        );
        ui.scenarioList.append(button);
    }
}

function evaluateScenarioForSummary(scenarioId: string): ScenarioEvaluation {
    if (scenarioId === activeScenarioId) return evaluation;
    const result = runPlanningRules(project, scenarioId);
    return evaluateScenario(project, scenarioId, result.checks, result.recommendations);
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
        summaryLine('导入审计', importFindings.length ? `${importFindings.length} 项` : '无'),
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
    ui.objectSearch.value = objectSearchText;
    ui.objectFilter.value = objectFilter;
    ui.objectList.replaceChildren();
    const objects = visibleObjectList();
    if (!objects.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = '没有匹配对象。';
        ui.objectList.append(empty);
        return;
    }
    for (const object of objects) {
        const row = document.createElement('button');
        row.className = `object-row${object.id === selectedId ? ' selected' : ''}`;
        row.addEventListener('click', () => selectObject(object.id));
        row.append(typeDot(object), rowText(object.name, objectMeta(object)), issuePill(object.id));
        ui.objectList.append(row);
    }
}

function visibleObjectList(): PlanObject[] {
    return project.objects.filter(objectMatchesListFilter);
}

function objectMatchesListFilter(object: PlanObject): boolean {
    const keyword = objectSearchText.trim().toLowerCase();
    if (keyword) {
        const haystack = [
            object.id,
            object.name,
            object.type,
            evidenceSearchText(object.evidence),
            objectMeta(object),
        ].join(' ').toLowerCase();
        if (!haystack.includes(keyword)) return false;
    }
    if (objectFilter === 'issues') return checks.some(check => check.objectId === object.id);
    if (objectFilter === 'high-risk') {
        const hasSeriousCheck = checks.some(check => check.objectId === object.id && (check.severity === 'error' || check.severity === 'warning'));
        const parcelEvaluation = evaluation.parcels.find(item => item.objectId === object.id);
        return hasSeriousCheck || Boolean(parcelEvaluation && parcelEvaluation.score < 70);
    }
    if (objectFilter === 'parcel') return object.type === 'parcel';
    if (objectFilter === 'facility') return object.type === 'facility';
    return true;
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
        ? selectedObjectHint()
        : `在画布上点击即可新增${activeTool === 'parcel' ? '地块' : activeTool === 'facility' ? '设施' : '出入口'}对象。`;
    ui.canvasMeta.textContent = `${project.project.crs} · 1 unit≈${UNIT_SYSTEM.metersPerCanvasUnit}m · ${activeScenario().name} · ${activeTool}`;
}

function selectedObjectHint(): string {
    const object = getObject(selectedId);
    if (object?.type === 'facility') {
        return `${object.kind} 服务半径 ${formatNumber(object.serviceRadiusM)}m 已显示；可用于解释公共服务覆盖。`;
    }
    return '选择对象查看规则、指标和证据链；地块颜色按综合评分热力显示。';
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
    if (facility.id === selectedId) renderFacilityCoverage(facility);
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

function renderFacilityCoverage(facility: Facility) {
    const radius = Math.max(24, facility.serviceRadiusM / UNIT_SYSTEM.metersPerCanvasUnit);
    const coverage = svg$<SVGCircleElement>('circle');
    coverage.setAttribute('cx', String(facility.point.x));
    coverage.setAttribute('cy', String(facility.point.y));
    coverage.setAttribute('r', String(radius));
    coverage.setAttribute('class', 'service-radius-shape');
    coverage.addEventListener('click', event => {
        event.stopPropagation();
        selectObject(facility.id);
    });
    ui.canvas.append(coverage);
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
        textAreaField('证据来源（每行一条）', formatEvidenceForEditing(object.evidence), next => {
            object.evidence = parseEvidenceText(next);
            renderAll();
        }),
    ], true));

    const objectChecks = checks.filter(check => check.objectId === object.id);
    const parcelEvaluation = evaluation.parcels.find(item => item.objectId === object.id);
    ui.inspector.append(kvList([
        ['规则问题', objectChecks.length ? `${objectChecks.length} 条` : '暂无'],
        ['综合评分', parcelEvaluation ? `${parcelEvaluation.score}/100 · ${parcelEvaluation.band}` : '未纳入地块评分'],
        ['证据条数', `${object.evidence.length} 条`],
        ['结构化证据', `${object.evidence.filter(isStructuredEvidence).length} 条`],
    ]));
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
    ui.objectList.querySelector('.object-row.selected')?.scrollIntoView({ block: 'nearest' });
    renderCanvas();
    renderInspector();
}

function selectAdjacentObject(delta: number) {
    const visible = visibleObjectList();
    if (!visible.length) return;
    const currentIndex = Math.max(0, visible.findIndex(object => object.id === selectedId));
    const nextIndex = Math.min(visible.length - 1, Math.max(0, currentIndex + delta));
    selectObject(visible[nextIndex].id);
    setStatus(`已选择 ${visible[nextIndex].name}`, `${nextIndex + 1}/${visible.length}`);
}

function selectEdgeObject(edge: 'first' | 'last') {
    const visible = visibleObjectList();
    if (!visible.length) return;
    const nextIndex = edge === 'first' ? 0 : visible.length - 1;
    selectObject(visible[nextIndex].id);
    setStatus(`已选择 ${visible[nextIndex].name}`, `${nextIndex + 1}/${visible.length}`);
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
            evidence: [evidenceSource('用户在语义规划画布中新建', 'user_input', '当前会话', '用户绘制', 0.50, '用户输入')],
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
            evidence: [evidenceSource('用户在语义规划画布中新建', 'user_input', '当前会话', '用户绘制', 0.50, '用户输入')],
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
            evidence: [evidenceSource('用户在语义规划画布中新建', 'user_input', '当前会话', '用户绘制', 0.50, '用户输入')],
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

function applyScenarioOptimization() {
    const preset = ui.optimizePreset.value as 'compliance' | 'public' | 'ecology';
    for (const object of project.objects) {
        if (object.type !== 'parcel') continue;
        const value = getParcelScenario(object);
        value.far = Math.min(value.far, object.controls.farMax);
        value.buildingCoverage = Math.min(value.buildingCoverage, object.controls.buildingCoverageMax);
        value.greenRatio = Math.max(value.greenRatio, object.controls.greenRatioMin);
        if (preset === 'public') {
            value.publicServiceGfaSqm = Math.max(
                value.publicServiceGfaSqm,
                value.residentialGfaSqm * 0.026,
                areaSqm(object.points) * 0.022,
            );
            value.notes = appendScenarioNote(value.notes, '公共服务优先：提高公服建筑面积，优先补齐完整社区设施。');
        }
        if (preset === 'ecology') {
            value.far = Math.min(value.far, Math.max(0.8, object.controls.farMax * 0.92));
            value.buildingCoverage = Math.min(value.buildingCoverage, Math.max(0.18, object.controls.buildingCoverageMax * 0.88));
            value.greenRatio = Math.max(value.greenRatio, object.controls.greenRatioMin + 0.05);
            value.notes = appendScenarioNote(value.notes, '生态保护优先：压低局部强度，提高绿地率和开放空间连续性。');
        }
        if (parcelResidents(object) > 1000) {
            value.publicServiceGfaSqm = Math.max(value.publicServiceGfaSqm, areaSqm(object.points) * 0.018);
        }
        if (value.updateMode === '拆除重建') value.updateMode = '综合整治';
    }
    const label = preset === 'public' ? '公共服务优先' : preset === 'ecology' ? '生态保护优先' : '合规回调';
    setStatus(`已应用${label}`, '方案指标已更新');
    markDirty(`已应用${label}`);
    renderAll();
}

function appendScenarioNote(note: string, addition: string): string {
    return note.includes(addition) ? note : `${note.trim()} ${addition}`.trim();
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

function buildGeoJson(): string {
    const features = project.objects.map(object => ({
        type: 'Feature',
        id: object.id,
        geometry: geoJsonGeometry(object),
        properties: geoJsonProperties(object),
    })).filter(feature => feature.geometry);
    return JSON.stringify({
        type: 'FeatureCollection',
        name: project.project.name,
        upf: {
            formatVersion: project.formatVersion,
            activeScenarioId,
            crs: project.project.crs,
            unitSystem: UNIT_SYSTEM,
            note: 'Coordinates are exported in the UPF project coordinate space; transform before mixing with GIS layers.',
        },
        features,
    }, null, 2);
}

function geoJsonGeometry(object: PlanObject) {
    if (object.type === 'parcel' || object.type === 'openSpace' || object.type === 'constraint') {
        return {
            type: 'Polygon',
            coordinates: [closedCoordinates(object.points)],
        };
    }
    if (object.type === 'road') {
        return {
            type: 'LineString',
            coordinates: object.points.map(point => [point.x, point.y]),
        };
    }
    if (object.type === 'facility' || object.type === 'entrance') {
        return {
            type: 'Point',
            coordinates: [object.point.x, object.point.y],
        };
    }
    return null;
}

function geoJsonProperties(object: PlanObject): Record<string, unknown> {
    const base: Record<string, unknown> = {
        upfId: object.id,
        upfType: object.type,
        name: object.name,
        evidenceCount: object.evidence.length,
    };
    if (object.type === 'parcel') {
        const value = getParcelScenario(object);
        return {
            ...base,
            landUseCode: object.landUseCode,
            landUseName: object.landUseName,
            areaSqm: Math.round(areaSqm(object.points)),
            far: value.far,
            buildingCoverage: value.buildingCoverage,
            greenRatio: value.greenRatio,
            residentialGfaSqm: value.residentialGfaSqm,
            publicServiceGfaSqm: value.publicServiceGfaSqm,
            updateMode: value.updateMode,
        };
    }
    if (object.type === 'road') return { ...base, level: object.level, redLineWidthM: object.redLineWidthM, lanes: object.lanes };
    if (object.type === 'facility') return { ...base, kind: object.kind, capacity: object.capacity, serviceRadiusM: object.serviceRadiusM, planned: object.planned };
    if (object.type === 'entrance') return { ...base, entranceType: object.entranceType, parcelId: object.parcelId, roadId: object.roadId };
    if (object.type === 'openSpace' || object.type === 'constraint') return { ...base, kind: object.kind, areaSqm: Math.round(areaSqm(object.points)) };
    return base;
}

function closedCoordinates(points: Point[]): number[][] {
    const coordinates = points.map(point => [point.x, point.y]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push([...first]);
    return coordinates;
}

function buildReport(): string {
    const errors = checks.filter(check => check.severity === 'error');
    const warnings = checks.filter(check => check.severity === 'warning');
    const quality = calculateDataQuality(project, checks, recommendations);
    const sensitivityRows = buildSensitivityRows();
    const robustWinner = robustSensitivityWinner(sensitivityRows);
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
        ...(checks.length
            ? checks.map(check => `- [${severityLabel(check.severity)}] ${check.objectName}：${check.title}。${check.message} 来源：${check.source}`)
            : ['- 暂无规则问题。']),
        '',
        '## 五、智能建议',
        '',
        ...(recommendations.length
            ? recommendations.map(recommendation => `- ${recommendation.title}：${recommendation.message} 依据：${recommendation.basis}`)
            : ['- 暂无自动建议。']),
        '',
        '## 六、风险登记',
        '',
        ...(evaluation.riskRegister.length ? evaluation.riskRegister.map(item => `- ${item}`) : ['- 暂无高优先级风险登记。']),
        '',
        '## 七、答辩说明',
        '',
        ...evaluation.highlights.map(item => `- ${item}`),
        '',
        '## 八、权重敏感性摘要',
        '',
        `- 稳健推荐：${robustWinner ? `${robustWinner[0]}（${robustWinner[1]}/${sensitivityRows.length} 个模型排名第一）` : '暂无'}`,
        '',
        '| 权重模型 | 第一名 | 当前方案得分 | 分差范围 |',
        '|---|---|---:|---:|',
        ...sensitivityRows.map(row => `| ${row.profile.name} | ${row.winner?.scenario.name ?? '暂无'} | ${row.active?.evaluation.score ?? '-'} | ${row.spread} |`),
        '',
        '## 九、数据质量摘要',
        '',
        `- 数据质量分：${quality.score}/100`,
        `- 证据覆盖率：${quality.evidenceCoverage.toFixed(1)}%`,
        `- 结构化证据覆盖率：${quality.structuredEvidenceCoverage.toFixed(1)}%`,
        `- 导入审计：${importFindings.length} 项`,
        `- 规则依据：${quality.basisCount} 条`,
        '',
        '## 十、方法与限制',
        '',
        '| 项目 | 说明 |',
        '|---|---|',
        `| UPF 版本 | ${project.formatVersion} |`,
        `| 单位系统 | ${UNIT_SYSTEM.name}，${UNIT_SYSTEM.metersPerCanvasUnit} 米/画布单位 |`,
        `| 评价模型 | ${evaluation.modelName} |`,
        `| 规则集 | ${project.ruleset.version} |`,
        '',
        '本报告来自 UPF 0.1 原型规则引擎，是规划辅助判断，不替代法定审查、专项交通影响评价、消防审查或正式控规成果。',
    ];
    return lines.join('\n');
}

function buildQualityReport(): string {
    const validationIssues = validateUpfDocument(project);
    const lines = [
        buildDataQualityReport(project, checks, recommendations),
        '',
        buildUpfValidationReport(validationIssues),
        '',
        buildRuleCatalogReport(checks),
    ];
    if (importFindings.length) {
        lines.push(
            '',
            '## 导入审计',
            '',
            '| 等级 | 对象 | 问题 |',
            '|---|---|---|',
            ...importFindings.map(finding => `| ${finding.severity === 'warning' ? '警告' : '提示'} | ${finding.objectId} | ${finding.message} |`),
        );
    } else {
        lines.push('', '## 导入审计', '', '- 当前项目没有记录到导入兼容修复项。');
    }
    return lines.join('\n');
}

function schemaIssuesToImportFindings(issues: UpfValidationIssue[]): ImportFinding[] {
    return issues
        .filter(issue => issue.severity !== 'info')
        .map(issue => ({
            severity: issue.severity === 'error' ? 'warning' : 'info',
            objectId: issue.path,
            message: `UPF 结构校验：${issue.message}`,
        }));
}

function collectScenarioDecisionRows() {
    return project.scenarios.map((scenario) => {
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
}

function buildCaseValidationReport(): string {
    const quality = calculateDataQuality(project, checks, recommendations);
    const decisionRows = collectScenarioDecisionRows();
    const sensitivityRows = buildSensitivityRows();
    const robustWinner = robustSensitivityWinner(sensitivityRows);
    const activeRow = decisionRows.find(row => row.scenario.id === activeScenarioId);
    const errors = checks.filter(check => check.severity === 'error');
    const warnings = checks.filter(check => check.severity === 'warning');
    const triggeredRuleIds = new Set(checks.map(check => check.ruleId));
    const prototypeRules = RULE_CATALOG.filter(rule => rule.prototype).length;
    const agreement = robustWinner ? robustWinner[1] / EVALUATION_WEIGHT_PROFILES.length : 0;
    const riskControlScore = Math.max(0, 100 - Math.min(45, errors.length * 12 + warnings.length * 4));
    const readiness = Math.round(
        quality.score * 0.30
        + evaluation.confidence * 0.25
        + agreement * 100 * 0.20
        + riskControlScore * 0.25,
    );
    const typeCounts = project.objects.reduce<Record<string, number>>((counts, object) => {
        counts[object.type] = (counts[object.type] ?? 0) + 1;
        return counts;
    }, {});
    const lines = [
        `# ${project.project.name} 城市更新案例验证包`,
        '',
        `生成时间：${new Date().toLocaleString('zh-CN')}`,
        `研究对象：${project.project.city}${project.project.district} · ${project.project.planningType}`,
        `当前方案：${activeScenario().name}`,
        `验证就绪度：${readiness}/100（${validationReadinessBand(readiness)}）`,
        '',
        '## 一、研究问题与证据链',
        '',
        '| 研究问题 | 系统证据 | 当前状态 |',
        '|---|---|---|',
        `| RQ1：UPF 语义模型能否表达城市更新方案对象 | ${project.objects.length} 个对象，${project.scenarios.length} 个情景方案 | ${quality.objectCount > 0 ? '可验证' : '需补数据'} |`,
        `| RQ2：规则校核能否形成可解释问题清单 | ${checks.length} 条规则结果，${quality.ruleCatalog.length} 类规则触发 | ${errors.length ? '存在硬性风险' : '未发现硬性错误'} |`,
        `| RQ3：多方案比较能否支撑方案选择 | ${decisionRows.length} 个方案进入决策矩阵 | ${decisionRows.length >= 2 ? '可比较' : '需增加对照方案'} |`,
        `| RQ4：评价结果对权重变化是否稳健 | ${robustWinner ? `${robustWinner[0]} 获得 ${robustWinner[1]}/${EVALUATION_WEIGHT_PROFILES.length} 个模型第一` : '暂无稳健推荐'} | ${agreement >= 0.5 ? '可讨论稳健性' : '需说明价值偏好影响'} |`,
        `| RQ5：数据来源是否足以支撑论文答辩 | 证据覆盖率 ${quality.evidenceCoverage.toFixed(1)}%，结构化覆盖率 ${quality.structuredEvidenceCoverage.toFixed(1)}%，质量分 ${quality.score}/100 | ${quality.score >= 80 ? '较充分' : '需补充来源'} |`,
        '',
        '## 二、数据与对象概况',
        '',
        '| 数据项 | 当前值 | 论文写法 |',
        '|---|---:|---|',
        `| 地块 | ${typeCounts.parcel ?? 0} | 作为控规和更新评价的基本空间单元 |`,
        `| 道路 | ${typeCounts.road ?? 0} | 用于入口、通达性和道路等级复核 |`,
        `| 公共服务设施 | ${typeCounts.facility ?? 0} | 用于服务半径和配套能力分析 |`,
        `| 出入口 | ${typeCounts.entrance ?? 0} | 用于交通组织和界面关系检查 |`,
        `| 开放空间 | ${typeCounts.openSpace ?? 0} | 用于绿地率、公共开放空间和慢行连续性判断 |`,
        `| 约束控制线 | ${typeCounts.constraint ?? 0} | 用于历史风貌、蓝绿线、轨道保护等约束识别 |`,
        '',
        '### 证据类型分布',
        '',
        ...(Object.entries(quality.evidenceTypeCounts).length
            ? Object.entries(quality.evidenceTypeCounts).map(([kind, count]) => `- ${kind}：${count}`)
            : ['- 暂无证据来源，请补齐对象 evidence 字段。']),
        '',
        '## 三、当前方案综合评估',
        '',
        `当前方案综合评分为 ${evaluation.score}/100（${evaluation.band}），证据可信度 ${evaluation.confidence}/100。`,
        activeRow ? `当前方案在多方案矩阵中的人口估算为 ${formatNumber(activeRow.residents)} 人，住宅建面 ${formatNumber(activeRow.residentialGfa)} 平方米，公服建面 ${formatNumber(activeRow.publicServiceGfa)} 平方米。` : '当前方案暂未进入决策矩阵。',
        '',
        '| 维度 | 权重 | 得分 | 解释 |',
        '|---|---:|---:|---|',
        ...evaluation.dimensions.map(dimension => `| ${dimension.name} | ${(dimension.weight * 100).toFixed(0)}% | ${dimension.score} | ${dimension.reason} |`),
        '',
        '## 四、多方案决策矩阵',
        '',
        '| 方案 | 综合评分 | 可信度 | 估算人口 | 住宅建面 | 公服建面 | 错误 | 警告 | 判断 |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---|',
        ...decisionRows.map(row => `| ${row.scenario.name} | ${row.evaluation.score} | ${row.evaluation.confidence} | ${formatNumber(row.residents)} | ${formatNumber(row.residentialGfa)} | ${formatNumber(row.publicServiceGfa)} | ${row.errors} | ${row.warnings} | ${row.evaluation.band} |`),
        '',
        '## 五、权重敏感性与稳健性',
        '',
        `稳健推荐：${robustWinner ? `${robustWinner[0]}（${robustWinner[1]}/${EVALUATION_WEIGHT_PROFILES.length} 个模型排名第一）` : '暂无'}`,
        '',
        '| 权重模型 | 侧重点 | 第一名 | 当前方案得分 | 分差范围 |',
        '|---|---|---|---:|---:|',
        ...sensitivityRows.map(row => `| ${row.profile.name} | ${row.profile.description} | ${row.winner?.scenario.name ?? '暂无'} | ${row.active?.evaluation.score ?? '-'} | ${row.spread} |`),
        '',
        '## 六、规则校核与风险闭环',
        '',
        `当前方案共 ${checks.length} 条规则结果，其中错误 ${errors.length} 条、警告 ${warnings.length} 条。`,
        '',
        '| 等级 | 对象 | 规则 | 问题 | 来源 |',
        '|---|---|---|---|---|',
        ...(checks.length
            ? checks.map(check => `| ${severityLabel(check.severity)} | ${check.objectName} | ${check.ruleId} | ${check.title}：${check.message} | ${check.source} |`)
            : ['| 通过 | 全局 | - | 当前没有规则问题 | - |']),
        '',
        '## 七、规则目录与验证口径',
        '',
        `当前规则目录共 ${RULE_CATALOG.length} 条，其中原型启发式规则 ${prototypeRules} 条；本方案触发 ${triggeredRuleIds.size} 类规则。`,
        '',
        '| 规则 ID | 领域 | 默认等级 | 来源层级 | 原型 | 本次触发 | 依据 |',
        '|---|---|---|---|---:|---:|---|',
        ...RULE_CATALOG.map(rule => `| ${rule.id} | ${rule.domain} | ${severityLabel(rule.defaultSeverity)} | ${rule.source.level} | ${rule.prototype ? '是' : '否'} | ${triggeredRuleIds.has(rule.id) ? '是' : '否'} | ${rule.source.title}；${rule.source.clause} |`),
        '',
        '## 八、论文实验记录表',
        '',
        '| 验证任务 | 操作对象 | 记录指标 | 结果填写 |',
        '|---|---|---|---|',
        '| T1 方案建模 | UPF 地块、道路、设施、出入口 | 是否能完整表达案例对象 | 待实测 |',
        '| T2 规则检查 | 当前方案 | 问题识别准确性、遗漏项 | 待专家复核 |',
        '| T3 方案比较 | 基准、更新、保护等方案 | 评分排序是否符合专业判断 | 待专家复核 |',
        '| T4 权重敏感性 | 四类权重模型 | 推荐结果是否稳定 | 待记录 |',
        '| T5 报告导出 | 诊断、质检、验证包 | 是否能直接支撑论文材料整理 | 待记录 |',
        '',
        '## 九、专家复核表',
        '',
        '| 复核项 | 1-5 分 | 主要意见 |',
        '|---|---:|---|',
        '| 指标体系合理性 |  |  |',
        '| 规则问题识别准确性 |  |  |',
        '| 情景比较解释性 |  |  |',
        '| 数据质量诊断价值 |  |  |',
        '| 作为毕业设计原型的完整性 |  |  |',
        '',
        '## 十、可复现材料清单',
        '',
        '- UPF 项目文件：保存按钮导出的 `.upf` 文件。',
        '- 规划诊断报告：报告按钮导出的 `planning-report.md`。',
        '- 方案综合评估：评估按钮导出的 `scenario-evaluation.md`。',
        '- 方案决策矩阵：对比按钮导出的 `scenario-decision-matrix.md`。',
        '- 权重敏感性分析：敏感按钮导出的 `weight-sensitivity-report.md`。',
        '- 数据质量诊断：质检按钮导出的 `data-quality-report.md`。',
        '- 本案例验证包：验证按钮导出的 `case-validation-pack.md`。',
        '',
        '## 十一、CSV 附录',
        '',
        '```csv',
        buildScenarioDecisionCsv(decisionRows),
        '```',
        '',
        '## 十二、保守结论表达',
        '',
        `- 本案例中，系统将方案综合评分、规则问题、数据质量和权重敏感性放入同一证据链，验证就绪度为 ${readiness}/100。`,
        '- 该结果适合表述为“早期方案推演和毕业设计研究支持工具”，不宜表述为替代法定审查或替代专家判断。',
        '- 若后续补充真实 GIS、控规图则、人口、POI、交通和现场调研数据，可进一步把原型验证升级为案例实证研究。',
    ];
    return lines.join('\n');
}

function buildScenarioDecisionCsv(rows: ReturnType<typeof collectScenarioDecisionRows>): string {
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

function csvCell(value: string | number): string {
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function validationReadinessBand(score: number): string {
    if (score >= 85) return '可作为主案例材料';
    if (score >= 70) return '可答辩展示，建议补证据';
    if (score >= 55) return '可演示，需补数据与专家复核';
    return '仅适合原型演示';
}

function buildDecisionMatrixReport(): string {
    const rows = collectScenarioDecisionRows();
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
        buildScenarioComparisonReport(project, activeScenarioId, { headingLevel: 3 }),
    ];
    return lines.join('\n');
}

function buildWeightSensitivityReport(): string {
    const profileRows = buildSensitivityRows();
    const robustWinner = robustSensitivityWinner(profileRows);
    const lines = [
        `# ${project.project.name} 权重敏感性分析`,
        '',
        `当前方案：${activeScenario().name}`,
        `稳健推荐：${robustWinner ? `${robustWinner[0]}（${robustWinner[1]}/${EVALUATION_WEIGHT_PROFILES.length} 个模型排名第一）` : '暂无'}`,
        `生成时间：${new Date().toLocaleString('zh-CN')}`,
        '',
        '## 一、模型对比',
        '',
        '| 权重模型 | 侧重点 | 第一名 | 当前方案得分 | 第一名得分 | 分差范围 |',
        '|---|---|---|---:|---:|---:|',
        ...profileRows.map(row => `| ${row.profile.name} | ${row.profile.description} | ${row.winner?.scenario.name ?? '暂无'} | ${row.active?.evaluation.score ?? '-'} | ${row.winner?.evaluation.score ?? '-'} | ${row.spread} |`),
        '',
        '## 二、权重表',
        '',
        '| 模型 | 控规符合性 | 公共服务 | 交通组织 | 生态开放空间 | 更新价值 | 证据可信度 |',
        '|---|---:|---:|---:|---:|---:|---:|',
        ...EVALUATION_WEIGHT_PROFILES.map(profile => `| ${profile.name} | ${asPercent(profile.weights.compliance)} | ${asPercent(profile.weights.publicService)} | ${asPercent(profile.weights.mobility)} | ${asPercent(profile.weights.ecology)} | ${asPercent(profile.weights.renewalValue)} | ${asPercent(profile.weights.evidence)} |`),
        '',
        '## 三、各模型排序',
        '',
        ...profileRows.flatMap(row => [
            `### ${row.profile.name}`,
            '',
            '| 排名 | 方案 | 得分 | 状态 | 证据可信度 |',
            '|---:|---|---:|---|---:|',
            ...row.rows.map((item, index) => `| ${index + 1} | ${item.scenario.name} | ${item.evaluation.score} | ${item.evaluation.band} | ${item.evaluation.confidence} |`),
            '',
        ]),
        '## 四、答辩解释',
        '',
        '- 如果多个权重模型推荐同一方案，可说明该方案对价值偏好变化较稳健。',
        '- 如果推荐结果随权重变化明显，应把差异解释为规划价值取向不同，而不是简单说某方案绝对最优。',
        '- 当前权重为原型内置模型，论文中可进一步用专家评分、AHP 或熵权法校准。',
    ];
    return lines.join('\n');
}

function buildSensitivityRows() {
    const scenarioRules = new Map(project.scenarios.map((scenario) => {
        const result = runPlanningRules(project, scenario.id);
        return [scenario.id, result] as const;
    }));
    return EVALUATION_WEIGHT_PROFILES.map((profile) => {
        const rows = project.scenarios
            .map((scenario) => {
                const ruleResult = scenarioRules.get(scenario.id)!;
                return {
                    scenario,
                    evaluation: evaluateScenario(project, scenario.id, ruleResult.checks, ruleResult.recommendations, profile),
                };
            })
            .sort((a, b) => b.evaluation.score - a.evaluation.score);
        return {
            profile,
            rows,
            winner: rows[0],
            active: rows.find(row => row.scenario.id === activeScenarioId),
            spread: rows.length ? rows[0].evaluation.score - rows[rows.length - 1].evaluation.score : 0,
        };
    });
}

function robustSensitivityWinner(profileRows: ReturnType<typeof buildSensitivityRows>): [string, number] | undefined {
    const winnerCounts = profileRows.reduce<Record<string, number>>((counts, row) => {
        const name = row.winner?.scenario.name ?? '暂无';
        counts[name] = (counts[name] ?? 0) + 1;
        return counts;
    }, {});
    return Object.entries(winnerCounts).sort((a, b) => b[1] - a[1])[0];
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
    ui.modalText.innerHTML = renderModalContent(text, defaultName);
    ui.modalMeta.textContent = meta;
    ui.modal.classList.add('open');
}

function renderModalContent(text: string, defaultName: string): string {
    if (!defaultName.endsWith('.md')) return `<pre class="modal-raw">${escapeHtml(text)}</pre>`;
    return markdownToHtml(text);
}

function markdownToHtml(markdown: string): string {
    const lines = markdown.split('\n');
    const html: string[] = [];
    let inList = false;
    let inCode = false;
    let codeLines: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.startsWith('```')) {
            if (inCode) {
                html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                codeLines = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            continue;
        }
        if (isMarkdownTableStart(lines, index)) {
            closeList();
            const tableLines: string[] = [];
            while (index < lines.length && lines[index].trim().startsWith('|')) {
                tableLines.push(lines[index]);
                index++;
            }
            index--;
            html.push(markdownTableToHtml(tableLines));
            continue;
        }
        const heading = /^(#{1,4})\s+(.+)$/.exec(line);
        if (heading) {
            closeList();
            const level = heading[1].length;
            html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }
        if (line.startsWith('- ')) {
            if (!inList) {
                html.push('<ul>');
                inList = true;
            }
            html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
            continue;
        }
        if (!line.trim()) {
            closeList();
            continue;
        }
        closeList();
        html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
    if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    closeList();
    return html.join('');

    function closeList() {
        if (!inList) return;
        html.push('</ul>');
        inList = false;
    }
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
    const header = lines[index]?.trim() ?? '';
    const separator = lines[index + 1]?.trim() ?? '';
    return header.startsWith('|') && separator.startsWith('|') && /---/.test(separator);
}

function markdownTableToHtml(lines: string[]): string {
    const rows = lines
        .filter((line, index) => index !== 1)
        .map(line => line.split('|').slice(1, -1).map(cell => inlineMarkdown(cell.trim())));
    const [header = [], ...body] = rows;
    return [
        '<table>',
        '<thead><tr>',
        ...header.map(cell => `<th>${cell}</th>`),
        '</tr></thead>',
        '<tbody>',
        ...body.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`),
        '</tbody></table>',
    ].join('');
}

function inlineMarkdown(text: string): string {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
                loadUpfText(await fs.readTextFile(target), { sourceName: target, showImportReport: true });
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

function loadUpfText(text: string, options: { sourceName?: string; showImportReport?: boolean } = {}) {
    const raw = JSON.parse(text);
    const parsed = parseUpfText(text, project);
    importFindings = [
        ...schemaIssuesToImportFindings(validateUpfDocument(raw)),
        ...auditImportedProject(parsed.project as UrbanPlanProject),
    ].slice(0, 120);
    project = normalizeProject(parsed.project as UrbanPlanProject);
    activeScenarioId = project.scenarios.some(scenario => scenario.id === parsed.activeScenarioId)
        ? parsed.activeScenarioId
        : project.scenarios[0]?.id ?? '';
    selectedId = project.objects[0]?.id ?? '';
    objectSearchText = '';
    objectFilter = 'all';
    renderAll();
    if (options.showImportReport) {
        showModal('导入报告', buildImportReport(options.sourceName ?? 'UPF 文本'), project.project.name, 'import-report.md');
    }
}

function buildImportReport(sourceName: string): string {
    const warnings = importFindings.filter(finding => finding.severity === 'warning');
    const infos = importFindings.filter(finding => finding.severity === 'info');
    const counts = project.objects.reduce<Record<string, number>>((next, object) => {
        next[object.type] = (next[object.type] ?? 0) + 1;
        return next;
    }, {});
    const lines = [
        `# ${project.project.name} 导入报告`,
        '',
        `来源：${sourceName}`,
        `UPF 版本：${project.formatVersion}`,
        `坐标系统：${project.project.crs}`,
        `当前方案：${activeScenario().name}`,
        `导入审计：${warnings.length} 个警告，${infos.length} 个提示`,
        '',
        '## 对象统计',
        '',
        '| 类型 | 数量 |',
        '|---|---:|',
        `| 地块 | ${counts.parcel ?? 0} |`,
        `| 道路 | ${counts.road ?? 0} |`,
        `| 公共服务设施 | ${counts.facility ?? 0} |`,
        `| 出入口 | ${counts.entrance ?? 0} |`,
        `| 开放空间 | ${counts.openSpace ?? 0} |`,
        `| 约束控制线 | ${counts.constraint ?? 0} |`,
        '',
        '## 兼容与校验发现',
        '',
        ...(importFindings.length
            ? [
                '| 等级 | 对象/路径 | 问题 |',
                '|---|---|---|',
                ...importFindings.map(finding => `| ${finding.severity === 'warning' ? '警告' : '提示'} | ${finding.objectId} | ${finding.message} |`),
            ]
            : ['- 未发现需要兼容修复或人工复核的问题。']),
        '',
        '## 下一步',
        '',
        '- 先查看对象列表和图面是否完整，再运行规则检查。',
        '- 若存在警告，请优先进入质检报告查看 UPF 结构校验和规则目录。',
    ];
    return lines.join('\n');
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
    ui.objectSearch.addEventListener('input', () => {
        objectSearchText = ui.objectSearch.value;
        renderObjectList();
    });
    ui.objectFilter.addEventListener('change', () => {
        objectFilter = ui.objectFilter.value;
        renderObjectList();
    });
    ui.canvas.addEventListener('click', event => {
        if (activeTool === 'select') return;
        addObjectAt(canvasPoint(event));
    });
    ui.btnRun.addEventListener('click', renderAll);
    ui.btnEvaluation.addEventListener('click', () => showModal('方案综合评估', buildScenarioEvaluationReport(project, activeScenarioId, checks, recommendations), activeScenario().name, 'scenario-evaluation.md'));
    ui.btnSensitivity.addEventListener('click', () => showModal('权重敏感性分析', buildWeightSensitivityReport(), project.project.name, 'weight-sensitivity-report.md'));
    ui.btnCompare.addEventListener('click', () => showModal('方案决策矩阵', buildDecisionMatrixReport(), project.project.name, 'scenario-decision-matrix.md'));
    ui.btnCsv.addEventListener('click', () => showModal('方案决策 CSV', buildScenarioDecisionCsv(collectScenarioDecisionRows()), project.project.name, 'scenario-decision-matrix.csv'));
    ui.btnQuality.addEventListener('click', () => showModal('数据质量诊断', buildQualityReport(), project.ruleset.version, 'data-quality-report.md'));
    ui.btnValidation.addEventListener('click', () => showModal('案例验证包', buildCaseValidationReport(), project.project.name, 'case-validation-pack.md'));
    ui.btnReport.addEventListener('click', () => showModal('规划诊断报告', buildReport(), activeScenario().name, 'planning-report.md'));
    ui.btnUpf.addEventListener('click', () => showModal('UPF 数据', buildUpf(), `${project.format} ${project.formatVersion}`, `${project.project.id}.upf`));
    ui.btnGeojson.addEventListener('click', () => showModal('GeoJSON 数据', buildGeoJson(), project.project.crs, `${project.project.id}.geojson`));
    ui.btnSave.addEventListener('click', () => void saveText(`${project.project.id}.upf`, buildUpf()));
    ui.btnLoad.addEventListener('click', () => void loadUpf());
    ui.btnRestore.addEventListener('click', restoreAutosave);
    ui.btnReset.addEventListener('click', () => {
        project = createDemoProject();
        activeScenarioId = 'scenario_update';
        selectedId = 'parcel_01';
        activeTool = 'select';
        currentFilePath = '';
        importFindings = [];
        objectSearchText = '';
        objectFilter = 'all';
        dirty = false;
        renderAll();
    });
    ui.btnDelete.addEventListener('click', deleteSelected);
    ui.btnDuplicateScenario.addEventListener('click', duplicateScenario);
    ui.btnOptimize.addEventListener('click', applyScenarioOptimization);
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
                loadUpfText(String(reader.result ?? ''), { sourceName: file.name, showImportReport: true });
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
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void saveText(modalDefaultName, modalContent);
            }
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            const key = event.key.toLowerCase();
            if (key === 's') {
                event.preventDefault();
                void saveText(`${project.project.id}.upf`, buildUpf());
                return;
            }
            if (key === 'o') {
                event.preventDefault();
                void loadUpf();
                return;
            }
            if (key === 'f') {
                event.preventDefault();
                ui.objectSearch.focus();
                ui.objectSearch.select();
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                renderAll();
                return;
            }
        }
        if (event.key === 'Escape') {
            activeTool = 'select';
            renderCanvas();
        }
        const active = document.activeElement;
        const editingText = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
        if (!editingText && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End')) {
            event.preventDefault();
            if (event.key === 'ArrowDown') selectAdjacentObject(1);
            if (event.key === 'ArrowUp') selectAdjacentObject(-1);
            if (event.key === 'Home') selectEdgeObject('first');
            if (event.key === 'End') selectEdgeObject('last');
            return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (editingText) return;
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

