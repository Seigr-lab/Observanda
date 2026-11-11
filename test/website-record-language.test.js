import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localizedRecordPage,recordDateText,recordMessages,readableDay} from '../src/website-record-language.js';
import {resultStatementsView} from '../src/web/result-statements.js';
import {websiteSearchFields} from '../src/website-file-library-fields.js';
import {parseFragment} from 'parse5';

const id='a'.repeat(64),rev='b'.repeat(64);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fragment='<section data-observanda-part="title"><h2>Brood check</h2></section><article class="record-page">'+
 '<div class="entry-meta" data-observanda-part="metadata"><span>observation</span><time datetime="2026-03-01">2026-03-01</time><span>in progress</span></div>'+
 '<p data-observanda-part="outcome"><strong data-observanda-label="websiteRecordText:outcome">Outcome</strong>: Queen seen</p>'+
 '<ul class="record-contributors" aria-label="Contributors" data-observanda-part="contributors"><li>Ada</li></ul>'+
 '<section class="record-related" data-observanda-part="relations"><h2 data-observanda-label="websiteRecordText:relatedResearch">Related research</h2><ul><li><span data-observanda-term="relation">Builds on</span>: <a href="#">Earlier check</a></li></ul></section>'+
 '<ul class="tags" aria-label="Tags" data-observanda-part="tags"><li>observation</li></ul></article>';
const page=(lang,body)=>'<!doctype html><html lang="'+lang+'"><head><title>T</title></head><body><main><p><span>observation</span> stays authored</p>'+body+'</main></body></html>';
const placed=html=>'<section data-observanda-source="'+id+'" data-observanda-source-revision="'+rev+'">'+html+'</section>';

test('a placed record shows its renderer labels and recognised values in the page language',()=>{
 const html=localizedRecordPage(page('ca',placed(fragment)));
 assert.match(html,/<span data-observanda-value="observation">Observació<\/span>/);
 assert.match(html,/<span data-observanda-value="in progress">en curs<\/span>/);
 assert.match(html,new RegExp('<time datetime="2026-03-01">'+readableDay('2026-03-01','ca')+'</time>'));
 assert.match(html,/<strong data-observanda-label="websiteRecordText:outcome">Resultat<\/strong>: Queen seen/);
 assert.match(html,/aria-label="Col·laboradors"/);
 assert.match(html,/aria-label="Etiquetes"/);
 assert.match(html,/>Recerca relacionada</);
 assert.match(html,/<span data-observanda-term="relation" data-observanda-value="Builds on">Es basa en<\/span>/);
 // Authored text and tag values are never translated.
 assert.match(html,/<p><span>observation<\/span> stays authored<\/p>/);
 assert.match(html,/<li>observation<\/li>/);
 assert.match(html,/<li>Ada<\/li>/);
});

test('localization is idempotent and follows a later change of the page language',()=>{
 const catalan=localizedRecordPage(page('ca',placed(fragment)));
 assert.equal(localizedRecordPage(catalan),catalan);
 const spanish=localizedRecordPage(catalan.replace('lang="ca"','lang="es"'));
 assert.match(spanish,/data-observanda-value="observation">Observación</);
 assert.match(spanish,/data-observanda-value="in progress">en curso</);
 assert.match(spanish,/data-observanda-value="Builds on">Se basa en</);
 assert.match(spanish,/>Resultado<\/strong>/);
 assert.equal(localizedRecordPage(spanish),spanish);
});

test('content outside placed records and feeds is left exactly as saved',()=>{
 const html=page('nb','<p data-observanda-label="websiteRecordText:outcome">Outcome</p><div class="entry-meta" data-observanda-part="metadata"><span>observation</span></div>');
 assert.equal(localizedRecordPage(html),html);
 const plain='<!doctype html><html lang="ca"><body><p>Nothing to do</p></body></html>';
 assert.equal(localizedRecordPage(plain),plain);
});

test('inexact record dates are relabelled with numeric days that every language reads back',()=>{
 const ca=recordMessages('ca');
 assert.equal(recordDateText({kind:'month',value:'2026-03',estimated:false},ca),'març de 2026');
 assert.equal(recordDateText({kind:'range',from:'2026-03-01',to:'2026-03-09',estimated:true},ca),'Estimació: De 2026-03-01 a 2026-03-09');
 const span='<div class="entry-meta" data-observanda-part="metadata"><span>note</span><span class="record-date">Estimated: 2026-03-01 to 2026-03-09</span><span>draft</span></div>';
 const html=localizedRecordPage(page('ca',placed('<article>'+span+'</article>')));
 assert.match(html,/<span class="record-date">Estimació: De 2026-03-01 a 2026-03-09<\/span>/);
 const back=localizedRecordPage(html.replace('lang="ca"','lang="en"'));
 assert.match(back,/<span class="record-date">Estimated: 2026-03-01 to 2026-03-09<\/span>/);
});

test('feed slots show the record type and date in the page language',()=>{
 const feed='<section class="website-feed" data-website-feed="'+'c'.repeat(8)+'"><div class="website-feed-items"><article class="website-feed-item" data-website-feed-source="'+id+'"><p data-feed-field="type">observation</p><p data-feed-field="date">2026-03-01</p><time data-feed-field="date">2026-03-02</time></article></div></section>';
 const html=localizedRecordPage(page('es',feed));
 assert.match(html,/<p data-feed-field="type" data-observanda-value="observation">Observación<\/p>/);
 assert.match(html,new RegExp('<p data-feed-field="date" data-observanda-value="2026-03-01">'+readableDay('2026-03-01','es')+'</p>'));
 assert.equal(localizedRecordPage(html.replace('lang="es"','lang="en"')).includes(readableDay('2026-03-01','en')),true);
 assert.match(html,new RegExp('<time data-feed-field="date" datetime="2026-03-02">'+readableDay('2026-03-02','es')+'</time>'));
 assert.equal(localizedRecordPage(html),html);
});

test('result statements carry label keys that resolve in every shipped language',async()=>{
 const view=resultStatementsView({statements:[{id:'d'.repeat(8),title:'Mite load',kind:'conclusion',basis:'authored',text:'Low',limitations:'One hive',source:{withheld:true}}]},esc);
 const html=localizedRecordPage(page('es',placed('<article>'+view+'</article>')));
 assert.match(html,/<h2 data-observanda-label="websiteRecordText:results">Resultados<\/h2>/);
 assert.match(html,/>Conclusión<\/span> · <span data-observanda-label="analyses:authored">Redactado explícitamente por el autor</);
 const languages=JSON.parse(await readFile(new URL('../src/web/locales/languages.json',import.meta.url),'utf8')).map(l=>l.id);
 const keys=[...new Set([...(view+fragment).matchAll(/data-observanda-label="([^"]+)"/g)].map(m=>m[1]))];
 for(const language of languages){
  const message=recordMessages(language);
  for(const key of keys){const [catalogue,name]=key.split(':');assert.ok(message(catalogue,name),language+' '+key);}
 }
});

test('the saved source fragment keeps the values the library reads',()=>{
 const fields=websiteSearchFields(parseFragment(fragment));
 assert.equal(fields.recordType,'observation');assert.equal(fields.status,'in progress');assert.equal(fields.displayDate,'2026-03-01');
});
