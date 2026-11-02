import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseFragment} from 'parse5';
import {sampleNotebook} from '../src/sample.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';
import {previewWebsiteSource} from '../src/website-file-library.js';
import {projectedRecordMetadata,projectedSourceOverview} from '../src/website-source-overview.js';

test('a selected permitted website fragment returns readable body paragraphs, approved metadata and separate sections',async()=>{
 const model=sampleNotebook(),entry=model.entries[1],sectionId=randomUUID();
 entry.title='Repeated field observation';entry.body='Compare the shore plots.\n\nThe second pass used a finer sieve.';entry.status='completed';entry.occurredOn='2026-09-19';entry.outcome='Counts increased after rain.';
 entry.sections=[{id:sectionId,title:'Measurements',body:'A transect with six sampling plots.',share:true},{id:randomUUID(),title:'Unreleased writing',body:'Private observations.',share:false}];entry.tags=['rain','transects'];entry.contributors=[{name:'Field team',role:'Observer'}];
 const output=await convertPublicationRecord({},model,entry),id='a'.repeat(64),revision='c'.repeat(64);
 const store={source:async()=>({id,revision,visible:true,target:'website',title:entry.title,html:'permitted copy'}),readText:async member=>{assert.equal(member,'permitted copy');return output.html;},pendingSources:async()=>new Set(),control:async()=>null};
 const result=await previewWebsiteSource(store,id,revision);
 assert.deepEqual(result.metadata,{recordType:'hypothesis',status:'completed',displayDate:'2026-09-19'});
 assert.deepEqual(result.sections,[{id:sectionId,title:'Measurements',preview:'A transect with six sampling plots.'}]);
 const kinds=new Map(result.overview.map(part=>[part.kind,part.paragraphs]));
 assert.deepEqual(kinds.get('body'),['Compare the shore plots.','The second pass used a finer sieve.']);assert.deepEqual(kinds.get('outcome'),['Counts increased after rain.']);
 assert.deepEqual(kinds.get('contributors'),['Field team (Observer)']);assert.deepEqual(kinds.get('tags'),['rain','transects']);
 assert.doesNotMatch(JSON.stringify(result.overview),/transect with six|Measurements|Unreleased|Private observations|hypothesis|completed|Repeated field observation/);
 assert.equal(typeof result.preview,'string');
});

test('unmarked prose preserves inline words, excludes concealed and nested marked parts, and retains ranges as displayed',()=>{
 const html='<h2>Study</h2><p>Carbon <em>fixation</em>, early and late.<br>Next line.</p><div hidden>Private</div><div aria-hidden="true">Withheld</div><template>Unseen</template><section data-observanda-part="section:'+randomUUID()+'"><h2>Section text</h2></section>';
 assert.deepEqual(projectedSourceOverview(parseFragment(html),'Study'),[{kind:'text',paragraphs:['Carbon fixation, early and late.','Next line.']}]);
 const fragment=parseFragment('<div hidden><p data-observanda-part="metadata"><time datetime="2001-01-01"></time></p></div><div data-observanda-part="metadata"><span>custom</span><span class="record-date">March 2024 to May 2024</span><span>status from prose</span></div>');
 assert.deepEqual(projectedRecordMetadata(fragment),{recordType:null,status:null,displayDate:'March 2024 to May 2024'});
});

test('overview allocates a finite UTF-8 budget across semantic groups without splitting Unicode or copying URLs',()=>{
 const long='<p>'+('🧫'.repeat(140))+'</p>',html='<article><div data-observanda-part="body">'+long.repeat(90)+'<div data-observanda-part="section:wrong">Withheld structure</div></div><section data-observanda-part="results"><p>Yield was 14 %.</p></section><section data-observanda-part="attempt"><p><a href="https://example.com/reference">First trial</a></p></section></article>';
 const rows=projectedSourceOverview(parseFragment(html),'Study'),all=rows.flatMap(v=>v.paragraphs);
 assert.deepEqual(rows.map(v=>v.kind),['body','results','attempt']);assert.ok(all.includes('Yield was 14 %.'));assert.ok(all.includes('First trial'));assert.ok(all[0].endsWith('…'));
 assert.ok(all.length<=12);assert.ok(all.every(s=>Buffer.byteLength(s)<=480));assert.ok(all.reduce((n,s)=>n+Buffer.byteLength(s),0)<=4096);assert.ok(all.every(s=>s.isWellFormed()));
 assert.doesNotMatch(JSON.stringify(all),/example\.com|Withheld structure/);
});
