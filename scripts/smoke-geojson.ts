import { buildGeoJsonFeatureCollection, buildGeoJsonText } from '../src/planning-geojson';
import { UNIT_SYSTEM } from '../src/planning-geometry';

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

console.log('geojson smoke passed');
