import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {schema} from '../src/editor/schema.js';
import {portableEditorDocument} from '../src/editor/portable-editor-document.js';
import {validRichText,renderRichText,richTextStyles} from '../src/web/rich-text-model.js';
import {requiredPdfDomainFormat} from '../src/pdf-domain-format.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';
import {selectionBook} from './publication-selection-fixture.js';
import {catalogueFormat,configurationCatalogueGeneration,configurationCatalogueFeatures,restoreConfigurationCatalogueFormat,requireSemanticRecordStyles,requireScientificUnitLibrary,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';

const styles={version:1,roles:{note:{default:{size:19},website:{size:22},pdf:{size:16}}}};
const block=(type,semanticRole,options={})=>({type,attrs:{semanticRole,...options},content:[{type:'text',text:'Field note'}]});
function database(){
 let stored=122;
 return {all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,value)=>{if(sql.startsWith('UPDATE catalogue_format'))stored=value;}};
}
test('the roles survive portable round trips and map under real section headings on each output',()=>{
 const id=randomUUID(),nodes=[block('heading','heading3',{level:3,id}),block('heading','heading6',{level:6,id:randomUUID()}),block('paragraph','note'),block('paragraph','note')];
 const doc={type:'doc',attrs:{semanticStyles:styles},content:nodes};
 assert.ok(validRichText(doc));
 const portable=portableEditorDocument(schema.nodeFromJSON(doc));
 assert.ok(validRichText(portable));assert.equal(portable.content[0].attrs.id,id);
 for(const [surface,size] of [['reading',19],['website',22],['pdf',16]]){
  const html=renderRichText(portable,{surface,headingBase:2});
  assert.match(html,/<h3 [^>]*data-obs-role="heading3"/);assert.match(html,/<h4 [^>]*data-obs-role="heading6"/);assert.ok(html.includes(id));
  assert.equal((html.match(new RegExp('rt-semantic-size-'+size,'g'))??[]).length,2);
  assert.match(richTextStyles([portable],{surface}).css,new RegExp('font-size:'+size+'px'));
 }
 assert.match(renderRichText(portable,{headingBase:6}),/role="heading" aria-level="7"/);
 assert.equal(requiredPdfDomainFormat({section:{notes:[{content:portable}]}}),10);
 assert.equal(requiredPdfDomainFormat({section:{content:'original'}}),1);
 assert.equal(validRichText({type:'doc',content:nodes}),false);
 assert.equal(validRichText({...doc,attrs:{semanticStyles:{version:1,roles:{note:{pdf:{color:'url(example)'}}}}}}),false);
 const old={type:'doc',content:[{type:'heading',attrs:{id,level:3,align:'start'},content:[{type:'text',text:'Field note'}]}]};
 assert.deepEqual(JSON.parse(JSON.stringify(portableEditorDocument(schema.nodeFromJSON(old)))),old);
 assert.match(renderRichText(old),/^<h3 class="rt-align-start" id=/);
});

test('scientific units, named writing styles and publishing have independent reader generations',async()=>{
 const keys=['publicationOperations','semanticRecordStyles','scientificUnitLibrary'];
 const base={owners:1,website:2,publication:true,staged:true,transfers:false};
 for(let mask=0;mask<8;mask++){
  const flags=Object.fromEntries(keys.map((key,index)=>[key,!!(mask&(1<<index))]));
  const format=configurationCatalogueGeneration({...base,...flags}),decoded=configurationCatalogueFeatures(format);
  for(const key of keys)assert.equal(!!decoded[key],flags[key]);
 }
 assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);
 const source=database(),restored=database();await requireSemanticRecordStyles(source);
 let flags=configurationCatalogueFeatures(await catalogueFormat(source));assert.equal(flags.semanticRecordStyles,true);assert.equal(flags.scientificUnitLibrary,undefined);
 await requireScientificUnitLibrary(source);const final=await catalogueFormat(source);
 flags=configurationCatalogueFeatures(final);assert.equal(flags.semanticRecordStyles,true);assert.equal(flags.scientificUnitLibrary,true);assert.equal(flags.nativeNumericalModels,true);
 await restoreConfigurationCatalogueFormat(restored,final);assert.equal(await catalogueFormat(restored),final);
});

test('a permitted record section carries its website appearance into the standalone fragment and its print appearance into the report',async()=>{
 const {book,record}=selectionBook(),id=randomUUID();
 const content={type:'doc',attrs:{semanticStyles:styles},content:[
  block('heading','heading1',{level:1,id}),block('paragraph','note'),
  block('heading','heading4',{level:4,id:randomUUID()})
 ]};
 record.sections[0].body=content;
 record.sections[1]={...record.sections[1],share:false,title:'Withheld section title',body:'Private preparation details'};
 const fragment=await convertPublicationRecord({},book,record);
 assert.ok(fragment.visible);assert.match(fragment.html,/data-obs-role="note"/);assert.match(fragment.css,/\.rt-semantic-size-22\{font-size:22px\}/);
 assert.doesNotMatch(fragment.html,/Private preparation details|Withheld section title/);assert.ok(!fragment.css.includes('rt-semantic-size-16'));
 const header={version:1,id:randomUUID(),name:'Findings',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
 const compiled=await compilePdfDocument(header,[{id:randomUUID(),title:'Method',layout:null,start:null,content}]);
 assert.match(compiled.html,/\.rt-semantic-size-16\{font-size:16px\}/);
 assert.match(compiled.html,/<h2 [^>]*data-obs-role="heading1"/);
 assert.match(compiled.html,/<h3 [^>]*data-obs-role="heading4"/);
});
