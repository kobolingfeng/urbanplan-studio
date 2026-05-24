import {
    confidencePercent,
    evidenceCompletenessScore,
    evidenceDisplayText,
    normalizeEvidenceItem,
    parseEvidenceText,
    type EvidenceSource,
} from '../src/evidence';

function fail(message: string): never {
    console.error(`evidence smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const decimalConfidence = normalizeEvidenceItem({
    title: '现场调研记录',
    type: 'survey',
    collectedAt: '2026-05-24',
    precision: '地块级',
    license: '课程演示',
    confidence: '0.82',
}) as EvidenceSource;
assert(decimalConfidence.confidence === 0.82, 'evidence normalizer should preserve decimal confidence strings');
assert(evidenceDisplayText(decimalConfidence).includes('可信度 82%'), 'evidence display should format decimal confidence strings');

const percentConfidence = normalizeEvidenceItem({ title: '控规核查', confidence: '86' }) as EvidenceSource;
assert(percentConfidence.confidence === 86, 'evidence normalizer should preserve percent confidence strings');
assert(confidencePercent(percentConfidence.confidence ?? 0) === 86, 'confidence percent should handle percent-scale values');

const clampedConfidence = normalizeEvidenceItem({ title: '异常来源', confidence: '180' }) as EvidenceSource;
assert(clampedConfidence.confidence === 100, 'evidence normalizer should clamp excessive confidence strings');

const parsed = parseEvidenceText([
    '{"title":"结构化访谈","type":"community","confidence":"0.5"}',
    '旧版字符串证据',
].join('\n'));
assert(parsed.length === 2 && typeof parsed[0] === 'object' && (parsed[0] as EvidenceSource).confidence === 0.5, 'evidence text parser should keep numeric-string confidence');
assert(evidenceCompletenessScore(decimalConfidence) > evidenceCompletenessScore('旧版字符串证据'), 'structured evidence should score above legacy strings');

const parsedArray = parseEvidenceText('[{"title":"数组证据","type":"survey","confidence":"75"},{"title":"数组证据二","type":"poi"}]');
assert(parsedArray.length === 2 && typeof parsedArray[0] === 'object' && (parsedArray[0] as EvidenceSource).confidence === 75, 'evidence text parser should accept JSON arrays');

console.log('evidence smoke passed');
