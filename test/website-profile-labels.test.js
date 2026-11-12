import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
// Nothing but the website build is imported: no interface module has
// prepared the lab book profile catalogue in this process.
import {buildPublication} from '../src/publication.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {localizedRecordPage} from '../src/website-record-language.js';
import {loadedMessages} from '../src/web/i18n/index.js';

const catalogue=async language=>JSON.parse(await readFile(new URL('../src/web/locales/'+language+'/labBookProfiles.json',import.meta.url),'utf8'));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('a website page with a lab book profile label builds with nothing loaded and reads in every page language',async()=>{
 const english=await catalogue('en'),key='analytical-qc.samples.fields.field1',label=english[key];
 const book=upgradeNotebook(sampleNotebook()),record=book.entries.find(e=>e.share);
 record.template={id:randomUUID(),profileId:null,label:'Batch inspection',description:'',fields:[{key:'batch',label,type:'text',unit:'',required:false,choices:[]}],values:{batch:'Lot 7'}};
 validateDetachedRecords([record]);
 const html=buildPublication(book).files.get('entries/'+record.id+'.html');
 // The build itself makes the profile catalogue available; it never throws.
 assert.ok(loadedMessages('labBookProfiles'));
 assert.match(html,new RegExp('<h2 data-observanda-term="profile">'+label+'</h2>'));
 const article=html.slice(html.indexOf('<article'),html.indexOf('</article>')+10);
 for(const language of ['en','ca','es','nb','nn']){
  const page='<!doctype html><html lang="'+language+'"><body><main><section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'">'+article+'</section></main></body></html>';
  const expected=(await catalogue(language))[key]??label;
  assert.ok(localizedRecordPage(page).includes('data-observanda-term="profile" data-observanda-value="'+esc(label)+'">'+esc(expected)+'</h2>'),language);
 }
});
