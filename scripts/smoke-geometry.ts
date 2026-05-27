import {
    UNIT_SYSTEM,
    areaSqm,
    centroid,
    distance,
    pointInPolygon,
    polygonsOverlap,
    rect,
    segmentIntersection,
} from '../src/planning-geometry';

function fail(message: string): never {
    console.error(`geometry smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const square = rect(0, 0, 10, 10);
const expectedArea = 100 * UNIT_SYSTEM.metersPerCanvasUnit ** 2;
assert(Math.abs(areaSqm(square) - expectedArea) < 0.0001, 'area scale mismatch');
assert(Math.abs(distance({ x: 0, y: 0 }, { x: 10, y: 0 }) - 10 * UNIT_SYSTEM.metersPerCanvasUnit) < 0.0001, 'distance scale mismatch');
assert(pointInPolygon({ x: 5, y: 5 }, square), 'point should be inside polygon');
assert(pointInPolygon({ x: 10, y: 5 }, square), 'point on polygon boundary should count as inside');
assert(!pointInPolygon({ x: 15, y: 5 }, square), 'point should be outside polygon');
assert(!pointInPolygon({ x: 5, y: 0 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'degenerate polygons should not contain points');
const slantedTriangle = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
assert(!pointInPolygon({ x: 6, y: 5 }, slantedTriangle), 'point inside a slanted edge bounding box should not count as boundary');
const emptyCentroid = centroid([]);
assert(emptyCentroid.x === 0 && emptyCentroid.y === 0, 'empty centroid should be stable');
assert(polygonsOverlap(square, rect(8, 8, 10, 10)), 'polygons should overlap');
assert(!polygonsOverlap(square, rect(20, 20, 5, 5)), 'polygons should not overlap');
assert(!polygonsOverlap([{ x: 0, y: 0 }, { x: 10, y: 0 }], square), 'degenerate line polygons should not overlap');
assert(!polygonsOverlap([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], square), 'zero-area polygons should not overlap');
const coercedPolygon = [{ x: 0, y: 0 }, { x: '0x10', y: 0 }, { x: '0x10', y: 10 }, { x: 0, y: 10 }] as unknown as typeof square;
assert(areaSqm(coercedPolygon) === 0, 'area should reject string-coerced polygon coordinates');
assert(!pointInPolygon({ x: 5, y: 5 }, coercedPolygon), 'point-in-polygon should reject string-coerced polygon coordinates');
assert(!polygonsOverlap(coercedPolygon, square), 'polygon overlap should reject string-coerced polygon coordinates');
assert(!Number.isFinite(distance({ x: 0, y: 0 }, { x: '0x10', y: 0 } as unknown as typeof square[number])), 'distance should reject string-coerced coordinates');

const intersection = segmentIntersection({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 0 }, { x: 5, y: 10 });
assert(intersection?.x === 5 && intersection.y === 5, 'segment intersection mismatch');

const endpointIntersection = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 });
assert(endpointIntersection?.x === 10 && endpointIntersection.y === 0, 'endpoint intersection mismatch');

const collinearEndpointIntersection = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 });
assert(collinearEndpointIntersection?.x === 10 && collinearEndpointIntersection.y === 0, 'collinear endpoint intersection mismatch');
assert(segmentIntersection({ x: 0, y: 0 }, { x: '0x10', y: 0 } as unknown as typeof square[number], { x: 5, y: -5 }, { x: 5, y: 5 }) === null, 'segment intersection should reject string-coerced coordinates');

console.log('geometry smoke passed');
