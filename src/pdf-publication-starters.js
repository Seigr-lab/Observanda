import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {BUNDLED_FONTS} from './web/font-catalogue.js';
import {resolveLanguage} from './web/i18n/runtime.js';
import {pdfLayoutPreset,validPdfLayout} from './web/pdf-layout-model.js';
import {pdfPageMasterDefaults} from './web/pdf-page-master-model.js';
import {pdfStructureDefaults,validPdfStructure} from './web/pdf-structure-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {jsonChunks} from './web/json-chunks.js';
import {AppError} from './errors.js';
import {copiedPdfSectionId} from './pdf-document-copy.js';
import fontProvenance from './fonts/provenance.json' with {type:'json'};

const require=createRequire(import.meta.url);
const slot=(key,level=1,optional=false)=>({key,level,optional});
const catalog=[
 {key:'report',font:'atkinson',slots:[slot('overview'),slot('objectives'),slot('work'),slot('findings',2),slot('actions'),slot('references',1,true)]},
 {key:'procedure',font:'atkinson',slots:[slot('purpose'),slot('materials'),slot('safety',2,true),slot('steps'),slot('verification'),slot('references',1,true)]},
 {key:'science',font:'source-serif',slots:[slot('abstract'),slot('question'),slot('methods'),slot('materials',2,true),slot('results'),slot('interpretation'),slot('limitations',2),slot('references')]},
 {key:'portfolio',font:'space-grotesk',slots:[slot('statement'),slot('work'),slot('process',2),slot('media',2,true),slot('credits')]},
 {key:'book',font:'source-serif',slots:[slot('preface',1,true),slot('part'),slot('chapter',2),slot('conclusion'),slot('references',1,true),slot('acknowledgements',1,true)]}
];
const plain=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f\u007f]/u.test(s);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(obj,keys)=>object(obj)&&Object.keys(obj).length===keys.length&&keys.every(key=>Object.hasOwn(obj,key));
export const publicationLanguage=value=>typeof value==='string'&&value.length<=63&&/^[a-z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value);
const starterNamespace='6ce57bd5-0e7e-47c1-95da-497eb936e21e';
const hashes=new Map(fontProvenance.map(({file,sha256})=>[file,sha256]));
const fail=(...components)=>{throw new AppError('PDF_TEMPLATE_COMPONENT',components);};
const manifestFields=['format','version','id','name','language','layout','structure','profile','fontFiles','sections'];
export function pdfStarterRevision(value){
 const hash=createHash('sha256');
 for(const bytes of jsonChunks(value,{canonical:true}))hash.update(bytes);
 return hash.digest('hex');
}

export function publicationFontFiles(font){
 const faces=BUNDLED_FONTS.find(f=>f.id===font)?.faces;
 if(!faces?.length)fail('fontFiles');
 return faces.map(({file})=>{const sha256=hashes.get(file);if(!revisionId(sha256))fail('fontFiles');return {file,sha256};});
}
export function validatePublicationStarter(value,{checkFont=true}={}){
 if(!object(value))fail('format');
 const issues=Object.keys(value).filter(key=>!manifestFields.includes(key)).slice(0,12).map(key=>/^[a-z][a-z0-9_-]{0,39}$/i.test(key)?key:'…');
 if(value.format!=='observanda-publication-starter')issues.push('format');
 if(value.version!==1)issues.push('version');
 if(!researchId(value.id))issues.push('id');
 if(!plain(value.name,240))issues.push('name');
 if(!publicationLanguage(value.language))issues.push('language');
 if(!validPdfLayout(value.layout))issues.push('layout');
 if(!validPdfStructure(value.structure))issues.push('structure');
 if(!['standard','pdfa-2u','pdfua-1'].includes(value.profile))issues.push('profile');
 const validFaces=Array.isArray(value.fontFiles)&&value.fontFiles.length>0&&value.fontFiles.length<=16&&value.fontFiles.every(face=>exact(face,['file','sha256'])&&typeof face.file==='string'&&/^[a-z0-9][a-z0-9-]*\.(?:ttf|woff2?|otf)$/.test(face.file)&&revisionId(face.sha256));
 if(!validFaces||new Set(value.fontFiles.map(f=>f.file)).size!==value.fontFiles.length)issues.push('fontFiles');
 else if(checkFont&&!issues.includes('layout')){
  const expected=publicationFontFiles(value.layout.font),faces=new Map(value.fontFiles.map(({file,sha256})=>[file,sha256]));
  if(expected.length!==faces.size||expected.some(face=>faces.get(face.file)!==face.sha256))issues.push('fontFiles');
 }
 const slots=value.sections;
 if(!Array.isArray(slots)||slots.length<1||slots.length>256)fail(...issues,'sections');
 if(!slots.some(row=>row?.optional===false)||new Set(slots.map(row=>row?.id)).size!==slots.length)issues.push('sections');
 let level=0;
 for(const row of slots){
  if(!exact(row,['id','title','guidance','level','optional','start'])||!researchId(row.id)||!plain(row.title,240)||!plain(row.guidance,800)||typeof row.optional!=='boolean'||!Number.isInteger(row.level)||row.level<1||row.level>6||row.level>level+1||![null,'page','recto','verso'].includes(row.start))fail(...issues,'sections');
  level=row.level;
 }
 if(issues.length)fail(...issues);
 return value;
}
export function inspectPublicationStarter(value){
 try{validatePublicationStarter(value);return {compatible:true,value,revision:pdfStarterRevision(value),builtIn:false};}
 catch(error){if(error.code!=='PDF_TEMPLATE_COMPONENT')throw error;return {compatible:false,components:[...new Set(error.details)]};}
}
export function bundledPublicationStarters(language){
 const locale=resolveLanguage(language),labels=require('./web/locales/'+locale+'/pdfEditor.json');
 return catalog.map(({key,font,slots})=>{
  const layout=pdfLayoutPreset(),structure=pdfStructureDefaults();
  layout.font=font;structure.contentsTitle=labels.starterContentsTitle;
  structure.contents=['report','science','book'].includes(key);structure.pageReferences=structure.contents;
  structure.numberSections=['procedure','science','book'].includes(key);
  layout.pageMaster=pdfPageMasterDefaults(layout);
  if(key==='book'){layout.pageMaster.facingPages=true;layout.pageMaster.gutterMm=6;layout.pageMaster.firstPageHeader=false;layout.margins.top=24;layout.margins.bottom=24;}
  layout.pageMaster.footer.left='{section}';
  const id=copiedPdfSectionId(starterNamespace,key);
  return validatePublicationStarter({format:'observanda-publication-starter',version:1,id,name:labels['starterName_'+key],language:locale,layout,structure,profile:'standard',fontFiles:publicationFontFiles(font),
   sections:slots.map(({key:field,level,optional})=>({id:copiedPdfSectionId(id,field),title:labels['starterTitle_'+field],guidance:labels['starterGuide_'+field],level,optional,start:(key==='book'&&level===1)?'recto':null}))});
 });
}
