import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {plainRichText,richTextPlain,validRichText,safeRichLink} from '../src/web/rich-text-model.js';
import {sampleNotebook} from '../src/sample.js';
const link=(href,target='_blank')=>({type:'link',attrs:{href,title:'Evidence & methods',target,nofollow:true}});
const section=richText=>({id:'rich',kind:'text',title:'Methods',show:true,format:'rich',body:richTextPlain(richText),richText});

test('rich schema rejects executable content, arbitrary attributes, invalid sizes and unsafe links',()=>{
 for(const href of ['javascript:alert(1)','data:text/html,abc','file:///private','https://user:secret@example.org','https://a.test/\nscript','//example.org'])assert.equal(safeRichLink(href),false,href);
 for(const href of ['https://example.org','http://localhost:8080','mailto:lab@example.org','tel:+4700000000','#methods','home'])assert.equal(safeRichLink(href),true,href);
 for(const mutate of [d=>d.content[0].attrs={onclick:'alert(1)'},d=>d.content[0].content[0].marks=[link('javascript:alert(1)')],d=>d.content[0].content[0].marks=[{type:'text_size',attrs:{size:1000}}],d=>d.content[0].content.push({type:'image',attrs:{src:'https://example.org/tracker'}}),d=>d.content[0].content[0].marks=[{type:'strong',attrs:{style:'color:red'}}]]){const d=plainRichText('safe');mutate(d);assert.equal(validRichText(d),false);}
 const deep=plainRichText('safe');let n=deep.content[0];for(let i=0;i<30;i++)n={type:'blockquote',content:[n]};assert.equal(validRichText({type:'doc',content:[n]}),false);
});

