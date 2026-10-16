import {upgradeRecord} from '../src/web/record-model.js';
import {legacyRecords} from './legacy-records.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {plainRichText,richTextPlain,validRichText,renderRichText,safeRichLink} from '../src/web/rich-text-model.js';
import {validateNotebook,upgradeNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication} from '../src/publication.js';
const link=(href,target='_blank')=>({type:'link',attrs:{href,title:'Evidence & methods',target,nofollow:true}});
const section=richText=>({id:'rich',kind:'text',title:'Methods',show:true,format:'rich',body:richTextPlain(richText),richText});

test('legacy plain text retains paragraph and line breaks in the structured model and static renderer',()=>{
 const doc=plainRichText('First line\nSecond line\n\nAnother paragraph');assert.ok(validRichText(doc));assert.match(renderRichText(doc),/<p>First line<br>Second line<\/p><p>Another paragraph<\/p>/);
 const legacy=legacyRecords(sampleNotebook());legacy.formatVersion=8;delete legacy.website.typography;delete legacy.website.presentation;delete legacy.website.palette;const bytes=JSON.stringify(legacy),upgraded=upgradeNotebook(legacy);assert.equal(JSON.stringify(legacy),bytes);assert.equal(upgraded.formatVersion,21);assert.deepEqual(upgraded.entries,legacy.entries.map(upgradeRecord));
});

test('rich schema rejects executable content, arbitrary attributes, invalid sizes and unsafe links',()=>{
 for(const href of ['javascript:alert(1)','data:text/html,abc','file:///private','https://user:secret@example.org','https://a.test/\nscript','//example.org'])assert.equal(safeRichLink(href),false,href);
 for(const href of ['https://example.org','http://localhost:8080','mailto:lab@example.org','tel:+4700000000','#methods','home'])assert.equal(safeRichLink(href),true,href);
 for(const mutate of [d=>d.content[0].attrs={onclick:'alert(1)'},d=>d.content[0].content[0].marks=[link('javascript:alert(1)')],d=>d.content[0].content[0].marks=[{type:'text_size',attrs:{size:1000}}],d=>d.content[0].content.push({type:'image',attrs:{src:'https://example.org/tracker'}}),d=>d.content[0].content[0].marks=[{type:'strong',attrs:{style:'color:red'}}]]){const d=plainRichText('safe');mutate(d);assert.equal(validRichText(d),false);const b=sampleNotebook();b.website.home.sections=[section(d)];assert.throws(()=>validateNotebook(b));}
 const deep=plainRichText('safe');let n=deep.content[0];for(let i=0;i<30;i++)n={type:'blockquote',content:[n]};assert.equal(validRichText({type:'doc',content:[n]}),false);
});

test('formatted content and safe link behaviour survive publication while excluded internal destinations never become links',()=>{
 const b=sampleNotebook(),privateId=randomUUID();b.pages.push({id:privateId,title:'Private method',body:'Private evidence',share:false});
 const doc=plainRichText('<script>not executable</script>');doc.content[0].attrs={align:'center'};doc.content[0].content[0].marks=[{type:'strong'},{type:'text_size',attrs:{size:28}},link('https://example.org/method')];doc.content.push({type:'paragraph',content:[{type:'text',text:'Excluded link',marks:[link('page:'+privateId)]}]});
 b.website.home.sections=[section(doc),{id:'action',kind:'link',show:true,title:'',href:'https://example.org',label:'External method',body:'',linkTarget:'_blank',linkTitle:'Methods',linkNoFollow:true}];validateNotebook(b);const rendered=buildPublication(b).files.get('index.html');
 assert.match(rendered,/&lt;script&gt;not executable&lt;\/script&gt;/);assert.match(rendered,/class="rt-size-28"/);assert.match(rendered,/target="_blank" title="Evidence &amp; methods" rel="noopener noreferrer nofollow"/);assert.match(rendered,/class="rt-align-center"/);assert.ok(!rendered.includes(privateId));assert.ok(rendered.includes('Excluded link'));assert.match(rendered,/target="_blank" title="Methods" rel="noopener noreferrer nofollow"/);assert.ok(!rendered.includes('contenteditable'));
 b.formatVersion=8;assert.throws(()=>validateNotebook(b));
});


test('format 9 migrates website typography without changing source records or theme, with safe style export',()=>{
 const legacy=legacyRecords(sampleNotebook());legacy.formatVersion=9;delete legacy.website.typography;delete legacy.website.presentation;delete legacy.website.palette;const before=JSON.stringify(legacy),book=upgradeNotebook(legacy);assert.equal(JSON.stringify(legacy),before);assert.equal(book.formatVersion,21);assert.deepEqual(book.website.typography,{});assert.deepEqual(book.appearance,legacy.appearance);
 const rich=plainRichText('Safe styled text');rich.content[0].content[0].marks=[{type:'font_family',attrs:{font:'source-serif'}},{type:'text_color',attrs:{color:'#993344'}},{type:'highlight',attrs:{color:'#fff2a8'}},{type:'subscript'}];book.website.home.sections=[section(rich)];book.website.typography={font:'space-grotesk',fontSize:24,headingScale:1.25,lineHeight:1.8};validateNotebook(book);const files=buildPublication(book).files;assert.match(files.get('styles.css'),/--body-size:24px/);assert.match(files.get('styles.css'),/\.rt-color-993344\{color:#993344\}/);assert.ok(files.has('fonts/source-serif.ttf'));assert.match(files.get('index.html'),/<sub>/);assert.equal(validRichText(rich,{extended:false}),false);
 for(const value of [{font:'remote-font'},{fontSize:NaN},{letterSpacing:100},{color:'red'},{headingScale:0}]){const b=structuredClone(book);b.website.typography=value;assert.throws(()=>validateNotebook(b));}
 for(const attrs of [{color:'red'},{color:'#993344;display:none'},{color:'url(https://example.org)'},{color:'#ffffff',onclick:'x'}]){const d=plainRichText('Invalid');d.content[0].content[0].marks=[{type:'text_color',attrs}];assert.equal(validRichText(d),false);}
});

test('explicit design targets preview only the chosen private scope and never change publication flags',()=>{
 const book=sampleNotebook();for(const p of book.projects)p.share=false;for(const e of book.entries)e.share=false;const before=JSON.stringify(book),chosen=book.entries[0];const files=buildPublication(book,{designTarget:'entry:'+chosen.id}).files;assert.ok(files.has('entries/'+chosen.id+'.html'));for(const other of book.entries.slice(1))assert.ok(!files.has('entries/'+other.id+'.html'));assert.equal(JSON.stringify(book),before);assert.ok(!buildPublication(book).files.has('entries/'+chosen.id+'.html'));assert.throws(()=>buildPublication(book,{designTarget:'entry:'+randomUUID()}));
});
