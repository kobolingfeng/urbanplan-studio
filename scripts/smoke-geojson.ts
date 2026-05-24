import { parseUpfText } from '../src/planning-analytics';
import { buildGeoJsonFeatureCollection, buildGeoJsonText, parseGeoJsonProject } from '../src/planning-geojson';
import { UNIT_SYSTEM } from '../src/planning-geometry';

type ImportedObject = {
    id?: string;
    type?: string;
    name?: string;
    points?: Array<{ x: number; y: number }>;
    point?: { x: number; y: number };
    controls?: {
        farMax?: number;
        buildingCoverageMax?: number;
        greenRatioMin?: number;
        heightMaxM?: number;
    };
    redLineWidthM?: number;
    lanes?: number;
    capacity?: number;
    serviceRadiusM?: number;
    scenarioValues?: Record<string, {
        far?: number;
        buildingCoverage?: number;
        greenRatio?: number;
        residentialGfaSqm?: number;
        publicServiceGfaSqm?: number;
    }>;
};

function fail(message: string): never {
    console.error(`geojson smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const project = {
    formatVersion: '0.1.0',
    project: { name: 'GeoJSON Fixture', crs: 'DemoCanvasMetric' },
    objects: [
        {
            id: 'parcel_a',
            type: 'parcel',
            name: 'Parcel A',
            evidence: ['fixture'],
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
            ],
            landUseCode: '0701',
            landUseName: '城镇住宅用地',
            scenarioValues: {
                base: {
                    far: 2,
                    buildingCoverage: 0.3,
                    greenRatio: 0.32,
                    residentialGfaSqm: 12000,
                    publicServiceGfaSqm: 500,
                    updateMode: '综合整治',
                },
            },
        },
        {
            id: 'road_a',
            type: 'road',
            name: 'Road A',
            points: [{ x: 0, y: 20 }, { x: 30, y: 20 }],
            level: '支路',
            redLineWidthM: 18,
            lanes: 2,
        },
        {
            id: 'facility_a',
            type: 'facility',
            name: 'Facility A',
            point: { x: 6, y: 6 },
            kind: '幼儿园',
            capacity: 120,
            serviceRadiusM: 500,
            planned: true,
        },
    ],
};

const collection = buildGeoJsonFeatureCollection(project, 'base', UNIT_SYSTEM);
assert(collection.type === 'FeatureCollection', 'should create FeatureCollection');
assert(collection.features.length === 3, 'feature count mismatch');
assert(collection.upf.crs === 'DemoCanvasMetric', 'crs metadata mismatch');

const parcel = collection.features.find(feature => feature.id === 'parcel_a');
assert(parcel?.geometry?.type === 'Polygon', 'parcel should become polygon');
const ring = (parcel!.geometry as { coordinates: number[][][] }).coordinates[0];
assert(JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1]), 'polygon ring should be closed');
assert(parcel!.properties.far === 2, 'parcel active scenario values should be exported');

const road = collection.features.find(feature => feature.id === 'road_a');
assert(road?.geometry?.type === 'LineString', 'road should become line string');
const facility = collection.features.find(feature => feature.id === 'facility_a');
assert(facility?.geometry?.type === 'Point', 'facility should become point');

const text = buildGeoJsonText(project, 'base', UNIT_SYSTEM);
assert(text.includes('"FeatureCollection"') && text.includes('"parcel_a"'), 'GeoJSON text export mismatch');

const fallback: {
    format: string;
    formatVersion: string;
    project: { id: string; name: string; crs: string };
    ruleset: { jurisdiction: string; version: string; basis: string[] };
    scenarios: Array<{ id: string; name: string; description: string }>;
    objects: ImportedObject[];
} = {
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'fallback', name: 'Fallback', crs: 'DemoCanvasMetric' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: [] },
    scenarios: [{ id: 'base', name: 'Base', description: 'Fixture scenario' }],
    objects: [],
};

const parsed = parseGeoJsonProject(JSON.parse(text), fallback);
assert(parsed?.activeScenarioId === 'base', 'GeoJSON active scenario should round-trip');
if (!parsed) fail('GeoJSON parser should return a project');
assert(parsed.project.objects.length === 3, 'GeoJSON import object count mismatch');
const importedParcel = parsed.project.objects.find(object => object.id === 'parcel_a');
assert(importedParcel?.type === 'parcel', 'GeoJSON polygon should import as parcel');
if (!importedParcel) fail('GeoJSON imported parcel missing');
assert(importedParcel.points?.length === 4, 'GeoJSON import should drop duplicate closing point');
assert(importedParcel.scenarioValues?.base?.far === 2, 'GeoJSON import should preserve FAR');
assert(importedParcel.scenarioValues?.base?.publicServiceGfaSqm === 500, 'GeoJSON import should preserve public service GFA');

const parsedViaUpf = parseUpfText(text, fallback);
assert(parsedViaUpf.activeScenarioId === 'base', 'UPF parser should accept GeoJSON active scenario');
assert(parsedViaUpf.project.objects?.some(object => object.id === 'road_a'), 'UPF parser should accept GeoJSON features');

const fallbackWithoutActive = {
    ...fallback,
    scenarios: [{ id: 'other', name: 'Other', description: 'Existing scenario' }],
};
const parsedWithMissingScenario = parseGeoJsonProject(JSON.parse(text), fallbackWithoutActive);
assert(parsedWithMissingScenario?.project.scenarios.some(scenario => scenario.id === 'base'), 'GeoJSON import should add the active scenario when fallback scenarios do not include it');
const preservedParcel = parsedWithMissingScenario?.project.objects.find(object => object.id === 'parcel_a');
assert(preservedParcel?.scenarioValues?.base?.far === 2, 'GeoJSON import should keep active-scenario parcel values discoverable');

const whitespaceGeoJson = JSON.parse(text);
whitespaceGeoJson.upf.activeScenarioId = '  trimmed_scenario  ';
whitespaceGeoJson.features[0].id = '  ignored_feature_id  ';
whitespaceGeoJson.features[0].properties = {
    ...whitespaceGeoJson.features[0].properties,
    upfId: '  parcel_trim  ',
    name: '  Trimmed Parcel  ',
    upfType: '  parcel  ',
};
const parsedWhitespace = parseGeoJsonProject(whitespaceGeoJson, fallback);
const trimmedParcel = parsedWhitespace?.project.objects.find(object => object.id === 'parcel_trim');
assert(parsedWhitespace?.activeScenarioId === 'trimmed_scenario', 'GeoJSON import should trim active scenario ids');
assert(trimmedParcel?.name === 'Trimmed Parcel', 'GeoJSON import should trim object ids and names');
assert(trimmedParcel?.scenarioValues?.trimmed_scenario?.far === 2, 'GeoJSON import should use trimmed scenario ids for parcel values');

const typeAliasGeoJson = {
    type: 'FeatureCollection',
    name: 'Type Alias',
    upf: { activeScenarioId: 'base', formatVersion: '0.1.0', crs: 'DemoCanvasMetric' },
    features: [{
        type: 'Feature',
        id: 'alias_open_space',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]] },
        properties: { upfType: ' Open Space ', upfId: 'alias_open_space', name: 'Alias Open Space', kind: '口袋公园' },
    }, {
        type: 'Feature',
        id: 'alias_entrance',
        geometry: { type: 'Point', coordinates: [10, 10] },
        properties: { upfType: ' Entrance ', upfId: 'alias_entrance', name: 'Alias Entrance', parcelId: 'parcel_a', roadId: 'road_a' },
    }],
};
const parsedTypeAliases = parseGeoJsonProject(typeAliasGeoJson, fallback);
assert(parsedTypeAliases?.project.objects.find(object => object.id === 'alias_open_space')?.type === 'openSpace', 'GeoJSON import should normalize open space type aliases');
assert(parsedTypeAliases?.project.objects.find(object => object.id === 'alias_entrance')?.type === 'entrance', 'GeoJSON import should normalize entrance type aliases');

const multiGeometryGeoJson = {
    type: 'FeatureCollection',
    name: 'Multi Geometry',
    upf: { activeScenarioId: 'base', formatVersion: '0.1.0', crs: 'DemoCanvasMetric' },
    features: [{
        type: 'Feature',
        id: 'multi_parcel',
        geometry: {
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 0], [1, 1]]],
                [[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]],
            ],
        },
        properties: { upfType: 'parcel', upfId: 'multi_parcel', name: 'Multi Parcel' },
    }, {
        type: 'Feature',
        id: 'multi_road',
        geometry: {
            type: 'MultiLineString',
            coordinates: [
                [[0, 0]],
                [[0, 10], [20, 10]],
            ],
        },
        properties: { upfType: 'road', upfId: 'multi_road', name: 'Multi Road' },
    }],
};
const parsedMultiGeometry = parseGeoJsonProject(multiGeometryGeoJson, fallback);
const multiParcel = parsedMultiGeometry?.project.objects.find(object => object.id === 'multi_parcel');
const multiRoad = parsedMultiGeometry?.project.objects.find(object => object.id === 'multi_road');
assert(multiParcel?.points?.length === 4, 'GeoJSON import should use the first valid MultiPolygon ring');
assert(multiRoad?.points?.length === 2, 'GeoJSON import should use the first valid MultiLineString part');

const invalidNumberGeoJson = JSON.parse(text);
invalidNumberGeoJson.features[0].properties = {
    ...invalidNumberGeoJson.features[0].properties,
    far: 99,
    buildingCoverage: 1.5,
    greenRatio: -0.2,
    residentialGfaSqm: -100,
    publicServiceGfaSqm: 8_000_000,
    farMax: 20,
    buildingCoverageMax: -1,
    greenRatioMin: 2,
    heightMaxM: 1200,
};
invalidNumberGeoJson.features[1].properties = {
    ...invalidNumberGeoJson.features[1].properties,
    redLineWidthM: -5,
    lanes: 99,
};
invalidNumberGeoJson.features[2].properties = {
    ...invalidNumberGeoJson.features[2].properties,
    capacity: -10,
    serviceRadiusM: 50_000,
    planned: ' true ',
};
const parsedInvalidNumbers = parseGeoJsonProject(invalidNumberGeoJson, fallback);
const safeParcel = parsedInvalidNumbers?.project.objects.find(object => object.id === 'parcel_a');
assert(safeParcel?.scenarioValues?.base?.far === 1, 'GeoJSON import should ignore out-of-range FAR');
assert(safeParcel?.scenarioValues?.base?.buildingCoverage === 0.25, 'GeoJSON import should ignore out-of-range building coverage');
assert(safeParcel?.scenarioValues?.base?.greenRatio === 0.30, 'GeoJSON import should ignore out-of-range green ratio');
assert(safeParcel?.scenarioValues?.base?.residentialGfaSqm === 0, 'GeoJSON import should ignore negative residential GFA');
assert(safeParcel?.scenarioValues?.base?.publicServiceGfaSqm === 0, 'GeoJSON import should ignore excessive public service GFA');
assert(safeParcel?.controls?.farMax === 4 && safeParcel.controls.heightMaxM === 80, 'GeoJSON import should keep parcel controls in valid ranges');
const safeRoad = parsedInvalidNumbers?.project.objects.find(object => object.id === 'road_a');
const safeFacility = parsedInvalidNumbers?.project.objects.find(object => object.id === 'facility_a');
assert(safeRoad?.redLineWidthM === 18 && safeRoad.lanes === 2, 'GeoJSON import should ignore out-of-range road dimensions');
assert(safeFacility?.capacity === 80 && safeFacility.serviceRadiusM === 500, 'GeoJSON import should ignore out-of-range facility service values');
assert((safeFacility as { planned?: boolean } | undefined)?.planned === true, 'GeoJSON import should trim boolean strings');

console.log('geojson smoke passed');
