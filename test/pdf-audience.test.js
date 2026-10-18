import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {pdfLayoutPreset,validPdfDocumentHeader,validPdfSection} from '../src/web/pdf-layout-model.js';
import {revisionText} from '../src/web/revision-model.js';
import {createFigure} from '../src/web/figure-model.js';
import {researchReference} from '../src/web/research-reference.js';
import {pdfStructureDefaults} from '../src/web/pdf-structure-model.js';
import {validPdfAudience,validPdfPublication,pdfAudience,pdfSectionReviewFingerprint,pdfSectionPublicationState,changePdfAudience,changePdfPublication} from '../src/web/pdf-audience-model.js';
import {pdfAudienceFields,pdfPublicationFields,pdfAudienceSummaryFields} from '../src/web/pdf-audience-fields.js';
import {pdfAudienceSelection,pdfAudienceSummary} from '../src/pdf-audience.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
const header=()=>({version:1,id:randomUUID(),name:'Audience report',language:'en',direction:'ltr',layout:pdfLayoutPreset()});
const section=(content='Measured result')=>({id:randomUUID(),title:'Results',content,layout:null,start:null});
const image=()=>({id:randomUUID(),asset:'a'.repeat(64),alt:'Selected view',caption:'Measured specimen',widthMm:80,heightMm:60,fit:'contain',crop:{x:50,y:50},position:{block:0,align:'center'}});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields={esc,text:(key,values)=>key+(values?' '+JSON.stringify(values):'')};
const collect=async source=>{const values=[];for await(const value of source)values.push(value);return values;};

test('PDF audience admission defaults old documents to private and rejects ambiguous selection fields',()=>{
 const h=header(),s=section();assert.equal(pdfAudience(h),'private');assert.equal(validPdfDocumentHeader(h),true);assert.equal(validPdfSection(s),true);
 for(const audience of ['private','public'])assert.equal(validPdfAudience(audience),true);
 for(const audience of [null,undefined,'PUBLIC',{},true])assert.equal(validPdfAudience(audience),false);
 for(const publication of [{version:1,include:true,review:null},{version:1,include:false,review:null},{version:1,include:true,review:'a'.repeat(64)}])assert.equal(validPdfPublication(publication),true);
 for(const publication of [null,{},[],{version:2,include:true,review:null},{version:1,include:'public',review:null},{version:1,include:true},{version:1,include:true,review:'a'},{version:1,include:false,review:'a'.repeat(64)},{version:1,include:true,review:null,approved:true}])assert.equal(validPdfPublication(publication),false);
 assert.equal(validPdfDocumentHeader({...h,audience:'public'}),true);assert.equal(validPdfDocumentHeader({...h,audience:null}),false);
 assert.equal(validPdfSection({...s,publication:{version:1,include:true,review:null}}),true);assert.equal(validPdfSection({...s,publication:{version:1,include:true,review:null,private:false}}),false);
});

