import { areaSqm, type Point } from './planning-geometry';
import {
    FACILITY_RANGES,
    PARCEL_CONTROL_RANGES,
    PARCEL_SCENARIO_VALUE_RANGES,
    ROAD_RANGES,
    integerInRangeOr,
    numberInRangeOr,
} from './planning-ranges';

type UnitSystemLike = {
    name: string;
    metersPerCanvasUnit: number;
};

type ScenarioValueLike = {
    far?: number;
    buildingCoverage?: number;
    greenRatio?: number;
    residentialGfaSqm?: number;
    publicServiceGfaSqm?: number;
    updateMode?: string;
    notes?: string;
};

type PlanningObjectLike = {
    id?: string;
    type?: string;
    name?: string;
    evidence?: unknown[];
    points?: Point[];
    point?: Point;
    landUseCode?: string;
    landUseName?: string;
    controls?: Record<string, unknown>;
    scenarioValues?: Record<string, ScenarioValueLike>;
    level?: string;
    redLineWidthM?: number;
    lanes?: number;
    kind?: string;
    capacity?: number;
    serviceRadiusM?: number;
    planned?: boolean;
    entranceType?: string;
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
    ruleset?: unknown;
    scenarios?: Array<{ id: string; name: string; description?: string }>;
    objects?: PlanningObjectLike[];
};

type GeoJsonFeatureCollectionLike = {
    type?: unknown;
    name?: unknown;
    upf?: unknown;
    features?: unknown;
};

type GeoJsonFeatureLike = {
    id?: unknown;
    type?: unknown;
    geometry?: unknown;
    properties?: unknown;
};

type GeoJsonGeometryLike = {
    type?: unknown;
    coordinates?: unknown;
};

type AnyRecord = Record<string, unknown>;

export type GeoJsonParseResult<TProject> = {
    project: TProject;
    activeScenarioId: string;
};

export function buildGeoJsonText(
    project: ProjectLike,
    activeScenarioId: string,
    unitSystem: UnitSystemLike,
): string {
    return JSON.stringify(buildGeoJsonFeatureCollection(project, activeScenarioId, unitSystem), null, 2);
}

export function buildGeoJsonFeatureCollection(
    project: ProjectLike,
    activeScenarioId: string,
    unitSystem: UnitSystemLike,
) {
    const objects = recordItems<PlanningObjectLike>(project.objects);
    const features = objects
        .map(object => ({
            type: 'Feature',
            id: object.id,
            geometry: geoJsonGeometry(object),
            properties: geoJsonProperties(object, activeScenarioId),
        }))
        .filter(feature => feature.geometry);

    return {
        type: 'FeatureCollection',
        name: project.project?.name ?? 'UrbanPlan',
        upf: {
            formatVersion: project.formatVersion ?? '0.1.0',
            activeScenarioId,
            crs: project.project?.crs ?? 'DemoCanvasMetric',
            unitSystem,
            note: 'Coordinates are exported in the UPF project coordinate space; transform before mixing with GIS layers.',
        },
        features,
    };
}

export function parseGeoJsonProject<TProject extends ProjectLike>(
    input: unknown,
    fallbackProject: TProject,
): GeoJsonParseResult<TProject> | undefined {
    if (!isRecord(input)) return undefined;
    const collection = input as GeoJsonFeatureCollectionLike;
    if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) return undefined;

    const upf = isRecord(collection.upf) ? collection.upf : {};
    const fallbackScenarios = recordItems<{ id: unknown; name?: unknown; description?: unknown }>(fallbackProject.scenarios)
        .flatMap(normalizeScenario);
    const activeScenarioId = textOr(
        upf.activeScenarioId,
        fallbackScenarios[0]?.id ?? 'scenario_geojson',
    );
    const scenarios = ensureScenario(
        fallbackScenarios,
        activeScenarioId,
        'GeoJSON 导入',
    );
    const objects = collection.features
        .map((feature, index) => parseGeoJsonFeature(feature, activeScenarioId, index))
        .filter((object): object is PlanningObjectLike => Boolean(object));

    if (!objects.length) return undefined;

    return {
        project: {
            ...fallbackProject,
            format: 'UPF',
            formatVersion: textOr(upf.formatVersion, fallbackProject.formatVersion ?? '0.1.0'),
            project: {
                ...(fallbackProject.project ?? {}),
                name: textOr(collection.name, fallbackProject.project?.name ?? 'GeoJSON 导入项目'),
                crs: textOr(upf.crs, fallbackProject.project?.crs ?? 'DemoCanvasMetric'),
            },
            ruleset: fallbackProject.ruleset,
            scenarios,
            objects,
        } as TProject,
        activeScenarioId,
    };
}

