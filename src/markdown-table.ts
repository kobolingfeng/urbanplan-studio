export function markdownTableRow(cells: readonly unknown[]): string {
    const safeCells = Array.isArray(cells) ? cells : [];
    return `| ${safeCells.map(markdownTableCell).join(' | ')} |`;
}

export function markdownTableCell(value: unknown): string {
    return String(value ?? '')
        .replace(/\r?\n/g, ' / ')
        .replace(/\|/g, '\\|')
        .trim();
}

export function splitMarkdownTableRow(line: string): string[] {
    const trimmed = (typeof line === 'string' ? line : String(line ?? '')).trim();
    const content = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const bounded = content.endsWith('|') ? content.slice(0, -1) : content;
    const cells: string[] = [];
    let cell = '';

    for (let index = 0; index < bounded.length; index++) {
        const char = bounded[index];
        const next = bounded[index + 1];
        if (char === '\\' && next === '|') {
            cell += '|';
            index++;
        } else if (char === '|') {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += char;
        }
    }
    cells.push(cell.trim());
    return cells;
}