test('public review fingerprints are canonical and invalidate exact prose, images, notes, figures, research and document changes',()=>{
 const h=header(),s=section();h.audience='public';s.images=[image()];s.notes=[{id:randomUUID(),kind:'footnote',content:'Retained note',block:0}];s.figures=[createFigure()];s.figures[0].series[0].points=[{x:1,y:3,error:null}];
 s.research={version:1,workspaceId:randomUUID(),snapshotId:'b'.repeat(64),recordId:randomUUID(),recordRevision:'c'.repeat(64),collection:'body',itemId:randomUUID(),title:'Original',content:'Original result',figures:[]};
 assert.equal(validPdfSection(s),true);changePdfPublication(h,s,'audience-review');const stamp=s.publication.review;
 const {audience,...document}=h,{publication,...content}=s;void audience;void publication;
 assert.equal(stamp,createHash('sha256').update(revisionText({version:1,header:document,section:content})).digest('hex'));
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,v])=>[key,reorder(v)])):value;
 assert.equal(pdfSectionReviewFingerprint(reorder(h),reorder(s)),stamp);assert.equal(pdfSectionPublicationState(h,s).review,'reviewed');
 const changes=[(a,b)=>{b.content+=' ';},(a,b)=>{b.title+=' revised';},(a,b)=>{b.images[0].asset='d'.repeat(64);},(a,b)=>{b.images[0].alt+=' revised';},(a,b)=>{b.images[0].caption+=' revised';},(a,b)=>{b.images[0].crop.x=10;},(a,b)=>{b.notes[0].content+=' revised';},(a,b)=>{b.notes[0].kind='endnote';},(a,b)=>{b.figures[0].series[0].points[0].y=4;},(a,b)=>{b.research.recordRevision='e'.repeat(64);},a=>{a.name+=' revised';},a=>{a.layout.footer='Changed footer';},a=>{a.fonts=[{id:'custom-'+'f'.repeat(64),revision:'e'.repeat(64)}];}];
 for(const change of changes){const a=structuredClone(h),b=structuredClone(s);change(a,b);assert.equal(pdfSectionPublicationState(a,b).review,'changed');assert.equal(pdfSectionPublicationState(a,b).allowed,false);}
 assert.equal(pdfSectionReviewFingerprint({...h,audience:'private'},s),stamp);
 changePdfPublication(h,s,'audience-omit');assert.deepEqual(s.publication,{version:1,include:false,review:null});changePdfPublication(h,s,'audience-include');assert.equal(pdfSectionPublicationState(h,s).allowed,false);
});

test('public compilation refuses unreviewed and edited sections, omits private content before assets, fonts and contents',async()=>{
 const h=header(),publicSection=section('APPROVED RESULT'),omitted=section('OMITTED BODY');h.audience='public';h.structure={...pdfStructureDefaults(),contents:true};omitted.title='OMITTED TITLE';omitted.images=[image()];omitted.images[0].alt='OMITTED IMAGE';omitted.notes=[{id:randomUUID(),kind:'endnote',content:'OMITTED NOTE',block:0}];omitted.figures=[createFigure()];omitted.figures[0].title='OMITTED FIGURE';omitted.figures[0].series[0].points=[{x:1,y:2,error:null}];omitted.layout={...pdfLayoutPreset(),font:'editorial'};
 assert.equal(validPdfSection(omitted),true);
 let reads=0;const readImage=async()=>{reads++;throw Error('Excluded asset was fetched');};
 await assert.rejects(compilePdfDocument(h,[publicSection,omitted],{readImage}),{code:'PDF_PUBLIC_REVIEW'});assert.equal(reads,0);
 changePdfPublication(h,publicSection,'audience-review');changePdfPublication(h,omitted,'audience-omit');
 const output=await compilePdfDocument(h,[publicSection,omitted],{readImage});assert.equal(output.sections,1);assert.match(output.html,/APPROVED RESULT/);assert.doesNotMatch(output.html,/OMITTED|editorial/);assert.equal(reads,0);assert.deepEqual(output.fonts,['atkinson']);
 publicSection.content+=' NOT REVIEWED';await assert.rejects(compilePdfDocument(h,[publicSection,omitted],{readImage}),{code:'PDF_PUBLIC_REVIEW'});assert.equal(reads,0);
 const privateHeader=header(),old=section('PRIVATE CURRENT');assert.match((await compilePdfDocument(privateHeader,[old])).html,/PRIVATE CURRENT/);
 changePdfPublication(privateHeader,old,'audience-omit');await assert.rejects(compilePdfDocument(privateHeader,[old]),{code:'PDF_EMPTY'});
});

