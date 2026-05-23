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
};

type PlanningObjectLike = {
    id: string;
    type: string;
    name: string;
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
    formatVersion?: string;
    project?: {
        name?: string;
        crs?: string;
    };
    objects?: PlanningObjectLike[];
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
        upfId: object.id,
        upfType: object.type,
        name: object.name,
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