function ensureScenario(
    scenarios: Array<{ id: string; name: string; description?: string }>,
    activeScenarioId: string,
    fallbackName: string,
): Array<{ id: string; name: string; description?: string }> {
    const activeId = identifierText(activeScenarioId);
    if (activeId && scenarios.some(scenario => identifierText(scenario.id) === activeId)) return scenarios;
    return [
        ...scenarios,
        {
            id: activeScenarioId,
            name: scenarios.length ? activeScenarioId : fallbackName,
            description: '由 GeoJSON FeatureCollection 导入。',
        },
    ];
}

function normalizeScenario(value: { id: unknown; name?: unknown; description?: unknown }): Array<{ id: string; name: string; description?: string }> {
    const id = identifierText(value.id);
    if (!id) return [];
    return [{
        id,
        name: textOr(value.name, id),
        ...(typeof value.description === 'string' ? { description: value.description.trim() } : {}),
    }];
}

function geoJsonGeometry(object: PlanningObjectLike) {
    if (object.type === 'parcel' || object.type === 'openSpace' || object.type === 'constraint') {
        const points = usablePolygonPoints(object.points);
        if (!points) return null;
        return {
            type: 'Polygon',
            coordinates: [closedCoordinates(points)],
        };
    }
    if (object.type === 'road') {
        const points = usableLinePoints(object.points);
        if (!points) return null;
        return {
            type: 'LineString',
            coordinates: points.map(point => [point.x, point.y]),
        };
    }
    if ((object.type === 'facility' || object.type === 'entrance') && isUsablePoint(object.point)) {
        return {
            type: 'Point',
            coordinates: [object.point.x, object.point.y],
        };
    }
    return null;
}

