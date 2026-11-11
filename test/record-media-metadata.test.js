import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyMediaMetadata,validMediaMetadata,validMediaDetails,validCaptureTime,mediaDetails} from '../src/web/record-media-value.js';
import {mediaCreditLine,mediaMetadataList,mediaMetadataDetails} from '../src/web/record-media-metadata.js';
import {mediaMetadataIssue} from '../src/web/record-media-values-ui.js';
import {sourcePublicationRecord,publicRecordAttachments} from '../src/web/source-publication-permissions.js';
import {validateNotebook,upgradeNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {mediaValueFixture} from './record-media-values-fixture.js';
import {RecordContent} from '../src/record-content.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const details=(metadata={})=>({...emptyMediaMetadata(),creator:'A. Recorder',credit:'Field survey team',licence:'CC BY 4.0',capturedOn:'2026-05-02',capturedTime:'06:41:07+02:00',subject:'Lapwing (Vanellus vanellus), adult',location:'Private site 7, 59.91234 N 10.75012 E (±5 m)',source:'Survey archive box 12',...metadata});

test('capture details keep the precision the author knows',()=>{
 assert.ok(validMediaMetadata(emptyMediaMetadata()));
 assert.ok(validMediaMetadata(details()));
 for(const capturedOn of [{kind:'year',value:'0850',estimated:true},{kind:'month',value:'1911-04',estimated:false},{kind:'range',from:'1890-01-01',to:'1899-12-31',estimated:true},{kind:'day',value:'1950-02-28',estimated:true}])assert.ok(validMediaMetadata(details({capturedOn,capturedTime:''})),JSON.stringify(capturedOn));
 for(const time of ['06:41','06:41:07','06:41:07.250Z','23:59:59-03:30'])assert.ok(validCaptureTime(time),time);
 for(const time of ['24:00','6:41','06:60','06:41+15:00','06:41 UTC'])assert.equal(validCaptureTime(time),false,time);
 // A time of day needs an exact day; an estimated day may carry one.
 assert.equal(validMediaMetadata(details({capturedOn:{kind:'month',value:'2026-05',estimated:false}})),false);
 assert.ok(validMediaMetadata(details({capturedOn:{kind:'day',value:'2026-05-02',estimated:true}})));
 for(const bad of [{capturedOn:null},{capturedOn:'2026-02-30'},{licence:'x'.repeat(301)},{location:'bad\u0000text'},{extra:''}])assert.equal(validMediaMetadata(details(bad)),false,JSON.stringify(bad));
 const {subject,...missing}=details();assert.equal(validMediaMetadata(missing),false);
 assert.equal(mediaMetadataIssue(details({capturedOn:{kind:'month',value:'2026-05',estimated:false}})),'A time of capture needs an exact day.');
 assert.equal(mediaMetadataIssue(details({capturedTime:'7 am'})),'Enter the time as HH:MM or HH:MM:SS, optionally followed by Z or an offset such as +02:00.');
 assert.equal(mediaMetadataIssue(details()),'');assert.equal(mediaMetadataIssue(undefined),'');
});

test('media values and stored records accept details only in their exact shape',()=>{
 const value={caption:'Lapwing',alt:'A bird on a field',transcript:'',share:false};
 assert.ok(validMediaDetails(value));assert.ok(validMediaDetails({...value,metadata:details()}));
 assert.equal(validMediaDetails({...value,metadata:{creator:'x'}}),false);
 assert.deepEqual(mediaDetails({id:randomUUID(),kind:'image',...value,metadata:details()}),{...value,metadata:details()});
 assert.deepEqual(mediaDetails({id:randomUUID(),kind:'image',...value}),value);
 const book=upgradeNotebook(sampleNotebook()),record=book.entries[0],attachment={id:randomUUID(),kind:'image',...value};
 record.attachments=[{...attachment,metadata:details()}];assert.doesNotThrow(()=>validateNotebook(book));
 record.attachments=[{...attachment,metadata:{...details(),capturedTime:'25:00'}}];assert.throws(()=>validateNotebook(book));
});

test('readers see credit, licence and capture; publication receives none of the details',()=>{
 const credit=mediaCreditLine(details(),esc);
 for(const part of ['By A. Recorder','Field survey team','CC BY 4.0','2026-05-02 06:41:07+02:00'])assert.ok(credit.includes(esc(part)),part);
 assert.ok(!credit.includes('Private site'),'The credit line never shows a location');
 assert.match(mediaMetadataList(details(),esc),/Location \(private\)<\/dt><dd>Private site 7/);
 assert.match(mediaMetadataDetails(details(),esc),/^<details class="record-media-provenance"><summary>Source and capture<\/summary>/);
 assert.equal(mediaCreditLine(emptyMediaMetadata(),esc),'');assert.equal(mediaMetadataDetails(undefined,esc),'');
 assert.ok(mediaCreditLine(details({capturedOn:{kind:'year',value:'1911',estimated:true},capturedTime:''}),esc).includes('1911'));
 const record={share:true,attachments:[{id:randomUUID(),kind:'image',caption:'Shared',alt:'',transcript:'',share:true,sharePdf:true,metadata:details()},{id:randomUUID(),kind:'image',caption:'Private',alt:'',transcript:'',share:false,metadata:details()}]};
 for(const target of ['website','pdf']){
  const projected=publicRecordAttachments(record,target);assert.equal(projected.length,1);assert.equal(Object.hasOwn(projected[0],'metadata'),false);
  assert.ok(!JSON.stringify(sourcePublicationRecord({...record,sections:[],sharePdf:true},target)).includes('Private site'));
 }
 assert.ok(record.attachments[0].metadata,'Projection never changes the lab book record');
});

test('details are saved with the record media value, read back and kept out of publication',async t=>{
 const f=await mediaValueFixture({count:3});t.after(f.close);
 const id=f.record.attachments[0].id,base=await f.values.read(f.target(id)),value={...base.value.value,caption:'Lapwing',metadata:details()};
 await f.save(base,value);
 const reread=await f.values.read(f.target(id));assert.deepEqual(reread.value.value.metadata,details());
 const header=(await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true})).header;
 assert.deepEqual(header.attachments.find(item=>item.id===id).metadata,details());
 // Removing the details returns the value to its original shape.
 const {metadata,...plain}=reread.value.value;await f.save(reread,plain);
 assert.equal(Object.hasOwn((await f.values.read(f.target(id))).value.value,'metadata'),false);
 await assert.rejects(f.save(await f.values.read(f.target(id)),{...plain,metadata:{...details(),capturedTime:'06:41 UTC'}}),{code:'INVALID'});
});
