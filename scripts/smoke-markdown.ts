import { markdownTableRow, splitMarkdownTableRow } from '../src/markdown-table';
import { markdownToHtml, renderModalContent } from '../src/markdown-renderer';

function fail(message: string): never {
    console.error(`smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const markdown = [
    '# 安全报告 <script>alert(1)</script>',
    '',
    '- **强制项**：`<img src=x onerror=alert(1)>`',
    '- `**literal**` and **bold**',
    '',
    '| 字段 | 值 |',
    '|---|---|',
    '| name | <b onclick=alert(1)>地块</b> |',
    '',
    '```',
    '<script>alert("x")</script>',
    '```',
].join('\n');

const html = markdownToHtml(markdown);
assert(html.includes('<h1>安全报告 &lt;script&gt;alert(1)&lt;/script&gt;</h1>'), 'heading text should be escaped');
assert(html.includes('<strong>强制项</strong>'), 'strong inline markdown should render');
assert(html.includes('<code>&lt;img src=x onerror=alert(1)&gt;</code>'), 'inline code should be escaped');
assert(html.includes('<code>**literal**</code> and <strong>bold</strong>'), 'inline code should not render nested bold');
assert(html.includes('<table>') && html.includes('<td>&lt;b onclick=alert(1)&gt;地块&lt;/b&gt;</td>'), 'table cells should be escaped');
assert(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'), 'code blocks should be escaped');
assert(!html.includes('<script>') && !html.includes('<img'), 'markdown renderer should not emit raw unsafe tags');

const raw = renderModalContent('<svg onload=alert(1)>', 'export.CSV');
assert(raw === '<pre class="modal-raw">&lt;svg onload=alert(1)&gt;</pre>', 'raw modal content should be escaped case-insensitively');

const escapedRow = markdownTableRow(['A|B', 'line 1\nline 2', '<unsafe>']);
assert(escapedRow === '| A\\|B | line 1 / line 2 | <unsafe> |', 'table row helper should escape pipes and flatten newlines');
assert(markdownTableRow('bad' as unknown as unknown[]) === '|  |', 'table row helper should tolerate malformed cell collections');
const split = splitMarkdownTableRow(escapedRow);
assert(split.length === 3 && split[0] === 'A|B' && split[1] === 'line 1 / line 2', 'table row splitter should preserve escaped pipes');
const tableHtml = markdownToHtml(['| 字段 | 值 | 备注 |', '|---|---|---|', escapedRow].join('\n'));
assert(tableHtml.includes('<td>A|B</td>') && tableHtml.includes('<td>&lt;unsafe&gt;</td>'), 'escaped table rows should render as safe table cells');

const alignedTable = markdownToHtml(['| 左 | 右 |', '|:---|---:|', '| a | b |'].join('\n'));
assert(alignedTable.includes('<table>') && alignedTable.includes('<td>a</td>'), 'aligned markdown separators should still render tables');

const loosePipes = markdownToHtml(['| just a paragraph |', '| maybe --- text |'].join('\n'));
assert(!loosePipes.includes('<table>'), 'pipe paragraphs with loose dashes should not render as a table');
assert(loosePipes.includes('<p>| just a paragraph |</p>'), 'loose pipe lines should remain paragraphs');

const boundedTable = markdownToHtml(['| A | B |', '|---|---|', '| 1 | 2 |', '| not table |'].join('\n'));
assert(boundedTable.includes('<td>1</td><td>2</td>'), 'matching table rows should render');
assert(boundedTable.includes('<p>| not table |</p>'), 'mismatched pipe rows after a table should stay paragraphs');

const crlfMarkdown = markdownToHtml('## Windows Title\r\n  - indented item\r\n- second item\r\n  ```\r\n  <unsafe>\r\n  ```');
assert(crlfMarkdown.includes('<h2>Windows Title</h2>'), 'markdown renderer should normalize CRLF line endings');
assert(crlfMarkdown.includes('<li>indented item</li>') && crlfMarkdown.includes('<li>second item</li>'), 'markdown renderer should accept lightly indented list items');
assert(crlfMarkdown.includes('&lt;unsafe&gt;'), 'markdown renderer should accept lightly indented code fences safely');

console.log('markdown smoke passed');
