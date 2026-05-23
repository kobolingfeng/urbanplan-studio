import {
    FACILITY_RANGES,
    PARCEL_CONTROL_RANGES,
    PARCEL_SCENARIO_VALUE_RANGES,
    ROAD_RANGES,
    formatRange,
    integerInRangeOr,
    numberInRangeOr,
} from '../src/planning-ranges';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');

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

const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'upf-0.1.schema.json'), 'utf8'));
const parcelProperties = schema.$defs.parcel.allOf[1].properties;
const parcelControls = parcelProperties.controls.properties;
const parcelScenario = parcelProperties.scenarioValues.additionalProperties.properties;
const roadProperties = schema.$defs.road.allOf[1].properties;
const facilityProperties = schema.$defs.facility.allOf[1].properties;

for (const [field, range] of Object.entries(PARCEL_SCENARIO_VALUE_RANGES)) {
    assertSchemaRange(parcelScenario[field], range, `parcel scenario ${field}`);
}
for (const [field, range] of Object.entries(PARCEL_CONTROL_RANGES)) {
    assertSchemaRange(parcelControls[field], range, `parcel control ${field}`);
}
for (const [field, range] of Object.entries(ROAD_RANGES)) {
    assertSchemaRange(roadProperties[field], range, `road ${field}`);
}
for (const [field, range] of Object.entries(FACILITY_RANGES)) {
    assertSchemaRange(facilityProperties[field], range, `facility ${field}`);
}

console.log('ranges smoke passed');

function assertSchemaRange(schemaField: { minimum?: number; maximum?: number } | undefined, range: { min: number; max: number }, label: string) {
    assert(schemaField?.minimum === range.min && schemaField.maximum === range.max, `schema range mismatch for ${label}`);
}
