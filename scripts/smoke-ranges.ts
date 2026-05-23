import {
    FACILITY_RANGES,
    PARCEL_CONTROL_RANGES,
    PARCEL_SCENARIO_VALUE_RANGES,
    ROAD_RANGES,
    formatRange,
    integerInRangeOr,
    numberInRangeOr,
} from '../src/planning-ranges';

function fail(message: string): never {
    console.error(`ranges smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

assert(PARCEL_SCENARIO_VALUE_RANGES.far.max === 15, 'FAR range should match import and validation limits');
assert(PARCEL_CONTROL_RANGES.heightMaxM.max === 1000, 'height range should match inspector limits');
assert(ROAD_RANGES.lanes.min === 1 && ROAD_RANGES.lanes.max === 12, 'lane range should match road inspector limits');
assert(FACILITY_RANGES.serviceRadiusM.max === 10_000, 'facility radius range should match facility inspector limits');

assert(numberInRangeOr('3.2', 1, PARCEL_SCENARIO_VALUE_RANGES.far) === 3.2, 'range helper should accept numeric strings from tabular imports');
assert(numberInRangeOr(99, 1, PARCEL_SCENARIO_VALUE_RANGES.far) === 1, 'range helper should reject excessive FAR');
assert(integerInRangeOr(2.6, 1, ROAD_RANGES.lanes) === 3, 'integer range helper should round accepted values');
assert(integerInRangeOr(20, 2, ROAD_RANGES.lanes) === 2, 'integer range helper should fallback after range rejection');
assert(formatRange(FACILITY_RANGES.capacity) === '0-200000', 'range formatter should remain report-friendly');

console.log('ranges smoke passed');
