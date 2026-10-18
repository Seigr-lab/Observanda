import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';
import {validPdfAccessibilityReceipt} from '../../src/web/pdf-output-validation-model.js';
import path from 'node:path';
import os from 'node:os';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../../src/web/pdf-structure-model.js';
import {pdfCompositionDefaults} from '../../src/web/pdf-composition-model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {appendPdfCrossReference} from '../../src/web/pdf-cross-reference-model.js';
const text=value=>({type:'text',text:value}),paragraph=value=>({type:'paragraph',content:[text(value)]});
function flatten(root){const rows=[],pending=[root];while(pending.length){const node=pending.pop();if(!node)continue;rows.push(node);for(let i=(node.children?.length??0)-1;i>=0;i--)pending.push(node.children[i]);}return rows;}
function taggedText(tree,items){
 const content=new Map(),stack=[];for(const item of items){if(item.type==='beginMarkedContent'||item.type==='beginMarkedContentProps')stack.push(item.id??null);else if(item.type==='endMarkedContent')stack.pop();else if(typeof item.str==='string')for(const id of stack)if(id)content.set(id,(content.get(id)??'')+item.str+' ');}
 return flatten(tree).filter(node=>node.type==='content').map(node=>({id:node.id,text:content.get(node.id)?.trim()??''}));
}

