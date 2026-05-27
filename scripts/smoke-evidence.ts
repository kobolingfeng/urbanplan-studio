import {
    confidencePercent,
    evidenceCompletenessScore,
    evidenceDisplayText,
    evidenceKind,
    evidenceSearchText,
    formatEvidenceForEditing,
    normalizeEvidenceItem,
    parseEvidenceText,
    type EvidenceItem,
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
const decimalSearch = evidenceSearchText([decimalConfidence]);
assert(decimalSearch.includes('调研/空间数据') && decimalSearch.includes('82%'), 'evidence search should include derived kind labels and confidence');

const percentConfidence = normalizeEvidenceItem({ title: '控规核查', confidence: '86' }) as EvidenceSource;
assert(percentConfidence.confidence === 86, 'evidence normalizer should preserve percent confidence strings');
assert(confidencePercent(percentConfidence.confidence ?? 0) === 86, 'confidence percent should handle percent-scale values');
assert(confidencePercent(-0.5) === 0 && confidencePercent(Number.NaN) === 0, 'confidence percent should clamp invalid low values');
assert(evidenceKind({ title: '遥感影像', type: 'Remote-Sensing' }) === '调研/空间数据', 'evidence kind should normalize type aliases');

const percentSignConfidence = normalizeEvidenceItem({ title: '公众参与记录', confidence: '86%' }) as EvidenceSource;
assert(percentSignConfidence.confidence === 86, 'evidence normalizer should parse percent-suffixed confidence strings');
assert(evidenceDisplayText(percentSignConfidence).includes('可信度 86%'), 'evidence display should format percent-suffixed confidence strings');

const fractionalPercentConfidence = normalizeEvidenceItem({ title: '抽样核查记录', confidence: '0.86%' }) as EvidenceSource;
assert(fractionalPercentConfidence.confidence === 0.0086, 'evidence normalizer should treat fractional percent strings as percentages');
assert(evidenceDisplayText(fractionalPercentConfidence).includes('可信度 1%'), 'evidence display should not inflate fractional percent strings');

const hexConfidence = normalizeEvidenceItem({ title: '异常可信度', confidence: '0x10' }) as EvidenceSource;
assert(hexConfidence.confidence === undefined, 'evidence normalizer should reject hexadecimal confidence strings');

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

const formattedJson = parseEvidenceText([
    '[',
    '  {',
    '    "title": "格式化数组证据",',
    '    "type": "traffic",',
    '    "confidence": "0.64"',
    '  },',
    '  {',
    '    "title": "格式化数组证据二",',
    '    "type": "basemap"',
    '  }',
    ']',
].join('\n'));
assert(formattedJson.length === 2 && typeof formattedJson[0] === 'object' && (formattedJson[0] as EvidenceSource).confidence === 0.64, 'evidence text parser should accept formatted JSON arrays');

const emptyJson = parseEvidenceText('[]');
assert(emptyJson.length === 0, 'empty JSON evidence arrays should stay empty');

const legacyCarriageReturns = parseEvidenceText('CR 证据一\rCR 证据二');
assert(legacyCarriageReturns.length === 2, 'evidence parser should split legacy carriage-return lines');
assert(parseEvidenceText(null as unknown as string).length === 0, 'evidence parser should tolerate non-string text');
assert(formatEvidenceForEditing('bad' as unknown as []).length === 0, 'evidence formatter should tolerate malformed item collections');
assert(evidenceSearchText('bad' as unknown as []).length === 0, 'evidence search should tolerate malformed item collections');
assert(formatEvidenceForEditing([null, '有效证据'] as unknown as EvidenceItem[]) === '有效证据', 'evidence formatter should skip malformed entries');
assert(evidenceSearchText([null, { title: '有效调研', type: 'survey' }] as unknown as EvidenceItem[]).includes('调研/空间数据'), 'evidence search should skip malformed entries');
assert(evidenceKind(null as unknown as EvidenceItem) === '其他证据', 'evidence kind should tolerate malformed entries');
assert(evidenceCompletenessScore(null as unknown as EvidenceItem) === 0, 'evidence score should tolerate malformed entries');
assert(evidenceCompletenessScore({} as unknown as EvidenceItem) === 0, 'evidence score should reject untitled structured entries');

console.log('evidence smoke passed');
