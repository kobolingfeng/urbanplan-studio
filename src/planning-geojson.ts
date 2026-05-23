import { areaSqm, type Point } from './planning-geometry';

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
    const features = (project.objects ?? [])
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
    const activeScenarioId = textOr(
        upf.activeScenarioId,
        fallbackProject.scenarios?.[0]?.id ?? 'scenario_geojson',
    );
    const fallbackScenarios = (fallbackProject.scenarios ?? []).filter(scenario => scenario.id && scenario.name);
    const scenarios = ensureScenario(
        fallbackScenarios.length ? fallbackScenarios : [],
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
    if (scenarios.some(scenario => scenario.id === activeScenarioId)) return scenarios;
    return [
        ...scenarios,
        {
            id: activeScenarioId,
            name: scenarios.length ? activeScenarioId : fallbackName,
            description: '由 GeoJSON FeatureCollection 导入。',
        },
    ];
}

function geoJsonGeometry(object: PlanningObjectLike) {
    if ((object.type === 'parcel' || object.type === 'openSpace' || object.type === 'constraint') && object.points?.length) {
        return {
            type: 'Polygon',
            coordinates: [closedCoordinates(object.points)],
        };
    }
    if (object.type === 'road' && object.points?.length) {
        return {
            type: 'LineString',
            coordinates: object.points.map(point => [point.x, point.y]),
        };
    }
    if ((object.type === 'facility' || object.type === 'entrance') && object.point) {
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
        evidenceCount: object.evidence?.length ?? 0,
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
    return object.scenarioValues?.[activeScenarioId] ?? Object.values(object.scenarioValues ?? {})[0] ?? {};
}

function closedCoordinates(points: Point[]): number[][] {
    const coordinates = points.map(point => [point.x, point.y]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push([...first]);
    return coordinates;
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
            const far = numberInRange(properties.far, 1, 0, 15);
            const buildingCoverage = numberInRange(properties.buildingCoverage, 0.25, 0, 1);
            const greenRatio = numberInRange(properties.greenRatio, 0.30, 0, 1);
            const residentialGfaSqm = numberInRange(properties.residentialGfaSqm, 0, 0, 5_000_000);
            const publicServiceGfaSqm = numberInRange(properties.publicServiceGfaSqm, 0, 0, 5_000_000);
            return {
                ...base,
                points,
                landUseCode: textOr(properties.landUseCode, '0701'),
                landUseName: textOr(properties.landUseName, '城镇住宅用地'),
                controls: {
                    farMax: numberInRange(properties.farMax, Math.max(4, far), 0, 15),
                    buildingCoverageMax: numberInRange(properties.buildingCoverageMax, Math.max(0.35, buildingCoverage), 0, 1),
                    greenRatioMin: numberInRange(properties.greenRatioMin, Math.min(0.30, greenRatio), 0, 1),
                    heightMaxM: numberInRange(properties.heightMaxM, 80, 0, 1000),
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
            redLineWidthM: numberOr(properties.redLineWidthM, 18),
            lanes: Math.max(1, Math.round(numberOr(properties.lanes, 2))),
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
            capacity: numberOr(properties.capacity, 80),
            serviceRadiusM: numberOr(properties.serviceRadiusM, 500),
            planned: booleanOr(properties.planned, false),
        };
    }

    return undefined;
}

function geoJsonObjectType(properties: AnyRecord, geometryType: string): string | undefined {
    const declared = textOr(properties.upfType ?? properties.objectType ?? properties.type, '');
    if (['parcel', 'road', 'facility', 'entrance', 'openSpace', 'constraint'].includes(declared)) return declared;
    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') return 'parcel';
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'road';
    if (geometryType === 'Point') return 'facility';
    return undefined;
}

function polygonPoints(geometry: GeoJsonGeometryLike): Point[] {
    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        return dropClosingPoint(pointsFromCoordinates(geometry.coordinates[0]));
    }
    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        const firstPolygon = geometry.coordinates[0];
        if (Array.isArray(firstPolygon)) return dropClosingPoint(pointsFromCoordinates(firstPolygon[0]));
    }
    return [];
}

function linePoints(geometry: GeoJsonGeometryLike): Point[] {
    if (geometry.type === 'LineString') return pointsFromCoordinates(geometry.coordinates);
    if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
        return pointsFromCoordinates(geometry.coordinates[0]);
    }
    return [];
}

function pointGeometry(geometry: GeoJsonGeometryLike): Point | undefined {
    if (geometry.type !== 'Point') return undefined;
    return pointFromCoordinate(geometry.coordinates);
}

function pointsFromCoordinates(coordinates: unknown): Point[] {
    if (!Array.isArray(coordinates)) return [];
    return coordinates.flatMap((coordinate) => {
        const point = pointFromCoordinate(coordinate);
        return point ? [point] : [];
    });
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

function textOr(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return fallback;
}

function numberOr(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = numberOr(value, fallback);
    return parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
    }
    return fallback;
}
