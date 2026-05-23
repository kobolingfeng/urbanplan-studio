import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createUpfDocument, parseUpfText } from '../src/planning-analytics';

const ROOT = resolve(import.meta.dir, '..');
const examples = join(ROOT, 'examples');

function fail(message: string): never {
    console.error(`upf smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const fallback = {
    format: 'UPF',
    formatVersion: '0.1.0',
    project: { id: 'fallback', name: 'Fallback' },
    ruleset: { jurisdiction: 'CN-DEMO', version: 'test', basis: [] },
    scenarios: [{ id: 'scenario_base', name: 'Base' }],
    objects: [],
};

const minimalText = readFileSync(join(examples, 'minimal.upf'), 'utf8');
const minimal = parseUpfText(minimalText, fallback);
assert(minimal.project.project?.id === 'minimal_demo', 'minimal project id mismatch');
assert(minimal.activeScenarioId === 'scenario_base', 'minimal active scenario mismatch');

const roundTrip = createUpfDocument(minimal.project, minimal.activeScenarioId, [], []);
assert(roundTrip.manifest.software.version === '0.1.0', 'manifest software version mismatch');
assert(roundTrip.manifest.unitSystem.metersPerCanvasUnit === 0.68, 'manifest unit system mismatch');
const parsedRoundTrip = parseUpfText(JSON.stringify(roundTrip), fallback);
assert(parsedRoundTrip.project.format === 'UPF', 'round-trip format mismatch');
assert(parsedRoundTrip.project.objects?.length === 1, 'round-trip objects mismatch');

try {
    parseUpfText(readFileSync(join(examples, 'invalid.upf'), 'utf8'), fallback);
    fail('invalid.upf should be rejected');
} catch (error) {
    assert(error instanceof Error && error.message.includes('不是可识别'), 'invalid error message mismatch');
}

console.log('upf smoke passed');