test('tagged PDF output preserves authored metadata and semantic reading structure',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-accessibility-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app,pdf;
 try{
  const layout=pdfLayoutPreset(),header={version:1,id:randomUUID(),name:'Tagged observation report',language:'en-GB',direction:'ltr',layout,structure:{...pdfStructureDefaults(),numberSections:true,caption:{...pdfCaptionDefaults(),numberFigures:true,numberTables:true}}};
  const figure=createFigure();figure.title='Rising observations';figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:4,error:null}];
  const first={id:randomUUID(),title:'Observed sequence',layout:null,start:null,figures:[figure],content:{type:'doc',content:[paragraph('FIRST LOGICAL PARAGRAPH'),{type:'heading',attrs:{level:2},content:[text('Detail heading')]},{type:'book_table',attrs:{version:1,id:randomUUID(),title:'Measured values',headers:['Time','Value'],rows:[['1','2'],['2','4']]}},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:figure.id,alternative:'Two observations rise from two to four.'}},{type:'paragraph',content:[{...text('External study'),marks:[{type:'link',attrs:{href:'https://example.org/observation',title:'',target:'_self',nofollow:false}}]}]}]}};
  first.content.content.splice(4,0,{type:'book_sketch',attrs:{version:1,id:randomUUID(),title:'Measured circuit',description:'A connection from the left terminal to the right terminal.',width:640,height:160,background:'#ffffff',items:[{id:randomUUID(),kind:'line',colour:'#172332',weight:2,fill:'none',x:40,y:80,x2:600,y2:80}]}});
  const asset='a'.repeat(64),imageBytes=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url));first.images=[{id:randomUUID(),asset,alt:'A synthetic specimen against a plain background.',caption:'Synthetic specimen',widthMm:30,heightMm:30,fit:'contain',crop:{x:50,y:50},position:{block:0,align:'center'}}];
  const second={id:randomUUID(),title:'Positioned reading',layout:null,start:'page',content:{type:'doc',content:[paragraph('SECOND LOGICAL PARAGRAPH'),paragraph('THIRD LOGICAL PARAGRAPH')]}};second.composition=pdfCompositionDefaults(second,layout);second.composition.boxes=second.composition.boxes.map(box=>({...box,yMm:box.target.kind==='title'?0:box.target.index===0?45:20,heightMm:15}));
  first.content=appendPdfCrossReference(first.content,{documentId:header.id,sectionId:second.id,kind:'section',blockId:null},'Selected section');
  const compiled=await compilePdfDocument(header,[first,second],{readImage:async()=>({asset,mime:'image/png',content:imageBytes,width:300,height:300})});
  const input=await embedPdfFonts(compiled);
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const result=await app.evaluate(async({app,BrowserWindow},input)=>{await app.whenReady();const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),preflight:result.preflight,visible:BrowserWindow.getAllWindows().some(window=>window.isVisible())};},input);
  expect(result.visible).toBe(false);expect(result.preflight.status).not.toBe('fatal');expect(result.pdf).toBeTruthy();const bytes=Buffer.from(result.pdf,'base64');await writeFile(info.outputPath('tagged-observations.pdf'),bytes);
  pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isEvalSupported:false,disableFontFace:true}).promise;
  const metadata=await pdf.getMetadata(),pages=[];for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),tree=await page.getStructTree(),content=await page.getTextContent({includeMarkedContent:true}),annotations=await page.getAnnotations();pages.push({number,tree,text:content.items.filter(item=>typeof item.str==='string').map(item=>item.str),readingOrder:taggedText(tree,content.items),annotations,positions:content.items.filter(item=>typeof item.str==='string').map(({str,transform})=>({text:str,x:transform[4],y:transform[5]}))});
  }
  const markInfo=await pdf.getMarkInfo(),resultInfo={info:metadata.info,metadata:metadata.metadata?.getAll()??null,markInfo:markInfo instanceof Map?Object.fromEntries(markInfo):markInfo,outline:await pdf.getOutline(),pages};
  await writeFile(info.outputPath('tagged-observations-structure.json'),JSON.stringify(resultInfo,null,2)+'\n');
  expect(metadata.info.Title).toBe(header.name);expect(metadata.info.Language).toBe(header.language);expect(resultInfo.markInfo.Marked).toBe(true);expect(pages.every(page=>page.tree)).toBe(true);
  const nodes=pages.flatMap(page=>{const text=new Map(page.readingOrder.map(row=>[row.id,row.text]));return flatten(page.tree).map(node=>({...node,text:flatten(node).filter(child=>child.type==='content').map(child=>text.get(child.id)??'').join(' ').trim()}));});
  expect(nodes.filter(node=>node.role==='Document').every(node=>node.lang===header.language)).toBe(true);
  expect(nodes.filter(node=>node.role==='H1').map(node=>node.text)).toEqual(['1 Observed sequence','2 Positioned reading']);
  expect(nodes.find(node=>node.role==='H2')?.text).toBe('Detail heading');
  const authoredTable=nodes.find(node=>node.role==='Table'&&node.text.includes('Measured values'));
  expect(authoredTable).toBeTruthy();expect(flatten(authoredTable).filter(node=>node.role==='TH')).toHaveLength(2);expect(flatten(authoredTable).filter(node=>node.role==='TD')).toHaveLength(4);
  expect(nodes.filter(node=>node.role==='TH').map(node=>node.text)).toEqual(expect.arrayContaining(['Time','Value']));
  const alternatives=nodes.filter(node=>node.role==='Figure'&&node.alt).map(node=>node.alt);
  expect(alternatives).toContain(first.images[0].alt);expect(alternatives.some(alt=>alt.includes('Two observations rise from two to four.'))).toBe(true);expect(alternatives.some(alt=>alt.includes('A connection from the left terminal to the right terminal.'))).toBe(true);
  const positioned=pages.find(page=>page.text.includes('SECOND LOGICAL PARAGRAPH')),logical=positioned.readingOrder.map(row=>row.text).filter(Boolean);
  expect(logical.indexOf('SECOND LOGICAL PARAGRAPH')).toBeLessThan(logical.indexOf('THIRD LOGICAL PARAGRAPH'));
  // PDF user-space Y grows upward: the last source paragraph is physically
  // above the first, while the tagged reading order remains authored order.
  expect(positioned.positions.find(row=>row.text==='THIRD LOGICAL PARAGRAPH').y).toBeGreaterThan(positioned.positions.find(row=>row.text==='SECOND LOGICAL PARAGRAPH').y);
  const links=pages.flatMap(page=>page.annotations.filter(row=>row.subtype==='Link'));
  expect(links.some(link=>link.url==='https://example.org/observation')).toBe(true);
  expect(nodes.some(node=>node.role==='Link'&&node.text==='External study')).toBe(true);
  const internal=links.find(link=>link.dest==='pdf-section-'+second.id);expect(internal).toBeTruthy();
  const destination=await pdf.getDestination(internal.dest);expect(await pdf.getPageIndex(destination[0])).toBe(positioned.number-1);
  expect(nodes.some(node=>node.role==='Link'&&node.text==='2 Positioned reading')).toBe(true);
  if(await pdfArchivalAvailable()){
   const checked=await app.evaluate(async(_electron,input)=>{const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument({...input,outputProfile:'pdfua-1',press:{version:1,bleedMm:3,cropMarks:true}});return {bytes:result.bytes.toString('base64'),sha256:result.sha256,validation:result.validation,conformance:result.conformance,renderer:result.renderer};},input),finalBytes=Buffer.from(checked.bytes,'base64');
   expect(validPdfAccessibilityReceipt(checked.validation)).toBe(true);expect(checked.validation.sha256).toBe(createHash('sha256').update(finalBytes).digest('hex'));expect(checked.sha256).toBe(checked.validation.sha256);expect(checked.validation.automatedOnly).toBe(true);expect(checked.conformance).toEqual([]);expect(checked.renderer.recipeVersion).toBe(2);expect(checked.validation.passedRules).toBe(106);await writeFile(info.outputPath('ua1-automated-observations.pdf'),finalBytes);
  }

 }finally{
  try{await pdf?.loadingTask.destroy();}finally{try{await app?.close();}finally{if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-accessibility-'))throw Error('Unexpected test directory');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}}
 }
});
