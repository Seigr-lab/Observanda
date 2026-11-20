import {formattedText} from '../src/web/formatted-text.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('formatted blocks escape HTML, reject executable links, and preserve lists and code',()=>{
 const html=formattedText('## Method\n\n**Bold** and *emphasis*\n\n- One\n- Two\n\n<script>alert(1)</script>\n\n[Safe](https://example.org) [Unsafe](javascript:alert(1))\n\n```\n<tag>\n```','markdown');assert.match(html,/<h3>Method<\/h3>/);assert.match(html,/<ul><li>One<\/li><li>Two<\/li><\/ul>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|href="javascript/);assert.match(html,/<pre><code>&lt;tag&gt;/);
});

