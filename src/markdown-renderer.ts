import { splitMarkdownTableRow } from './markdown-table';

export function renderModalContent(text: string, defaultName: string): string {
    if (!defaultName.toLowerCase().endsWith('.md')) return `<pre class="modal-raw">${escapeHtml(text)}</pre>`;
    return markdownToHtml(text);
}

export function markdownToHtml(markdown: string): string {
    const lines = markdown.split('\n');
    const html: string[] = [];
    let inList = false;
    let inCode = false;
    let codeLines: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.startsWith('```')) {
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
            while (index < lines.length && lines[index].trim().startsWith('|')) {
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
        if (line.startsWith('- ')) {
            if (!inList) {
                html.push('<ul>');
                inList = true;
            }
            html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
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
