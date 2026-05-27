export type NumericRange = {
    min: number;
    max: number;
};

export const PARCEL_SCENARIO_VALUE_RANGES: Record<'far' | 'buildingCoverage' | 'greenRatio' | 'residentialGfaSqm' | 'publicServiceGfaSqm', NumericRange> = {
    far: { min: 0, max: 15 },
    buildingCoverage: { min: 0, max: 1 },
    greenRatio: { min: 0, max: 1 },
    residentialGfaSqm: { min: 0, max: 5_000_000 },
    publicServiceGfaSqm: { min: 0, max: 5_000_000 },
};

export const PARCEL_CONTROL_RANGES: Record<'farMax' | 'buildingCoverageMax' | 'greenRatioMin' | 'heightMaxM', NumericRange> = {
    farMax: { min: 0, max: 15 },
    buildingCoverageMax: { min: 0, max: 1 },
    greenRatioMin: { min: 0, max: 1 },
    heightMaxM: { min: 0, max: 1000 },
};

export const ROAD_RANGES: Record<'redLineWidthM' | 'lanes', NumericRange> = {
    redLineWidthM: { min: 0, max: 200 },
    lanes: { min: 1, max: 12 },
};

export const FACILITY_RANGES: Record<'capacity' | 'serviceRadiusM', NumericRange> = {
    capacity: { min: 0, max: 200_000 },
    serviceRadiusM: { min: 0, max: 10_000 },
};

export const UNBOUNDED_RANGE: NumericRange = {
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY,
};

export function finiteNumberOr(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const text = value.trim();
        const numericText = thousandsNumberPattern.test(text)
            ? text.replace(/,/g, '')
            : decimalNumberPattern.test(text)
                ? text
                : '';
        if (!numericText) return fallback;
        const parsed = Number(numericText);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

export function numberInRangeOr(value: unknown, fallback: number, range: NumericRange): number {
    const next = finiteNumberOr(value, fallback);
    return next >= range.min && next <= range.max ? next : fallback;
}

export function integerInRangeOr(value: unknown, fallback: number, range: NumericRange): number {
    return Math.round(numberInRangeOr(value, fallback, range));
}

export function formatRange(range: NumericRange): string {
    return `${range.min}-${range.max}`;
}

const thousandsNumberPattern = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const decimalNumberPattern = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/;
