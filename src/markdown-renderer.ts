import { splitMarkdownTableRow } from './markdown-table';

export function renderModalContent(text: string, defaultName: string): string {
    const source = String(text ?? '');
    const name = String(defaultName ?? '');
    if (!name.toLowerCase().endsWith('.md')) return `<pre class="modal-raw">${escapeHtml(source)}</pre>`;
    return markdownToHtml(source);
}

export function markdownToHtml(markdown: string): string {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const html: string[] = [];
    let inList = false;
    let inCode = false;
    let codeLines: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/^\s{0,3}```/.test(line)) {
            if (inCode) {
                html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                codeLines = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            continue;
        }
        if (isMarkdownTableStart(lines, index)) {
            closeList();
            const tableLines: string[] = [];
            const expectedCells = splitMarkdownTableRow(lines[index]).length;
            while (index < lines.length && isMarkdownTableRow(lines[index], expectedCells)) {
                tableLines.push(lines[index]);
                index++;
            }
            index--;
            html.push(markdownTableToHtml(tableLines));
            continue;
        }
        const heading = /^(#{1,4})\s+(.+)$/.exec(line);
        if (heading) {
            closeList();
            const level = heading[1].length;
            html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }
        const listItem = /^\s{0,3}-\s+(.+)$/.exec(line);
        if (listItem) {
            if (!inList) {
                html.push('<ul>');
                inList = true;
            }
            html.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
            continue;
        }
        if (!line.trim()) {
            closeList();
            continue;
        }
        closeList();
        html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
    if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    closeList();
    return html.join('');

    function closeList() {
        if (!inList) return;
        html.push('</ul>');
        inList = false;
    }
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
    const header = lines[index]?.trim() ?? '';
    const separator = lines[index + 1]?.trim() ?? '';
    if (!header.startsWith('|') || !separator.startsWith('|')) return false;
    const headerCells = splitMarkdownTableRow(header);
    const separatorCells = splitMarkdownTableRow(separator);
    return headerCells.length > 0
        && separatorCells.length === headerCells.length
        && separatorCells.every(isMarkdownTableSeparatorCell);
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
    return /^:?-{3,}:?$/.test(cell.trim());
}

function isMarkdownTableRow(line: string, expectedCells: number): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && splitMarkdownTableRow(trimmed).length === expectedCells;
}

function markdownTableToHtml(lines: string[]): string {
    const rows = lines
        .filter((line, index) => index !== 1)
        .map(line => splitMarkdownTableRow(line).map(cell => inlineMarkdown(cell)));
    const [header = [], ...body] = rows;
    return [
        '<table>',
        '<thead><tr>',
        ...header.map(cell => `<th>${cell}</th>`),
        '</tr></thead>',
        '<tbody>',
        ...body.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`),
        '</tbody></table>',
    ].join('');
}

function inlineMarkdown(text: string): string {
    return text.split(/(`[^`]+`)/g).map((part) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
            return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        }
        return escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }).join('');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
