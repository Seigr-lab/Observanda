import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validPdfNote,validPdfNotes} from '../src/web/pdf-notes-model.js';
import {pdfNotesUI} from '../src/web/pdf-notes-ui.js';
import {renderPdfNotes,renderPdfEndnotes} from '../src/pdf-note-renderer.js';
import {scopePdfIds} from '../src/pdf-figure-renderer.js';
import {renderProse,proseText} from '../src/web/prose-model.js';
import {safeRichLink} from '../src/web/rich-text-model.js';
const note=(content='Synthetic observation',kind='footnote',block=1)=>({id:randomUUID(),content,kind,block});
const rich=()=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Linked note Ω',marks:[{type:'link',attrs:{href:'https://example.invalid/method',title:'Method',target:'_self',nofollow:false}},{type:'font_family',attrs:{font:'dm-sans'}}]}]}]});

test('PDF notes admit explicit nonblank prose and placement, with stable unique IDs',()=>{
 const value=note();assert.equal(validPdfNote(value),true);assert.equal(validPdfNotes([value,note(rich(),'endnote',12000)]),true);assert.equal(validPdfNotes([]),true);
 for(const changed of [{id:'not-an-id'},{content:' \n '},{content:'a'.repeat(60001)},{content:{type:'doc',content:[{type:'paragraph'}]}},{content:'bad\0text'},{kind:'page-bottom'},{block:-1},{block:1.5},{block:12001},{unknown:true}])assert.equal(validPdfNote({...value,...changed}),false);
 assert.equal(validPdfNotes([value,value]),false);assert.equal(validPdfNotes(null),false);
 const unsafe=rich();unsafe.content[0].content[0].marks[0].attrs.href='javascript:alert(1)';assert.equal(validPdfNote(note(unsafe)),false);
});

test('PDF notes render ordered semantic references and exact backlinks across section scoping and collected endnotes',async()=>{
 const first={id:randomUUID(),notes:[note('Later section note','footnote',3),note(rich(),'endnote',1),note('<script>plain text</script>','footnote',1)]},second={id:randomUUID(),notes:[note('Final endnote','endnote',12000)]},seen=[],glyphs=[];
 const renderContent=async(content,context)=>{seen.push({content,context});glyphs.push(proseText(content));return renderProse(content,{resolveLink:href=>safeRichLink(href)?href:null});};
 const options={renderContent,textGlyphs:(font,text)=>glyphs.push(font+':'+text),font:'atkinson'};
 const a=await renderPdfNotes(first,options),b=await renderPdfNotes(second,{...options,startNumber:a.nextNumber});
 assert.deepEqual(a.references.map(row=>row.block),[1,1,3]);assert.equal(a.nextNumber,4);assert.equal(b.nextNumber,5);assert.equal(b.references[0].block,12000,'Authored position remains intact for compiler clamping');
 assert.equal(seen[0].content,first.notes[1].content);assert.equal(seen[0].context.number,1);assert.equal(seen[0].context.kind,'endnote');
 const html=scopePdfIds(a.references.map(row=>row.html).join('')+a.sectionNotes,'pdf-section-'+first.id+'-')+scopePdfIds(b.references.map(row=>row.html).join('')+b.sectionNotes,'pdf-section-'+second.id+'-')+renderPdfEndnotes([...a.endnotes,...b.endnotes],{textGlyphs:(font,text)=>glyphs.push(font+':'+text)});
 assert.match(html,/role="doc-noteref"/);assert.match(html,/role="doc-footnote"/);assert.match(html,/role="doc-endnotes"/);assert.match(html,/role="doc-endnote"/);assert.match(html,/role="doc-backlink"/);assert.match(html,/Section notes/);assert.match(html,/https:\/\/example.invalid\/method/);assert.match(html,/rt-font-dm-sans/);assert.equal(html.includes('<script>'),false);assert.match(html,/&lt;script&gt;plain text/);
 const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>Buffer.byteLength(id)<=127),'Derived PDF destinations fit the PDF/A name limit');for(const match of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(match[1]),'Exact note target exists: '+match[1]);
 assert.ok(glyphs.some(text=>text.includes('Ω')));assert.ok(glyphs.includes('atkinson:Endnotes'));assert.ok(glyphs.includes('atkinson:Section notes'));assert.ok(glyphs.some(text=>text.includes('Back to reference 4')));
});

test('PDF note rendering requires the safe content callback and stops after cancellation',async()=>{
 const section={id:randomUUID(),notes:[note(),note('Second')]};await assert.rejects(renderPdfNotes(section),{code:'PDF_LAYOUT'});
 const controller=new AbortController();let reads=0;await assert.rejects(renderPdfNotes(section,{signal:controller.signal,renderContent:async()=>{reads++;controller.abort();return '<p>first</p>';}}),{name:'AbortError'});assert.equal(reads,1);
 const empty=await renderPdfNotes({id:randomUUID()});assert.deepEqual(empty,{references:[],pageFootnotes:[],sectionNotes:'',endnotes:[],nextNumber:1});assert.equal(renderPdfEndnotes([]),'');
 await assert.rejects(renderPdfNotes(section,{renderContent:()=>null}),{code:'PDF_LAYOUT'});
});

