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
    const title = text(record.title ?? record.name ?? record.source);
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
    const items: EvidenceItem[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('{')) {
            try {
                const parsed = normalizeEvidenceItem(JSON.parse(line));
                if (parsed) {
                    items.push(parsed);
                    continue;
                }
            } catch {}
        }
        for (const part of line.split(/[；;]/).map(value => value.trim()).filter(Boolean)) {
            const parsed = normalizeEvidenceItem(part);
            if (parsed) items.push(parsed);
        }
    }
    return items;
}

export function formatEvidenceForEditing(items: EvidenceItem[] = []): string {
    return items.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
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
    return items.map(item => {
        if (typeof item === 'string') return item;
        return [
            item.title,
            item.type,
            item.collectedAt,
            item.precision,
            item.license,
            item.url,
            item.note,
        ].filter(Boolean).join(' ');
    }).join(' ');
}

export function evidenceKind(item: EvidenceItem): string {
    if (typeof item !== 'string' && item.type) return TYPE_LABELS[String(item.type)] ?? String(item.type);
    const text = typeof item === 'string' ? item : item.title;
    if (/GB|CJJ|规范|标准|导则|指南|控规|法定|修订|条例/.test(text)) return '规范/规划依据';
    if (/调研|实测|现场|访谈|问卷|遥感|手机信令|POI|路网|底图|测绘/.test(text)) return '调研/空间数据';
    if (/演示|样例|原型|兼容层|用户|课程/.test(text)) return '原型/用户输入';
    return '其他证据';
}

export function evidenceCompletenessScore(item: EvidenceItem): number {
    if (typeof item === 'string') return 55;
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
    return text(asRecord(item)?.title).length > 0;
}

export function confidencePercent(value: number): number {
    return value <= 1 ? Math.round(value * 100) : Math.round(clamp(value, 0, 100));
}

function formatConfidence(value: number): string {
    return `${confidencePercent(value)}%`;
}

function copyText(source: AnyRecord, target: EvidenceSource, key: keyof EvidenceSource) {
    const value = text(source[key]);
    if (value) (target as Record<string, unknown>)[key] = value;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function numberOrUndefined(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function asRecord(value: unknown): AnyRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
