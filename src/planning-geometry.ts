export type Point = {
    x: number;
    y: number;
};

export const UNIT_SYSTEM = {
    name: 'DemoCanvasMetric',
    metersPerCanvasUnit: 0.68,
};

const LENGTH_FACTOR = UNIT_SYSTEM.metersPerCanvasUnit;
const AREA_FACTOR = UNIT_SYSTEM.metersPerCanvasUnit ** 2;

export function rect(x: number, y: number, width: number, height: number): Point[] {
    return [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
    ];
}

export function areaSqm(points: Point[]): number {
    return rawPolygonArea(points) * AREA_FACTOR;
}

export function centroid(points: Point[]): Point {
    const finitePoints = points.filter(isFinitePoint);
    if (!finitePoints.length) return { x: 0, y: 0 };
    const areaRaw = finitePoints.reduce((sum, point, index) => {
        const next = finitePoints[(index + 1) % finitePoints.length];
        return sum + point.x * next.y - next.x * point.y;
    }, 0);
    if (Math.abs(areaRaw) < 0.001) {
        return {
            x: finitePoints.reduce((sum, point) => sum + point.x, 0) / finitePoints.length,
            y: finitePoints.reduce((sum, point) => sum + point.y, 0) / finitePoints.length,
        };
    }
    let x = 0;
    let y = 0;
    for (let i = 0; i < finitePoints.length; i++) {
        const a = finitePoints[i];
        const b = finitePoints[(i + 1) % finitePoints.length];
        const cross = a.x * b.y - b.x * a.y;
        x += (a.x + b.x) * cross;
        y += (a.y + b.y) * cross;
    }
    return { x: x / (3 * areaRaw), y: y / (3 * areaRaw) };
}

export function distance(a: Point, b: Point): number {
    if (!isFinitePoint(a) || !isFinitePoint(b)) return Number.POSITIVE_INFINITY;
    return Math.hypot(a.x - b.x, a.y - b.y) * LENGTH_FACTOR;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
    if (!isFinitePoint(point) || !isFinitePoint(a) || !isFinitePoint(b)) return Number.POSITIVE_INFINITY;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return distance(point, a);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function distanceToPolyline(point: Point, points: Point[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length - 1; i++) {
        best = Math.min(best, distanceToSegment(point, points[i], points[i + 1]));
    }
    return best;
}

export function pointInPolygon(point: Point, points: Point[]): boolean {
    if (!isFinitePoint(point) || !isUsablePolygon(points)) return false;
    for (let index = 0; index < points.length; index++) {
        if (onSegment(points[index], points[(index + 1) % points.length], point)) return true;
    }
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const pi = points[i];
        const pj = points[j];
        const intersects = ((pi.y > point.y) !== (pj.y > point.y))
            && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

export function polygonsOverlap(a: Point[], b: Point[]): boolean {
    if (!isUsablePolygon(a) || !isUsablePolygon(b)) return false;
    if (a.some(point => pointInPolygon(point, b)) || b.some(point => pointInPolygon(point, a))) return true;
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
        }
    }
    return false;
}

function isUsablePolygon(points: Point[]): boolean {
    return points.length >= 3 && rawPolygonArea(points) > 0.0001;
}

function rawPolygonArea(points: Point[]): number {
    if (points.length < 3 || !points.every(isFinitePoint)) return 0;
    let sum = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        sum += current.x * next.y - next.x * current.y;
    }
    return Math.abs(sum / 2);
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
    if (![a, b, c, d].every(isFinitePoint)) return false;
    const det = (p1: Point, p2: Point, p3: Point) =>
        (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const d1 = det(a, b, c);
    const d2 = det(a, b, d);
    const d3 = det(c, d, a);
    const d4 = det(c, d, b);
    if (Math.abs(d1) < 0.0001 && onSegment(a, b, c)) return true;
    if (Math.abs(d2) < 0.0001 && onSegment(a, b, d)) return true;
    if (Math.abs(d3) < 0.0001 && onSegment(c, d, a)) return true;
    if (Math.abs(d4) < 0.0001 && onSegment(c, d, b)) return true;
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function onSegment(a: Point, b: Point, p: Point): boolean {
    if (![a, b, p].every(isFinitePoint)) return false;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) > 0.0001) return false;
    return p.x >= Math.min(a.x, b.x) - 0.0001
        && p.x <= Math.max(a.x, b.x) + 0.0001
        && p.y >= Math.min(a.y, b.y) - 0.0001
        && p.y <= Math.max(a.y, b.y) + 0.0001;
}

function isFinitePoint(point: Point | undefined): point is Point {
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
    if (!segmentsIntersect(a, b, c, d)) return null;
    const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(denominator) < 0.0001) {
        for (const point of [a, b]) {
            if (onSegment(c, d, point)) return point;
        }
        for (const point of [c, d]) {
            if (onSegment(a, b, point)) return point;
        }
        return null;
    }
    const x = ((a.x * b.y - a.y * b.x) * (c.x - d.x) - (a.x - b.x) * (c.x * d.y - c.y * d.x)) / denominator;
    const y = ((a.x * b.y - a.y * b.x) * (c.y - d.y) - (a.y - b.y) * (c.x * d.y - c.y * d.x)) / denominator;
    return { x, y };
}
