import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markdownRichText,richTextMarkdown,agentRichText} from '../src/agent-markdown.js';

test('record text reads back in the Markdown it was written in',()=>{
 const source='Both stages run from 250 V.\nThe heaters use 12 V.\n\n### Stage 1\n\n- **Input coupling:** 22 nF\n- *Grid* `leak`: [notes](https://example.org)\n\n1. first\n2. second\n\n> A quoted remark\n\n```js\nx=1\n```';
 const doc=markdownRichText(source);
 assert.equal(richTextMarkdown(doc),source);
 assert.deepEqual(markdownRichText(richTextMarkdown(doc)),doc);
});

test('text sent back unchanged keeps what Markdown cannot express; changed text is read as Markdown',()=>{
 const stored={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before the figure.'}]},{type:'book_figure',attrs:{version:1,id:'f1',figureId:'figure-1',alternative:'Gain curve'}}]};
 const read=richTextMarkdown(stored);
 assert.match(read,/^Before the figure\.\n\n\[book figure: /);
 assert.equal(agentRichText(read,stored),stored);
 assert.deepEqual(agentRichText('New text.',stored),markdownRichText('New text.'));
 assert.deepEqual(agentRichText('New text.',undefined),markdownRichText('New text.'));
});
