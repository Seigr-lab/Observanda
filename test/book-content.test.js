import {richBook,block} from './book-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validRichText,renderRichText,richTextPlain} from '../src/web/rich-text-model.js';
import {researchReference,parseResearchReference,validTarget} from '../src/web/research-reference.js';
import {selectorExists,selectorAnchor} from '../src/web/book-selectors.js';
import {validateNotebook} from '../src/model.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {assertPublicFiles} from '../src/privacy.js';
import {PUBLIC_BOOK_SCRIPT} from '../src/publication-browse.js';
import {importContent} from '../src/migration/content.js';
import {recordRevision} from '../src/research.js';
import {queryRecords,recordBrowse} from '../src/web/record-query.js';
import {recordCounts} from '../src/web/record-workflow.js';
import {validViewQuery} from '../src/web/record-view-model.js';
test('book blocks keep exact text, inert MathML, tables, citations and strict versioned contracts',()=>{
 const {book,concept}=richBook();validateNotebook(book);assert.ok(validRichText(concept.body));const html=renderRichText(concept.body);assert.match(html,/<math/);assert.match(html,/9007199254740993/);assert.match(html,/scope="col"/);assert.match(html,/  EMIT 105\n\tFORM 0005  \n/);assert.match(html,/data-language="My apparatus language"/);assert.ok(!html.includes('<script'));
 for(const source of [String.raw`\href{javascript:alert(1)}{x}`,String.raw`\includegraphics{https://example.org/secret}`,String.raw`\def\loop{\loop}\loop`]){const result=renderRichText({type:'doc',content:[block('equation',{source,label:'Untrusted source'})]});assert.ok(!/<a\b|<img\b|<script\b/.test(result));}
 for(const mutate of [d=>d.content[1].attrs.version=2,d=>d.content[1].attrs.rows[0].push('extra'),d=>d.content[1].attrs.rows[0][0]='x'.repeat(60001),d=>d.content[3].attrs.url='javascript:alert(1)',d=>d.content[1].attrs.onclick='alert(1)',d=>d.content.push(d.content[1])]){const d=structuredClone(concept.body);mutate(d);assert.equal(validRichText(d),false);}
});
test('versioned selectors survive names and ordering, retain unavailable identities and export selected targets',()=>{
 const {book,concept,experiment,table}=richBook(),target=experiment.relations[0].target,ref=researchReference(target);assert.deepEqual(parseResearchReference(ref),target);assert.ok(validTarget({...target,revision:recordRevision(concept)}));assert.equal(parseResearchReference(ref.replace('#v1-','#v2-')),null);
 concept.title='Renamed definition';concept.body.content.reverse();table.attrs.title='Renamed table';assert.ok(selectorExists(concept,target.selector));const output=buildPublication(book);verifyPublication(output);const html=output.files.get('entries/'+experiment.id+'.html');assert.ok(html.includes(concept.id+'.html#'+selectorAnchor(target.selector)));assert.ok(output.files.get('entries/'+concept.id+'.html').includes('Referenced by'));
 concept.body.content=concept.body.content.filter(n=>n!==table);assert.equal(selectorExists(concept,target.selector),false);const absent=buildPublication(book);assert.ok(!absent.files.get('entries/'+experiment.id+'.html').includes('#record-table-'+table.attrs.id));
 concept.share=false;const hidden=buildPublication(book);assert.ok(!hidden.files.get('browse.html').includes(concept.id));assert.ok(!hidden.files.get('entries/'+experiment.id+'.html').includes(concept.title));assert.throws(()=>assertPublicFiles(new Map([['public-book.js',PUBLIC_BOOK_SCRIPT+'\nalert(1)']])),{code:'UNSAFE'});
});
test('reading journeys are filters over original records with saved-query semantics and unchanged counts',()=>{
 const {book,concept}=richBook();const result=queryRecords(book.entries,{browse:{journey:'concepts'}});assert.deepEqual(result.map(r=>r.id),[concept.id]);assert.equal(recordCounts(result).experiments,0);assert.equal(new Set(book.entries.map(r=>r.id)).size,book.entries.length);
 assert.ok(validViewQuery({projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse({journey:'concepts',tags:'one',sort:'title'})}));
});
test('structured HTML import preserves code, maps UTF-8 source ranges, and keeps unsupported blocks verbatim',async()=>{
 const source='<section id="chapter"><h2>\u00c9quation</h2><pre><code class="language-native-six">  EMIT 105\n\tJOIN 0001  \n</code></pre><table><caption>Readings</caption><tr><th>Code</th><th>Value</th></tr><tr><td>005</td><td>9007199254740993</td></tr></table><svg><path d="M1 2"/></svg><script>throw Error("NEVER")</script></section>',bytes=Buffer.from(source),file={sha256:createHash('sha256').update(bytes).digest('hex'),selector:{kind:'anchor',value:'chapter'}},content={size:bytes.length,async *read(start,end){yield bytes.subarray(start,end+1);}};
 const a=await importContent(content,file,'html-book'),b=await importContent(content,file,'html-book');assert.deepEqual(a,b);assert.ok(validRichText(a.body));assert.equal(a.body.content[1].attrs.language,'native-six');assert.equal(a.body.content[1].content[0].text,'  EMIT 105\n\tJOIN 0001  \n');assert.equal(a.body.content[2].attrs.rows[0][1],'9007199254740993');assert.equal(a.body.content[3].attrs.source,'<svg><path d="M1 2"/></svg>');assert.equal(a.omitted.length,2);
 for(const m of a.mappings)assert.ok(bytes.subarray(m.offset,m.offset+m.length).toString().startsWith('<'));
 assert.ok(a.mappings.some(m=>m.kind==='table'));assert.ok(!renderRichText(a.body).includes('<script>'));assert.match(richTextPlain(a.body),/NEVER/);
 for(const fragment of ['<table><tr style="display:none"><th>Hidden</th></tr><tr><td>Secret</td></tr></table>','<table><tr><th>A</th></tr><tr><td><strong>Marked value</strong></td></tr></table>','<p>Read <a href="javascript:alert(1)">source</a></p>']){
  const input=Buffer.from('<section id="chapter">'+fragment+'</section>'),file={sha256:createHash('sha256').update(input).digest('hex'),selector:{kind:'anchor',value:'chapter'}},result=await importContent({size:input.length,async *read(start,end){yield input.subarray(start,end+1);}},file,'html-book');
  assert.equal(result.body.content[0].type,'book_preserved');assert.equal(result.body.content[0].attrs.source,fragment);assert.equal(result.omitted.length,1);
 }
});