test('public research links cannot silently resolve through omitted content',async()=>{
 const h=header(),target=section('Selected destination');h.audience='public';target.research={version:1,workspaceId:randomUUID(),snapshotId:'a'.repeat(64),recordId:randomUUID(),recordRevision:'b'.repeat(64),collection:'body',itemId:randomUUID(),title:target.title,content:target.content,figures:[]};
 const href=researchReference({workspaceId:target.research.workspaceId,id:target.research.recordId,kind:'record',revision:target.research.recordRevision});
 const intro=section({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'See selected destination',marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]}]}]});
 changePdfPublication(h,intro,'audience-review');changePdfPublication(h,target,'audience-omit');await assert.rejects(compilePdfDocument(h,[intro,target]),{code:'PDF_UNRESOLVED_REFERENCE'});
 changePdfPublication(h,target,'audience-review');const output=await compilePdfDocument(h,[intro,target]);assert.ok(output.html.includes('href="#pdf-section-'+target.id+'"'));assert.ok(!output.html.includes(target.research.workspaceId));assert.ok(!output.html.includes(target.research.recordRevision));
});

test('audience summaries consume selected sections incrementally and cancellation closes the source',async()=>{
 const h=header();h.audience='public';let visited=0,closed=false;
 const source=async function*(){try{for(let index=0;index<131;index++){visited++;const s=section();if(index%3===0)changePdfPublication(h,s,'audience-review');else if(index%3===1)changePdfPublication(h,s,'audience-omit');yield s;}}finally{closed=true;}};
 const summary=await pdfAudienceSummary(h,source());assert.deepEqual(summary,{audience:'public',total:131,included:44,omitted:44,reviewed:44,pending:43,complete:true,ready:false});assert.equal(visited,131);assert.equal(closed,true);assert.ok(Object.values(summary).every(value=>typeof value!=='object'));
 const controller=new AbortController();let pulled=0,finished=false;const selection=pdfAudienceSelection(header());
 await assert.rejects(collect(selection.sections((async function*(){try{yield section();pulled++;controller.abort();yield section();pulled++;}finally{finished=true;}})(),{signal:controller.signal})),{name:'AbortError'});
 assert.equal(pulled,1);assert.equal(finished,true);assert.equal(selection.summary().complete,false);assert.equal(selection.summary().total,1);
});

test('audience fields expose explicit private/public selection, bounded content counts and public-only review actions',()=>{
 const h=header(),s=section();s.images=[image()];s.notes=[{id:randomUUID(),kind:'footnote',content:'Note',block:0}];s.figures=[createFigure()];
 assert.match(pdfAudienceFields(h,fields),/data-pdf-audience><option value="private" selected/);
 const privateFields=pdfPublicationFields(h,s,fields);assert.match(privateFields,/audienceIncluded/);assert.doesNotMatch(privateFields,/audience-review|audienceReviewHint|audiencePending/);
 assert.equal(changePdfAudience(h,'public'),true);const publicFields=pdfPublicationFields(h,s,fields);assert.match(publicFields,/data-command="audience-review"/);assert.match(publicFields,/audiencePending/);assert.match(publicFields,/&quot;images&quot;:1/);assert.match(publicFields,/&quot;notes&quot;:1/);assert.match(publicFields,/&quot;figures&quot;:1/);
 assert.equal(changePdfPublication(h,s,'audience-review'),true);assert.match(pdfPublicationFields(h,s,fields),/audienceReviewed/);assert.match(pdfPublicationFields(h,s,fields),/data-command="audience-review" disabled/);
 s.notes[0].content+=' changed';assert.match(pdfPublicationFields(h,s,fields),/audienceChanged/);
 assert.equal(changePdfAudience(h,'invalid'),false);assert.equal(changePdfPublication(h,s,'unrelated'),false);
 assert.equal(pdfAudienceSummaryFields({complete:false},fields),'');assert.match(pdfAudienceSummaryFields({complete:true,total:2,included:1,omitted:1,pending:0},fields),/data-pdf-audience-summary/);
 const unsafe={esc,text:()=>'<img src=x onerror=alert(1)>'};assert.doesNotMatch(pdfPublicationFields(h,s,unsafe),/<img/);assert.match(pdfPublicationFields(h,s,unsafe),/&lt;img/);
});
