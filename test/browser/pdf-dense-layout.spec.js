import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {createFigure,figureIssues} from '../../src/web/figure-model.js';
import {createComposition} from '../../src/web/figure-composition.js';
import {createAnnotation} from '../../src/web/figure-annotations.js';

const section=(title,content,extra={})=>({id:randomUUID(),title,content,layout:null,start:null,...extra});
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
async function readPages(bytes){
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false});
 try{const pdf=await task.promise,pages=[];for(let n=1;n<=pdf.numPages;n++){
  const page=await pdf.getPage(n),content=await page.getTextContent(),items=content.items.filter(item=>typeof item.str==='string');
  pages.push({view:page.view,text:items.map(item=>item.str).join(' '),items});page.cleanup();
 }return pages;}finally{await task.destroy();}
}

test('dense wide tables and annotated multi-panel figures retain every value across mixed physical pages',async({page},info)=>{
 test.setTimeout(90000);
 const header={version:1,id:randomUUID(),name:'Dense observation report',language:'en',direction:'ltr',layout:{...pdfLayoutPreset(),fontSizePt:10}},rows=Array.from({length:180},(_,n)=>{const id=String(n+1).padStart(4,'0');return ['ROW'+id,'900719925474'+id,'0001.2300','-0.000001','12:34:56','Observed','Included','END'+id];});
 const table={type:'book_table',attrs:{version:1,id:randomUUID(),title:'All measured observations',headers:['Observation','Exact counter','Exact decimal','Difference','Time','Status','Selection','Row end'],rows}};
 const plots=Array.from({length:4},(_,index)=>{
  const plot=createFigure();plot.title='Panel '+(index+1);plot.x.label='Time (s)';plot.y.label='Signal (V)';plot.series[0].name='Trace '+(index+1);
  plot.series[0].points=Array.from({length:12},(_,n)=>({x:n,y:(index+1)+(n%5)/4,error:null,xLower:n-.1,xUpper:n+.1,yLower:(index+1)+(n%5)/4-.25,yUpper:(index+1)+(n%5)/4+.25}));
  plot.annotations=[{...createAnnotation('interval'),start:2,end:4,label:'Window '+(index+1)},{...createAnnotation('boundary','y'),start:index+1.5,label:'Boundary '+(index+1)}];return plot;
 });
 const composition=createComposition(plots);composition.title='Four measured responses';composition.layout.linkX=true;composition.layout.linkY=true;expect(figureIssues(composition)).toEqual([]);
 const sections=[section('Wide observation table',{type:'doc',content:[paragraph('TABLE START: preserve every original value.'),table,paragraph('TABLE END: all 180 observations retained.')]},{layout:{...header.layout,widthMm:297,heightMm:210,fontSizePt:9}}),section('Measured panels',{type:'doc',content:[{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:composition.id,alternative:'Four panels with linked axes, uncertainty intervals and acquisition windows.'}},paragraph('FIGURE END: all four retained panels.') ]},{figures:[composition],start:'page'}),section('Final interpretation','FINAL REPORT END: scientific values remain exact.',{start:'page'})];
 const original=structuredClone(sections),compiled=await embedPdfFonts(await compilePdfDocument(header,sections));
 await page.route('**/*',route=>route.abort());await page.emulateMedia({media:'print'});await page.setContent(compiled.html);await page.evaluate(()=>document.fonts.ready);
 const preflight=await page.evaluate(measurePdfPreflight);expect(preflight).toEqual({version:1,status:'ok',findings:[],truncated:false});
 const bytes=await page.pdf({preferCSSPageSize:true,printBackground:true,tagged:true}),pages=await readPages(bytes),tablePages=pages.filter(item=>/ROW\d{4}/.test(item.text)),all=pages.map(item=>item.text).join(' '),compact=all.replace(/\s/g,'');
 expect(tablePages.length).toBeGreaterThan(3);for(const item of tablePages){expect(item.text).toContain('Observation');expect(item.text).toContain('Exact counter');expect(item.text).toContain('Row end');expect(item.view[2]).toBeCloseTo(297*72/25.4,0);}
 let position=-1;for(const row of rows){for(const value of [row[0],row[1],row.at(-1)]){expect(compact.split(value)).toHaveLength(2);const next=compact.indexOf(value);expect(next).toBeGreaterThan(position);position=next;}}
 expect(compact.match(/0001\.2300/g)).toHaveLength(rows.length);expect(compact.match(/-0\.000001/g)).toHaveLength(rows.length);
 for(const row of rows)expect(pages.flatMap(item=>item.items).some(item=>item.str===row[1]),'Exact counter fits a single line: '+row[1]).toBe(true);
 expect(all).toContain('Uncertainty');expect(all).toContain('Coordinate');
 for(let n=1;n<=4;n++){expect(all).toContain('Panel '+n);expect(all).toContain('Window '+n);expect(all).toContain('Boundary '+n);expect(all).toContain('Trace '+n);}
 expect(all.indexOf('TABLE END')).toBeLessThan(all.indexOf('Four measured responses'));expect(all.indexOf('FIGURE END')).toBeLessThan(all.indexOf('FINAL REPORT END'));
 for(const item of pages)for(const text of item.items){if(!text.str.trim())continue;const x=text.transform[4],y=text.transform[5];expect(x,text.str).toBeGreaterThanOrEqual(-1);expect(x+text.width,text.str).toBeLessThanOrEqual(item.view[2]+1);expect(y,text.str).toBeGreaterThanOrEqual(-1);expect(y,text.str).toBeLessThanOrEqual(item.view[3]+1);}
 expect(sections).toEqual(original);await writeFile(info.outputPath('dense-report.pdf'),bytes);
 await page.locator('.pdf-data-figure').screenshot({path:info.outputPath('retained-four-panel-figure.png')});
 // A physically impossible indivisible cell must be reported, never silently shrunk.
 const impossible=section('Oversized row',{type:'doc',content:[{...table,attrs:{...table.attrs,id:randomUUID(),headers:['Exact observation'],rows:[['Long retained observation. '.repeat(250)]]}}]},{layout:{...header.layout,widthMm:80,heightMm:80,margins:{top:10,right:10,bottom:10,left:10}}});
 const narrow=await embedPdfFonts(await compilePdfDocument(header,[impossible]));await page.setContent(narrow.html);const findings=await page.evaluate(measurePdfPreflight);
 expect(findings.findings.some(value=>value.code==='PDF_BLOCK_TOO_TALL'&&value.sectionId===impossible.id)).toBe(true);expect(await page.locator('td').textContent()).toBe(impossible.content.content[0].attrs.rows[0][0]);
});