function geoJsonProperties(object: PlanningObjectLike, activeScenarioId: string): Record<string, unknown> {
    const base: Record<string, unknown> = {
        upfId: object.id ?? '',
        upfType: object.type,
        name: object.name ?? object.id ?? '未命名对象',
        evidenceCount: evidenceItemCount(object.evidence),
    };
    if (object.type === 'parcel') {
        const value = parcelScenario(object, activeScenarioId);
        return {
            ...base,
            landUseCode: object.landUseCode,
            landUseName: object.landUseName,
            areaSqm: object.points?.length ? Math.round(areaSqm(object.points)) : 0,
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
    if (object.type === 'openSpace' || object.type === 'constraint') {
        return {
            ...base,
            kind: object.kind,
            areaSqm: object.points?.length ? Math.round(areaSqm(object.points)) : 0,
        };
    }
    return base;
}

function parcelScenario(object: PlanningObjectLike, activeScenarioId: string): ScenarioValueLike {
    const values = scenarioValueMap(object.scenarioValues);
    return scenarioValueFor(values, activeScenarioId) ?? Object.values(values)[0] ?? {};
}

function closedCoordinates(points: Point[]): number[][] {
    const coordinates = points.map(point => [point.x, point.y]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push([...first]);
    return coordinates;
}

function usablePolygonPoints(points: unknown): Point[] | undefined {
    const source = Array.isArray(points) ? points : [];
    if (!source.every(isUsablePoint)) return undefined;
    const clean = dropClosingPoint(source);
    if (clean.length < 3 || rawPolygonArea(clean) < 0.0001) return undefined;
    return clean;
}

function usableLinePoints(points: unknown): Point[] | undefined {
    const source = Array.isArray(points) ? points : [];
    if (source.length < 2 || !source.every(isUsablePoint)) return undefined;
    const first = source[0];
    if (source.every(point => point.x === first.x && point.y === first.y)) return undefined;
    return source;
}

function evidenceItemCount(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    return value ? 1 : 0;
}

function isUsablePoint(point: unknown): point is Point {
    return isRecord(point)
        && typeof point.x === 'number'
        && typeof point.y === 'number'
        && Number.isFinite(point.x)
        && Number.isFinite(point.y);
}

function rawPolygonArea(points: Point[]): number {
    let sum = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        sum += current.x * next.y - next.x * current.y;
    }
    return Math.abs(sum / 2);
}

function parseGeoJsonFeature(feature: unknown, activeScenarioId: string, index: number): PlanningObjectLike | undefined {
    if (!isRecord(feature)) return undefined;
    const candidate = feature as GeoJsonFeatureLike;
    const properties = isRecord(candidate.properties) ? candidate.properties : {};
    const geometry = isRecord(candidate.geometry) ? candidate.geometry as GeoJsonGeometryLike : undefined;
    if (!geometry) return undefined;

    const geometryType = textOr(geometry.type, '');
    const objectType = geoJsonObjectType(properties, geometryType);
    if (!objectType) return undefined;

    const id = textOr(properties.upfId, textOr(candidate.id, `geojson_${index + 1}`));
    const name = textOr(properties.name, id);
    const base = { id, type: objectType, name, evidence: [] };

    if (objectType === 'parcel' || objectType === 'openSpace' || objectType === 'constraint') {
        const points = polygonPoints(geometry);
        if (points.length < 3) return undefined;
        if (objectType === 'parcel') {
            const far = numberInRangeOr(properties.far, 1, PARCEL_SCENARIO_VALUE_RANGES.far);
            const buildingCoverage = numberInRangeOr(properties.buildingCoverage, 0.25, PARCEL_SCENARIO_VALUE_RANGES.buildingCoverage);
            const greenRatio = numberInRangeOr(properties.greenRatio, 0.30, PARCEL_SCENARIO_VALUE_RANGES.greenRatio);
            const residentialGfaSqm = numberInRangeOr(properties.residentialGfaSqm, 0, PARCEL_SCENARIO_VALUE_RANGES.residentialGfaSqm);
            const publicServiceGfaSqm = numberInRangeOr(properties.publicServiceGfaSqm, 0, PARCEL_SCENARIO_VALUE_RANGES.publicServiceGfaSqm);
            return {
                ...base,
                points,
                landUseCode: textOr(properties.landUseCode, '0701'),
                landUseName: textOr(properties.landUseName, '城镇住宅用地'),
                controls: {
                    farMax: numberInRangeOr(properties.farMax, Math.max(4, far), PARCEL_CONTROL_RANGES.farMax),
                    buildingCoverageMax: numberInRangeOr(properties.buildingCoverageMax, Math.max(0.35, buildingCoverage), PARCEL_CONTROL_RANGES.buildingCoverageMax),
                    greenRatioMin: numberInRangeOr(properties.greenRatioMin, Math.min(0.30, greenRatio), PARCEL_CONTROL_RANGES.greenRatioMin),
                    heightMaxM: numberInRangeOr(properties.heightMaxM, 80, PARCEL_CONTROL_RANGES.heightMaxM),
                },
                scenarioValues: {
                    [activeScenarioId]: {
                        far,
                        buildingCoverage,
                        greenRatio,
                        residentialGfaSqm,
                        publicServiceGfaSqm,
                        updateMode: textOr(properties.updateMode, '综合整治'),
                        notes: textOr(properties.notes, '由 GeoJSON 属性导入，请复核。'),
                    },
                },
            };
        }
        return {
            ...base,
            points,
            kind: textOr(properties.kind, objectType === 'openSpace' ? '口袋公园' : '历史风貌控制'),
        };
    }

    if (objectType === 'road') {
        const points = linePoints(geometry);
        if (points.length < 2) return undefined;
        return {
            ...base,
            points,
            level: textOr(properties.level, '支路'),
            redLineWidthM: numberInRangeOr(properties.redLineWidthM, 18, ROAD_RANGES.redLineWidthM),
            lanes: integerInRangeOr(properties.lanes, 2, ROAD_RANGES.lanes),
        };
    }

    if (objectType === 'facility' || objectType === 'entrance') {
        const point = pointGeometry(geometry);
        if (!point) return undefined;
        if (objectType === 'entrance') {
            return {
                ...base,
                point,
                entranceType: textOr(properties.entranceType, '机动车'),
                parcelId: textOr(properties.parcelId, ''),
                roadId: textOr(properties.roadId, ''),
            };
        }
        return {
            ...base,
            point,
            kind: textOr(properties.kind, '社区养老'),
            capacity: numberInRangeOr(properties.capacity, 80, FACILITY_RANGES.capacity),
            serviceRadiusM: numberInRangeOr(properties.serviceRadiusM, 500, FACILITY_RANGES.serviceRadiusM),
            planned: booleanOr(properties.planned, false),
        };
    }

    return undefined;
}

function geoJsonObjectType(properties: AnyRecord, geometryType: string): string | undefined {
    const declared = textOr(properties.upfType ?? properties.objectType ?? properties.type, '');
    const canonical = canonicalObjectType(declared);
    if (canonical) return canonical;
    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') return 'parcel';
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'road';
    if (geometryType === 'Point') return 'facility';
    return undefined;
}

function canonicalObjectType(value: string): string | undefined {
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases: Record<string, string> = {
        parcel: 'parcel',
        road: 'road',
        facility: 'facility',
        entrance: 'entrance',
        openspace: 'openSpace',
        open_space: 'openSpace',
        constraint: 'constraint',
    };
    return aliases[key];
}

function polygonPoints(geometry: GeoJsonGeometryLike): Point[] {
    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        return firstUsableRing(geometry.coordinates);
    }
    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        for (const polygon of geometry.coordinates) {
            const points = firstUsableRing(polygon);
            if (points.length >= 3) return points;
        }
    }
    return [];
}