test('PDF note authoring adds, edits and removes stable notes without accepting blank new notes or stale editor callbacks',()=>{
 let document={header:{id:randomUUID()}},section={id:randomUUID()},changes=0,draws=0;const fields=new Map();
 const ui=pdfNotesUI({esc:value=>String(value),getDocument:()=>document,getSection:()=>section,changed:()=>changes++,draw:()=>draws++,field:value=>{fields.set(value.key,value);return '<div data-field="'+value.key+'"></div>';}});
 assert.match(ui.view(),/data-pdf-notes/);assert.throws(()=>ui.action('note-add',{}));assert.equal(changes,0);
 const pending=[...fields.values()].find(field=>field.key.startsWith('pdf-note-new-'));const authored=rich();pending.set(authored);ui.input({dataset:{pdfNoteField:'kind'},value:'endnote'});ui.input({dataset:{pdfNoteField:'block'},value:'2'});assert.equal(ui.action('note-add',{}),true);assert.equal(changes,1);assert.equal(validPdfNotes(section.notes),true);
 const id=section.notes[0].id;assert.equal(section.notes[0].kind,'endnote');assert.equal(section.notes[0].block,2);assert.notEqual(section.notes[0].content,authored);authored.content[0].content[0].text='Changed caller value';assert.equal(section.notes[0].content.content[0].content[0].text,'Linked note Ω');
 fields.clear();ui.view();assert.ok(!fields.has(pending.key),'New composition gets a fresh rich-editor undo identity after Add');const selected=fields.get('pdf-note-'+id);selected.set('Updated content');assert.equal(section.notes[0].id,id);assert.equal(section.notes[0].content,'Updated content');
 ui.input({dataset:{pdfNoteField:'block',pdfNoteId:id},value:'12000'});assert.equal(section.notes[0].block,12000);ui.input({dataset:{pdfNoteField:'block',pdfNoteId:id},value:'12001'});assert.equal(section.notes[0].block,12000);
 const oldSection=section;section={id:randomUUID()};ui.view();selected.set('Stale update');pending.set('Stale composition');assert.equal(oldSection.notes[0].content,'Updated content');assert.throws(()=>ui.action('note-add',{}));
 section=oldSection;ui.view();ui.action('note-remove',{dataset:{id}});assert.equal(section.notes,undefined);assert.equal(changes,4);assert.equal(draws,2);assert.equal(ui.action('other',{}),false);
});

test('PDF note links follow disabled policy while endnote typography retains the authored section settings',async()=>{
 const result=await renderPdfNotes({id:randomUUID(),notes:[note('Printed endnote','endnote')]},{renderContent:content=>renderProse(content,{resolveLink:()=>null}),links:false,font:'dm-sans',fontSizePt:17,lineHeight:1.8});
 const html=result.references[0].html+renderPdfEndnotes(result.endnotes,{layoutClass:'pdf-layout-0'});assert.equal(html.includes('<a '),false);assert.match(html,/>1<\/sup>/);assert.match(html,/font-size:17pt;line-height:1.8/);assert.match(html,/pdf-endnotes pdf-layout-0/);assert.match(html,/DM Sans/);
});

test('PDF note pending content flushes once before navigation or export and refuses malformed nonblank drafts',()=>{
 const document={header:{id:randomUUID()}},section={id:randomUUID()},fields=new Map();let changes=0;
 const ui=pdfNotesUI({esc:String,getDocument:()=>document,getSection:()=>section,changed:()=>changes++,draw:()=>{},field:value=>{fields.set(value.key,value);return '';}});
 ui.view();const field=[...fields.values()][0];assert.equal(ui.hasPending(),false);field.set('Not yet explicitly added');assert.equal(ui.hasPending(),true);assert.equal(ui.flush(),true);assert.equal(ui.hasPending(),false);assert.equal(ui.flush(),false);assert.equal(section.notes.length,1);assert.equal(changes,1);
 fields.clear();ui.view();const next=[...fields.values()].find(field=>field.key.startsWith('pdf-note-new-'));next.set('bad\0content');assert.equal(ui.hasPending(),true);assert.throws(()=>ui.flush());assert.equal(section.notes.length,1);next.set('  \n');assert.equal(ui.hasPending(),false);assert.equal(ui.flush(),false);
});


test('page footnotes retain distinct placement, scoped targets and compiler flow metadata without changing section notes',async()=>{
 const {compilePdfDocument}=await import('../src/pdf-document-renderer.js'),{pdfLayoutPreset}=await import('../src/web/pdf-layout-model.js'),{pdfStructureDefaults,pdfCaptionDefaults}=await import('../src/web/pdf-structure-model.js');
 const tableId=randomUUID(),pageNote=note({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Bottom explanation.'}]},{type:'book_table',attrs:{version:1,id:tableId,title:'Note readings',headers:['Name','Value'],rows:[['Exact','9007199254740993']]}}]},'page-footnote',1),section={id:randomUUID(),title:'Methods',content:'Referenced statement.',layout:null,start:null,notes:[pageNote,note('Retained section note.')]},header={version:1,id:randomUUID(),name:'Page notes',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),caption:{...pdfCaptionDefaults(),numberTables:true,listTables:true}}};
 assert.equal(validPdfNote(pageNote),true);const result=await compilePdfDocument(header,[section]);assert.equal(result.footnoteFlow.version,1);assert.equal(result.footnoteFlow.layouts[0].widthMm,170);assert.equal(result.footnoteFlow.layouts[0].heightMm,257);assert.match(result.html,/data-pdf-footnote-call=/);assert.match(result.html,/data-pdf-footnote-block="1"/);assert.match(result.html,/<template data-pdf-footnote-source=/);assert.match(result.html,/Table 1. Note readings/);assert.match(result.html,/pdf-section-notes/);assert.match(result.html,/Retained section note/);
 const ids=[...result.html.matchAll(/ id="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);for(const link of result.html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(link[1]));
 delete section.notes;const without=await compilePdfDocument(header,[section]);assert.equal(without.footnoteFlow,undefined);assert.doesNotMatch(without.html,/<template data-pdf-footnote-source=/);
});
