import { parseUpfText } from '../src/planning-analytics';
import { buildGeoJsonFeatureCollection, buildGeoJsonText, parseGeoJsonProject } from '../src/planning-geojson';
import { UNIT_SYSTEM } from '../src/planning-geometry';

type ImportedObject = {
    id?: string;
    type?: string;
    points?: Array<{ x: number; y: number }>;
    scenarioValues?: Record<string, {
        far?: number;
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

console.log('geojson smoke passed');
