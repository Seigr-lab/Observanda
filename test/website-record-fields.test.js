import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {buildPublication} from '../src/publication.js';
import {localizedRecordPage,readableDay} from '../src/website-record-language.js';

test('template values are published by type and read in the page language',()=>{
 const book=upgradeNotebook(sampleNotebook()),record=book.entries.find(e=>e.share);
 const field=(key,label,type,extra={})=>({key,label,type,unit:'',required:false,choices:[],...extra});
 record.template={id:randomUUID(),profileId:null,label:'Hive inspection',description:'',
  fields:[field('queen','Queen seen','boolean'),field('inspected','Inspected on','date'),field('frames','Brood frames','number',{unit:'frames'}),field('temper','Temper','select',{choices:['Calm','Defensive']}),field('notes','Notes','text')],
  values:{queen:true,inspected:'2026-05-02',frames:'7',temper:'Calm',notes:'Smoked lightly.'}};
 validateDetachedRecords([record]);
 const html=buildPublication(book).files.get('entries/'+record.id+'.html');
 assert.match(html,/<p class="record-field-value"><span data-observanda-label="websiteRecordText:yes">Yes<\/span><\/p>/);
 assert.match(html,/<p class="record-field-value"><time datetime="2026-05-02" data-observanda-term="date">2026-05-02<\/time><\/p>/);
 assert.match(html,/<p class="record-field-value"><data value="7">7<\/data><\/p>/);
 assert.match(html,/<p class="record-field-value"><span data-observanda-term="profile">Calm<\/span><\/p>/);
 assert.match(html,/<div class="prose rich-document"><p>Smoked lightly\.<\/p><\/div>/);
 assert.match(html,/Brood frames \(frames\)/);
 const article=html.slice(html.indexOf('<article'),html.indexOf('</article>')+10);
 const page='<!doctype html><html lang="nb"><body><main><section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'">'+article+'</section></main></body></html>';
 const localized=localizedRecordPage(page);
 assert.match(localized,/data-observanda-label="websiteRecordText:yes">Ja</);
 assert.match(localized,new RegExp('data-observanda-term="date">'+readableDay('2026-05-02','nb')+'<'));
 // A choice the author wrote stays as written.
 assert.match(localized,/data-observanda-term="profile">Calm</);
 record.template.values.queen=false;
 assert.match(buildPublication(book).files.get('entries/'+record.id+'.html'),/websiteRecordText:no">No</);
});
