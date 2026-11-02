import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectionBook} from './publication-selection-fixture.js';
import {defaultPublicationPrivacy} from '../src/web/record-publication-privacy.js';
import {sourceRecordAllowed,sourcePublicationRecord} from '../src/web/source-publication-permissions.js';
import {validateDetachedRecords} from '../src/model.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';

test('book and entry admission are independent for each publication target',()=>{
 const {book,record}=selectionBook();record.share=true;
 assert.equal(sourceRecordAllowed(record,book,'website'),true);assert.equal(sourceRecordAllowed(record,book,'pdf'),false);
 record.sharePdf=true;assert.equal(sourceRecordAllowed(record,book,'pdf'),false);
 const notebook=book.notebooks.find(item=>item.id===record.notebookId);notebook.sharePdf=true;notebook.share=false;
 assert.equal(sourceRecordAllowed(record,book,'pdf'),true);assert.equal(sourceRecordAllowed(record,book,'website'),false);
});

test('withheld research never enters selected HTML, titles, or asset references',async()=>{
 const {book,record}=selectionBook();record.publication=defaultPublicationPrivacy();record.publication.website.body=false;record.publication.website.template=false;
 record.sections[1].share=false;record.attachments=[{id:randomUUID(),kind:'image',caption:'Secret image',alt:'Secret alt',transcript:'Secret transcript',share:false,sharePdf:false}];
 validateDetachedRecords([record]);
 const converted=await convertPublicationRecord({},book,record);assert.equal(converted.visible,true);assert.match(converted.html,/Public steps for the method/);assert.match(converted.html,new RegExp('data-observanda-part="section:'+record.sections[0].id+'"'));
 for(const label of ['WITHHELD_','Secret image','Secret alt','Secret transcript',record.attachments[0].id])assert.equal(converted.html.includes(label),false,label);
 const changed=structuredClone(record);changed.sections[1]={...changed.sections[1],share:true,title:'Now visible',body:'Newly visible writing'};
 const updated=await convertPublicationRecord({},book,changed);assert.match(updated.html,/Newly visible writing/);assert.match(updated.html,new RegExp('data-observanda-part="section:'+record.sections[0].id+'"'));
});

test('PDF-only writing and attachment permissions do not appear in website projection',()=>{
 const {record}=selectionBook();record.publication=defaultPublicationPrivacy();record.publication.pdf.body=false;
 record.sections[1].share=false;record.sections[1].sharePdf=true;const id=randomUUID();record.attachments=[{id,kind:'image',caption:'PDF figure',alt:'',transcript:'',share:false,sharePdf:true}];
 const pdf=sourcePublicationRecord(record,'pdf'),website=sourcePublicationRecord(record,'website');assert.equal(pdf.body,'');assert.equal(website.body,record.body);assert.deepEqual(pdf.sections.map(v=>v.id),[record.sections[1].id]);assert.deepEqual(website.sections.map(v=>v.id),[record.sections[0].id]);assert.equal(pdf.attachments[0].id,id);assert.equal(website.attachments.length,0);
});
test('PDF composition contains only the permitted prose and has no private blocks or source metadata',async()=>{
 const {book,record}=selectionBook();book.notebooks.find(item=>item.id===record.notebookId).sharePdf=true;record.sharePdf=true;record.publication=defaultPublicationPrivacy();record.publication.pdf.body=false;
 record.sections[0].sharePdf=true;record.sections[1].sharePdf=false;record.figures=[];record.attachments=[];
 const {pdfParts}=await convertPublicationRecord({},book,record,{target:'pdf'});assert.equal(pdfParts.body,null);assert.deepEqual(pdfParts.sections.map(item=>item.id),[record.sections[0].id]);assert.match(JSON.stringify(pdfParts.entry),/Public steps for the method/);assert.doesNotMatch(JSON.stringify(pdfParts),/WITHHELD_|research:|sourceWorkspaceId/);
});
