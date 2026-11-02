import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectionBook} from './publication-selection-fixture.js';
import {defaultPublicationPrivacy,figurePublicationChoices,withFigurePublicationChoices,validPublicationPrivacy} from '../src/web/record-publication-privacy.js';
import {sourceRecordAllowed,sourcePublicationRecord} from '../src/web/source-publication-permissions.js';
import {validateDetachedRecords} from '../src/model.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';
import {publicationDescriptorDetails} from '../src/publication-record-descriptor.js';
import {bookText} from '../src/web/book-messages.js';

test('figure exceptions belong to one output, survive unrelated changes and reject malformed identities',()=>{
 const first=randomUUID(),second=randomUUID(),initial=defaultPublicationPrivacy();
 const website=withFigurePublicationChoices(initial,first,{website:false,pdf:true});
 const both=withFigurePublicationChoices(website,second,{website:true,pdf:false});
 assert.deepEqual(figurePublicationChoices(both,first),{website:false,pdf:true});
 assert.deepEqual(figurePublicationChoices(both,second),{website:true,pdf:false});
 assert.equal(initial.website.hiddenFigures,undefined);assert.ok(validPublicationPrivacy(both));
 const restored=withFigurePublicationChoices(both,first,{website:true,pdf:true});
 assert.equal(restored.website.hiddenFigures,undefined);assert.deepEqual(restored.pdf.hiddenFigures,[second]);
 for(const hiddenFigures of [[first,first],['private-title'],42])assert.equal(validPublicationPrivacy({...initial,website:{...initial.website,hiddenFigures}}),false);
});

test('a withdrawn plot cannot leave a private alternative in nested prose or an orphan figure result',()=>{
 const {record}=selectionBook(),hidden={id:randomUUID()},visible={id:randomUUID()};
 const embed={type:'book_figure',attrs:{figureId:hidden.id,alternative:'Withheld plot caption'}};
 record.body={type:'doc',content:[{type:'blockquote',content:[embed]}]};record.figures=[hidden,visible];record.attachments=[];
 record.publication=withFigurePublicationChoices(null,hidden.id,{website:false,pdf:true});
 record.results={statements:[{kind:'figure',figureId:hidden.id},{kind:'figure',figureId:visible.id}]};
 const allowed=sourcePublicationRecord(record);assert.deepEqual(allowed.figures,[visible]);assert.deepEqual(allowed.results.statements,[record.results.statements[1]]);
 assert.deepEqual(allowed.body,{type:'doc',content:[{type:'paragraph',content:[]}]});
 record.publication.pdf.figures=false;assert.deepEqual(sourcePublicationRecord(record,'pdf').figures,[]);assert.ok(!JSON.stringify(sourcePublicationRecord(record,'pdf')).includes(embed.attrs.alternative));
 assert.ok(JSON.stringify(record.body).includes(embed.attrs.alternative));
});

test('older card excerpts retain the original private placeholder without exposing a figure alternative',()=>{
 const {record}=selectionBook(),id=randomUUID();
 record.body={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:id,alternative:'Secret raw scale'}}]};
 record.publication=defaultPublicationPrivacy();record.publication.website.figures=false;record.figures=[{id,title:'Private plot'}];
 assert.equal(publicationDescriptorDetails(record).excerpt,bookText('privateFigure'));
 record.publication=withFigurePublicationChoices(record.publication,id,{website:false,pdf:true});
 assert.equal(publicationDescriptorDetails(record).excerpt,'');
});

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
