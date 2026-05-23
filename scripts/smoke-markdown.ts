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
assert(html.includes('<table>') && html.includes('<td>&lt;b onclick=alert(1)&gt;地块&lt;/b&gt;</td>'), 'table cells should be escaped');
assert(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'), 'code blocks should be escaped');
assert(!html.includes('<script>') && !html.includes('<img'), 'markdown renderer should not emit raw unsafe tags');

const raw = renderModalContent('<svg onload=alert(1)>', 'export.CSV');
assert(raw === '<pre class="modal-raw">&lt;svg onload=alert(1)&gt;</pre>', 'raw modal content should be escaped case-insensitively');

console.log('markdown smoke passed');