function linePoints(geometry: GeoJsonGeometryLike): Point[] {
    if (geometry.type === 'LineString') return pointsFromCoordinates(geometry.coordinates);
    if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
        for (const line of geometry.coordinates) {
            const points = pointsFromCoordinates(line);
            if (points.length >= 2) return points;
        }
    }
    return [];
}

function firstUsableRing(rings: unknown): Point[] {
    if (!Array.isArray(rings)) return [];
    for (const ring of rings) {
        const points = dropClosingPoint(pointsFromCoordinates(ring));
        if (points.length >= 3 && rawPolygonArea(points) > 0.0001) return points;
    }
    return [];
}

function pointGeometry(geometry: GeoJsonGeometryLike): Point | undefined {
    if (geometry.type !== 'Point') return undefined;
    return pointFromCoordinate(geometry.coordinates);
}

function pointsFromCoordinates(coordinates: unknown): Point[] {
    if (!Array.isArray(coordinates)) return [];
    const points: Point[] = [];
    for (const coordinate of coordinates) {
        const point = pointFromCoordinate(coordinate);
        if (!point) return [];
        points.push(point);
    }
    return points;
}

function pointFromCoordinate(coordinate: unknown): Point | undefined {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return undefined;
    const [x, y] = coordinate;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return { x, y };
}

function dropClosingPoint(points: Point[]): Point[] {
    if (points.length < 2) return points;
    const first = points[0];
    const last = points[points.length - 1];
    if (first.x === last.x && first.y === last.y) return points.slice(0, -1);
    return points;
}

function isRecord(value: unknown): value is AnyRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordItems<T extends AnyRecord>(values: unknown): T[] {
    return Array.isArray(values) ? values.filter(isRecord) as T[] : [];
}

function textOr(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
        const text = value.trim();
        if (text) return text;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return fallback;
}

function identifierText(value: unknown): string | undefined {
    const text = textOr(value, '');
    return text || undefined;
}

function scenarioValueFor<T>(values: Record<string, T> | undefined, scenarioId: unknown): T | undefined {
    const target = identifierText(scenarioId);
    if (!values || typeof values !== 'object' || Array.isArray(values) || !target) return undefined;
    if (Object.prototype.hasOwnProperty.call(values, target)) return values[target];
    return Object.entries(values).find(([key]) => identifierText(key) === target)?.[1];
}

function scenarioValueMap<T>(values: Record<string, T> | undefined): Record<string, T> {
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (text === 'true') return true;
        if (text === 'false') return false;
    }
    return fallback;
}
