import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {projectPublication} from '../src/publication-projection.js';
import {renderPublication} from '../src/publication.js';
import {selectedContent} from '../src/web/website-model.js';
import {sourcePublicationRecord} from '../src/web/source-publication-permissions.js';
import {validMediaCaptions,validMediaDetails,mediaDetails} from '../src/web/record-media-value.js';

const vtt='WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nThe queen <b>walks</b> across the frame.\n';
const tracks=[{language:'ca',label:'Català',vtt},{language:'en',label:'English',vtt}];
const video=(extra={})=>({id:randomUUID(),kind:'video',caption:'Frame inspection',alt:'A beekeeper lifts a frame',transcript:'',share:true,sharePdf:true,...extra});

test('a video keeps up to four WebVTT caption tracks, one per language',()=>{
 assert.ok(validMediaCaptions(tracks));
 for(const value of [[],[{language:'ca',label:'Català',vtt:'Not a caption file'}],[tracks[0],tracks[0]],[{language:'catalan language',label:'x',vtt}],[{language:'ca',label:' ',vtt}],[{...tracks[0],extra:1}],Array.from({length:5},(_,i)=>({language:'l'+String.fromCharCode(97+i)+'a',label:'x',vtt}))])
  assert.equal(Boolean(validMediaCaptions(value)),false,JSON.stringify(value).slice(0,60));
 const details=mediaDetails({...video(),captions:tracks});
 assert.deepEqual(details.captions,tracks);assert.ok(validMediaDetails(details));
 assert.equal(validMediaDetails({...details,captions:[]}),false);
 const book=upgradeNotebook(sampleNotebook()),record=book.entries.find(e=>e.share);
 record.attachments=[video({captions:tracks})];validateDetachedRecords([record]);
 record.attachments=[{...video({captions:tracks}),kind:'image'}];
 assert.throws(()=>validateDetachedRecords([record]));
});

test('a published video carries its captions as tracks on a website and none in PDF',()=>{
 const attachment=video({captions:[...tracks,{language:'es',label:'Español',vtt:'WEBVTT\n\nbroken cue without timing\n'}]});
 const record={id:randomUUID(),share:true,sharePdf:true,sections:[],attachments:[attachment,{...attachment,id:randomUUID(),kind:'image'}]};
 const website=sourcePublicationRecord(record,'website'),pdf=sourcePublicationRecord(record,'pdf');
 assert.equal(website.attachments[0].captions.length,3);assert.ok(!Object.hasOwn(website.attachments[1],'captions'));
 assert.ok(pdf.attachments.every(item=>!Object.hasOwn(item,'captions')));
 const book=upgradeNotebook(sampleNotebook()),entry=book.entries.find(e=>e.share);
 entry.attachments=[attachment];
 const context=projectPublication(book,selectedContent(book));
 const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(12)]);
 const output=renderPublication(context,{mediaFiles:new Map([[attachment.id,{kind:'video',extension:'mp4',bytes:mp4}]])});
 const html=output.files.get('entries/'+entry.id+'.html');
 assert.match(html,new RegExp('<track kind="captions" src="../media/'+attachment.id+'.ca.vtt" srclang="ca" label="Català" default><track kind="captions" src="../media/'+attachment.id+'.en.vtt" srclang="en" label="English">'));
 // A track whose cues cannot be read is left out; the page is still published.
 assert.doesNotMatch(html,/srclang="es"/);assert.ok(!output.files.has('media/'+attachment.id+'.es.vtt'));
 const published=output.files.get('media/'+attachment.id+'.ca.vtt');
 assert.match(published,/^WEBVTT/);assert.match(published,/&lt;b&gt;walks&lt;\/b&gt;/);
});
