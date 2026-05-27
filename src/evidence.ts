type AnyRecord = Record<string, unknown>;

export type EvidenceSourceType =
    | 'regulation'
    | 'planning'
    | 'survey'
    | 'basemap'
    | 'poi'
    | 'remote_sensing'
    | 'traffic'
    | 'community'
    | 'user_input'
    | 'prototype'
    | 'other';

export type EvidenceSource = {
    title: string;
    type?: EvidenceSourceType | string;
    collectedAt?: string;
    precision?: string;
    confidence?: number;
    license?: string;
    url?: string;
    note?: string;
};

export type EvidenceItem = string | EvidenceSource;

const TYPE_LABELS: Record<string, string> = {
    regulation: '规范/规划依据',
    planning: '规范/规划依据',
    survey: '调研/空间数据',
    basemap: '调研/空间数据',
    poi: '调研/空间数据',
    remote_sensing: '调研/空间数据',
    traffic: '调研/空间数据',
    community: '调研/空间数据',
    user_input: '原型/用户输入',
    prototype: '原型/用户输入',
    other: '其他证据',
};

export function normalizeEvidenceList(value: unknown, fallback: EvidenceItem[] = []): EvidenceItem[] {
    if (!Array.isArray(value)) return fallback;
    const items = value.map(normalizeEvidenceItem).filter((item): item is EvidenceItem => Boolean(item));
    return items.length ? items : fallback;
}

export function normalizeEvidenceItem(value: unknown): EvidenceItem | undefined {
    if (typeof value === 'string') {
        const text = value.trim();
        return text ? text : undefined;
    }
    const record = asRecord(value);
    if (!record) return undefined;
    const title = textOrEmpty(record.title ?? record.name ?? record.source);
    if (!title) return undefined;
    const item: EvidenceSource = { title };
    copyText(record, item, 'type');
    copyText(record, item, 'collectedAt');
    copyText(record, item, 'precision');
    copyText(record, item, 'license');
    copyText(record, item, 'url');
    copyText(record, item, 'note');
    const confidence = numberOrUndefined(record.confidence);
    if (confidence !== undefined) {
        item.confidence = clamp(confidence, 0, confidence > 1 ? 100 : 1);
    }
    return item;
}

export function parseEvidenceText(text: string): EvidenceItem[] {
    const source = String(text ?? '');
    const jsonBlock = parseEvidenceJson(source.trim());
    if (jsonBlock) return jsonBlock;

    const items: EvidenceItem[] = [];
    for (const rawLine of source.split(/\r\n?|\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('{') || line.startsWith('[')) {
            const parsedItems = parseEvidenceJson(line);
            if (parsedItems) {
                items.push(...parsedItems);
                continue;
            }
        }
        for (const part of line.split(/[；;]/).map(value => value.trim()).filter(Boolean)) {
            const parsed = normalizeEvidenceItem(part);
            if (parsed) items.push(parsed);
        }
    }
    return items;
}

function parseEvidenceJson(text: string): EvidenceItem[] | undefined {
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return undefined;
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed.flatMap(item => {
                const normalized = normalizeEvidenceItem(item);
                return normalized ? [normalized] : [];
            });
        }
        const normalized = normalizeEvidenceItem(parsed);
        return normalized ? [normalized] : [];
    } catch {
        return undefined;
    }
}

export function formatEvidenceForEditing(items: EvidenceItem[] = []): string {
    const safeItems = evidenceItems(items);
    return safeItems.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
}

export function evidenceDisplayText(item: EvidenceItem): string {
    if (typeof item === 'string') return item;
    const meta = [
        item.type ? evidenceKind(item) : '',
        item.collectedAt ?? '',
        item.precision ?? '',
        typeof item.confidence === 'number' ? `可信度 ${formatConfidence(item.confidence)}` : '',
    ].filter(Boolean);
    return meta.length ? `${item.title}（${meta.join('，')}）` : item.title;
}

export function evidenceSearchText(items: EvidenceItem[] = []): string {
    const safeItems = evidenceItems(items);
    return safeItems.map(item => {
        if (typeof item === 'string') return item;
        return [
            item.title,
            item.type,
            evidenceKind(item),
            item.collectedAt,
            item.precision,
            typeof item.confidence === 'number' ? formatConfidence(item.confidence) : '',
            item.license,
            item.url,
            item.note,
        ].filter(Boolean).join(' ');
    }).join(' ');
}

export function evidenceKind(item: EvidenceItem): string {
    const record = asRecord(item);
    if (record?.type) {
        const key = String(record.type).trim().toLowerCase().replace(/[\s-]+/g, '_');
        return TYPE_LABELS[key] ?? String(record.type);
    }
    const text = typeof item === 'string' ? item : textOrEmpty(record?.title);
    if (/GB|CJJ|规范|标准|导则|指南|控规|法定|修订|条例/.test(text)) return '规范/规划依据';
    if (/调研|实测|现场|访谈|问卷|遥感|手机信令|POI|路网|底图|测绘/.test(text)) return '调研/空间数据';
    if (/演示|样例|原型|兼容层|用户|课程/.test(text)) return '原型/用户输入';
    return '其他证据';
}

export function evidenceCompletenessScore(item: EvidenceItem): number {
    if (typeof item === 'string') return 55;
    if (!asRecord(item) || !textOrEmpty(item.title)) return 0;
    const confidenceScore = typeof item.confidence === 'number' ? confidencePercent(item.confidence) : 65;
    const metadataScore = [
        item.title,
        item.type,
        item.collectedAt,
        item.precision,
        item.license,
    ].filter(Boolean).length / 5 * 100;
    return Math.round(metadataScore * 0.65 + confidenceScore * 0.35);
}

export function isStructuredEvidence(item: unknown): item is EvidenceSource {
    return textOrEmpty(asRecord(item)?.title).length > 0;
}

export function confidencePercent(value: number): number {
    const finite = Number.isFinite(value) ? value : 0;
    const percent = finite <= 1 ? finite * 100 : finite;
    return Math.round(clamp(percent, 0, 100));
}

function formatConfidence(value: number): string {
    return `${confidencePercent(value)}%`;
}

function copyText(source: AnyRecord, target: EvidenceSource, key: keyof EvidenceSource) {
    const value = textOrEmpty(source[key]);
    if (value) (target as Record<string, unknown>)[key] = value;
}

function evidenceItems(value: unknown): EvidenceItem[] {
    return Array.isArray(value)
        ? value.flatMap(item => {
            const normalized = normalizeEvidenceItem(item);
            return normalized ? [normalized] : [];
        })
        : [];
}

function textOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function numberOrUndefined(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const text = value.trim();
        const percentSuffixed = text.endsWith('%');
        const numericText = percentSuffixed ? text.slice(0, -1).trim() : text;
        if (!decimalNumberPattern.test(numericText)) return undefined;
        const parsed = Number(numericText);
        if (Number.isFinite(parsed)) return percentSuffixed && parsed <= 1 ? parsed / 100 : parsed;
    }
    return undefined;
}

const decimalNumberPattern = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/;

function asRecord(value: unknown): AnyRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
