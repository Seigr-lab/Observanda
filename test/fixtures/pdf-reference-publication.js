import {createHash} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfPageMasterDefaults} from '../../src/web/pdf-page-master-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../../src/web/pdf-structure-model.js';
import {appendPdfCrossReference} from '../../src/web/pdf-cross-reference-model.js';
import {pdfNoteCall} from '../../src/web/pdf-notes-model.js';
import {bleedPicture} from './pdf-bleed-image.js';
import {makePdfPrinterProfile} from './pdf-icc.js';

const id=n=>'e729320a-101d-46e1-86f3-'+String(n).padStart(12,'0');
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
export const referenceHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const referenceProfiles=['screen','pdfa-2u','pdfua-1','printer-icc'];

// Every section, asset, reference and trial has a stable identity. A renderer
// or validator upgrade can be compared against the same authored input.
export function referencePublication(profile,{decomposedArabic=false,arabicFont=null}={}){
 if(!referenceProfiles.includes(profile))throw Error('Unknown reference profile');
 const pixels=bleedPicture({alpha:true}),layout=pdfLayoutPreset(),header={
  version:1,id:id(1),name:'Coastal survey instrument report',language:'en',direction:'ltr',layout,
  structure:{...pdfStructureDefaults(),numberSections:true,contents:true,pageReferences:true,
   caption:{...pdfCaptionDefaults({equations:true}),numberFigures:true,numberTables:true,numberEquations:true}}
 };
 layout.pageMaster={...pdfPageMasterDefaults(layout),facingPages:true,gutterMm:4};
 layout.pageMaster.header.left='Coastal survey';layout.pageMaster.footer.left='{section}';
 if(profile==='pdfa-2u'||profile==='pdfua-1')header.outputProfile=profile;
 const intro={id:id(2),title:'Survey design',layout:null,start:null,content:{type:'doc',content:[
  paragraph('Three optical channels were read at dawn, midday and dusk. The retained instrument values preserve their recorded precision.'),
  {type:'code_block',attrs:{language:'text'},content:[{type:'text',text:'reading := sample(channel, time)'}]},
  {type:'paragraph',content:[{type:'text',text:'Field label · Måling · '},{type:'text',text:decomposedArabic||arabicFont?'القياس':'מדידה',marks:[{type:'font_family',attrs:{font:arabicFont??(decomposedArabic?'aref-ruqaa':'amatic-sc')}}]}]},
  {type:'book_equation',attrs:{version:1,id:id(3),source:'r = b - a',label:'Change in instrument reading'}}
 ]},notes:[{id:id(4),kind:'footnote',anchor:'inline',content:'The reference instrument was checked before the first reading.'}]};
 intro.content.content[0].content.push({type:'text',text:'†',marks:[{type:'link',attrs:{href:pdfNoteCall(id(4)),title:'',target:'_self',nofollow:false}}]});
 intro.images=[{id:id(5),asset:pixels.asset,alt:'Three colour bands fade from transparent to opaque.',caption:'Optical channel reference',widthMm:48,heightMm:16,fit:'contain',crop:{x:50,y:50},position:{block:1,align:'left'}}];
 const rows=Array.from({length:78},(_,i)=>['TRIAL-'+String(i+1).padStart(3,'0'),['Dawn','Midday','Dusk'][i%3],'9007199254740993.'+String(i+1).padStart(3,'0')]);
 const measurements={id:id(6),title:'Calibration readings',start:'page',layout:null,content:{type:'doc',content:[
  paragraph('Each trial has a distinct identifier. Read across the columns to find its light condition and recorded value.'),
  {type:'book_table',attrs:{version:1,id:id(7),title:'Optical measurements',headers:['Trial identifier','Light condition','Exact reading'],rows}}
 ]}};
 intro.content=appendPdfCrossReference(intro.content,{documentId:header.id,sectionId:measurements.id,kind:'table',blockId:id(7)},'Measurement table');
 let icc=null;
 if(profile==='printer-icc'){
  icc=makePdfPrinterProfile({colorSpace:'CMYK'});header.press={version:1,bleedMm:3,cropMarks:true};
  const digest=referenceHash(icc);header.printCondition={version:1,profile:{sha256:digest,revision:digest},label:'Synthetic CMYK lookup tables',renderingIntent:'relative-colorimetric'};
 }
 return {header,sections:[intro,measurements],rows,pixels,icc};
}
