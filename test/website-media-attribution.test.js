import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {projectPublication} from '../src/publication-projection.js';
import {renderPublication} from '../src/publication.js';
import {selectedContent} from '../src/web/website-model.js';
import {publicMediaAttribution,sourcePublicationRecord} from '../src/web/source-publication-permissions.js';
import {localizedRecordPage} from '../src/website-record-language.js';

const metadata={creator:'Ada Lovelace',credit:'Courtesy of the village archive',licence:'CC BY 4.0',capturedOn:{kind:'day',value:'2026-05-02',estimated:false},capturedTime:'07:15+02:00',subject:'Hive 4 frame',location:'Private apiary, Field 12',source:'Box 3 / negative 17'};
const photo={id:randomUUID(),kind:'image',caption:'Capped brood',alt:'A frame of capped brood',transcript:'',share:true,sharePdf:true,metadata};

test('only creator, credit and licence of public media reach a website, and nothing reaches PDF',()=>{
 assert.deepEqual(publicMediaAttribution(metadata),{creator:'Ada Lovelace',credit:'Courtesy of the village archive',licence:'CC BY 4.0'});
 assert.equal(publicMediaAttribution({...metadata,creator:' ',credit:'',licence:''}),null);
 for(const value of [null,undefined,'Ada',[metadata]])assert.equal(publicMediaAttribution(value),null);
 const record={id:randomUUID(),share:true,sharePdf:true,sections:[],attachments:[photo,{...photo,id:randomUUID(),share:false}]};
 const website=sourcePublicationRecord(record,'website'),pdf=sourcePublicationRecord(record,'pdf');
 assert.equal(website.attachments.length,1);assert.deepEqual(website.attachments[0].attribution,publicMediaAttribution(metadata));
 for(const projected of [website,pdf]){
  const text=JSON.stringify(projected.attachments);
  for(const secret of ['Private apiary','Box 3','Hive 4 frame','07:15','2026-05-02'])assert.ok(!text.includes(secret),secret);
  assert.ok(projected.attachments.every(item=>!Object.hasOwn(item,'metadata')));
 }
 assert.ok(pdf.attachments.every(item=>!item.attribution));
 // A projected record projects again to the same attribution.
 assert.deepEqual(sourcePublicationRecord(website,'website').attachments,website.attachments);
});

test('a published photograph shows its credit in its caption, labelled in the page language',()=>{
 const book=upgradeNotebook(sampleNotebook()),entry=book.entries.find(e=>e.share);
 entry.attachments=[photo];
 const context=projectPublication(book,selectedContent(book));
 const projected=context.entries.find(e=>e.id===entry.id).attachments[0];
 assert.deepEqual(projected.attribution,publicMediaAttribution(metadata));
 const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000','hex');
 const output=renderPublication(context,{mediaFiles:new Map([[photo.id,{kind:'image',extension:'png',bytes:png}]])});
 const html=output.files.get('entries/'+entry.id+'.html');
 assert.match(html,/<figcaption>Capped brood<br><small class="media-provenance"><span data-observanda-label="websiteRecordText:mediaCreator">Creator<\/span>: Ada Lovelace &middot; Courtesy of the village archive &middot; <span data-observanda-label="websiteRecordText:mediaLicence">Licence<\/span>: CC BY 4\.0<\/small><\/figcaption>/);
 for(const secret of ['Private apiary','Box 3','Hive 4 frame','07:15'])assert.ok(![...output.files.values()].some(file=>typeof file==='string'&&file.includes(secret)),secret);
 const article=html.slice(html.indexOf('<article'),html.indexOf('</article>')+10);
 const page='<!doctype html><html lang="ca"><body><main><section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'">'+article+'</section></main></body></html>';
 assert.match(localizedRecordPage(page),/>Autoria<\/span>: Ada Lovelace &middot; Courtesy of the village archive &middot; <span data-observanda-label="websiteRecordText:mediaLicence">Llicència<\/span>: CC BY 4\.0/);
});
