import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseFragment} from 'parse5';
import {pdfCaptionRenderer} from '../src/pdf-caption-renderer.js';
import {scopePdfIds,pdfFigureRenderer} from '../src/pdf-figure-renderer.js';
import {createFigure} from '../src/web/figure-model.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../src/web/pdf-structure-model.js';
const caption=()=>({numberFigures:true,numberTables:true,listFigures:true,listTables:true,figureLabel:'Figure',tableLabel:'Table',figuresTitle:'List of figures',tablesTitle:'List of tables'});
const header=(overrides={})=>({layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),caption:{...caption(),...overrides}}});
function elements(html,tag){const found=[],pending=[parseFragment(html)];while(pending.length){const node=pending.pop();if(node.tagName===tag)found.push(node);pending.push(...node.childNodes??[]);}return found;}
const attribute=(node,key)=>node.attrs.find(value=>value.name===key)?.value;

test('caption numbering preserves scoped markup and URLs while exposing stable semantic targets across sections',()=>{
 const sectionId=randomUUID(),imageId=randomUUID(),tableId=randomUUID(),figureId=randomUUID(),glyphs=[],renderer=pdfCaptionRenderer(header(),{textGlyphs:(font,text)=>glyphs.push({font,text})});
 const image='<img src="data:image/png;base64,YWJj" alt="Specimen &amp; scale">',svg='<svg><defs><clipPath id="clip"><rect width="2" height="2"></rect></clipPath></defs><path clip-path="url(#clip)"></path><use href="#clip"></use></svg>',prose='<em>Measured</em> &amp; <strong>repeatable</strong>';
 const html=scopePdfIds('<figure data-pdf-block-id="'+imageId+'">'+image+'<figcaption>'+prose+'</figcaption></figure><section class="book-table" id="record-table-'+tableId+'"><div><table><caption>Values &lt; 3</caption><tbody><tr><td>2</td></tr></tbody></table></div></section><figure id="record-block-'+figureId+'">'+svg+'<figcaption>Geometry</figcaption></figure>','pdf-section-'+sectionId+'-');
 const first=renderer.section(html,{sectionId,font:'editorial'});assert.deepEqual(first.targets.map(value=>[value.kind,value.number,value.blockId]),[['figure',1,imageId],['table',1,tableId],['figure',2,figureId]]);assert.ok(first.html.includes(image));assert.ok(first.html.includes(prose));assert.ok(first.html.includes(scopePdfIds(svg,'pdf-section-'+sectionId+'-')));
 assert.match(first.html,/<figcaption><span class="pdf-caption-label">Figure 1\.<\/span> <em>Measured<\/em>/);assert.match(first.html,/<caption><span class="pdf-caption-label">Table 1\.<\/span> Values &lt; 3<\/caption>/);
 assert.equal(first.targets[1].anchor,'pdf-section-'+sectionId+'-record-table-'+tableId);assert.equal(first.targets[2].anchor,'pdf-section-'+sectionId+'-record-block-'+figureId);
 const laterId=randomUUID(),later='<figure data-pdf-block-id="'+randomUUID()+'"><figcaption>Later view</figcaption></figure><table><tbody><tr><td>4</td></tr></tbody></table>',second=renderer.section(later,{sectionId:laterId});assert.deepEqual(second.targets.map(value=>[value.kind,value.number]),[['figure',3],['table',2]]);assert.match(second.html,/<table id="[^"]+"><caption><span class="pdf-caption-label">Table 2\.<\/span><\/caption>/);
 assert.deepEqual(renderer.counts(),{figures:3,tables:2});const lists=renderer.lists();assert.match(lists,/Figure 1\. Measured &amp; repeatable/);assert.ok(lists.includes('href="#'+first.targets[1].anchor+'"'));assert.match(lists,/List of figures/);assert.match(lists,/List of tables/);assert.equal(elements(lists,'li').length,5);
 const alone=pdfCaptionRenderer(header()).section(later,{sectionId:laterId});assert.deepEqual(alone.targets.map(value=>value.anchor),second.targets.map(value=>value.anchor));assert.equal(alone.targets[0].number,1);
 assert.ok(glyphs.some(value=>value.font==='editorial'&&value.text==='Figure 1.'));assert.ok(glyphs.some(value=>value.font==='atkinson'&&value.text==='Figure 1. Measured & repeatable'));assert.ok(glyphs.some(value=>value.font==='atkinson'&&value.text==='List of tables'));
});

test('rendered data figures are counted once and equations and hidden alternative tables are excluded',()=>{
 const sectionId=randomUUID(),figure=createFigure();figure.title='Retained trace';figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:4,error:null}];
 const render=pdfFigureRenderer({id:sectionId,figures:[figure]},pdfLayoutPreset(),()=>{}),blockId=randomUUID(),data=render({type:'book_figure',attrs:{id:blockId,figureId:figure.id,alternative:'Two readings'}}),equation='<figure class="book-equation" id="equation"><div role="math">x=2</div><figcaption>Equation only</figcaption></figure>',alternative='<details class="book-table-linear"><table><caption>Hidden duplicate</caption><tbody><tr><td>2</td></tr></tbody></table></details>',renderer=pdfCaptionRenderer(header());
 const output=renderer.section(scopePdfIds(equation+data+alternative,'pdf-section-'+sectionId+'-'),{sectionId});assert.deepEqual(renderer.counts(),{figures:1,tables:0});assert.equal(output.targets.length,1);assert.equal(output.targets[0].blockId,blockId);assert.match(output.html,/<figcaption>Equation only<\/figcaption>/);assert.ok(output.html.includes(alternative));assert.equal(elements(output.html,'span').filter(node=>attribute(node,'class')==='pdf-caption-label').length,1);assert.match(renderer.lists(),/Figure 1\. Retained trace/);assert.doesNotMatch(renderer.lists(),/Equation only|Hidden duplicate|Two readings/);
});

test('numbering and lists are independent and no caption settings leaves completed HTML unchanged',()=>{
 const sectionId=randomUUID(),html='<figure><img src="data:image/png;base64,YWJj"><figcaption>Unnumbered caption</figcaption></figure><table><tbody><tr><td>5</td></tr></tbody></table>',glyphs=[];
 for(const h of [{layout:pdfLayoutPreset()},{layout:pdfLayoutPreset(),structure:pdfStructureDefaults()},header({numberFigures:false,numberTables:false,listFigures:false,listTables:false})]){const renderer=pdfCaptionRenderer(h);assert.deepEqual(renderer.section(html,{sectionId}),{html,targets:[]});assert.equal(renderer.lists(),'');}
 const listed=pdfCaptionRenderer(header({numberFigures:false,numberTables:false}),{textGlyphs:(font,text)=>glyphs.push(text)}),result=listed.section(html,{sectionId});assert.match(result.html,/<figcaption>Unnumbered caption<\/figcaption>/);assert.equal(elements(result.html,'caption').length,0);assert.doesNotMatch(result.html,/pdf-caption-label/);assert.match(listed.lists(),/>Unnumbered caption<\/a>/);assert.doesNotMatch(listed.lists(),/Figure 1|Table 1/);assert.ok(glyphs.includes('Unnumbered caption'));
 const numbered=pdfCaptionRenderer(header({listFigures:false,listTables:false}));assert.match(numbered.section(html,{sectionId}).html,/Figure 1\./);assert.equal(numbered.lists(),'');
});

test('list links respect document structure and both destination and navigation layouts',()=>{
 const html='<figure><figcaption>View</figcaption></figure>';
 for(const option of ['internal','document','section']){const h=header();if(option==='internal')h.structure.internalLinks=false;if(option==='document')h.layout.links='disabled';const renderer=pdfCaptionRenderer(h);renderer.section(html,{sectionId:randomUUID(),links:option==='section'?'disabled':'enabled'});const output=renderer.lists();assert.match(output,/Figure 1\. View/);assert.doesNotMatch(output,/<a\b/);}
});

test('caption anchors remain unique for duplicate blocks and labels and list prose are escaped',()=>{
 const sectionId=randomUUID(),blockId=randomUUID(),base='pdf-caption-'+sectionId+'-figure-'+blockId,h=header({figureLabel:'<img src=x> & "view"',figuresTitle:'<script>list</script>'}),renderer=pdfCaptionRenderer(h),html='<div id="'+base+'"></div><figure data-pdf-block-id="'+blockId+'"><figcaption>&lt;b&gt; &amp; <em>caption</em></figcaption></figure><figure data-pdf-block-id="'+blockId+'"></figure>',output=renderer.section(html,{sectionId}),lists=renderer.lists();
 assert.equal(new Set(output.targets.map(value=>value.anchor)).size,2);assert.ok(output.targets.every(value=>value.anchor!==base));const ids=elements(output.html,'figure').map(value=>attribute(value,'id'));assert.deepEqual(ids.sort(),output.targets.map(value=>value.anchor).sort());assert.doesNotMatch(output.html,/<img src=x>/);assert.doesNotMatch(lists,/<script>|<em>|<b>/);assert.match(lists,/&lt;script&gt;list&lt;\/script&gt;/);assert.match(lists,/&lt;b&gt; &amp; caption/);assert.match(output.html,/<figcaption><span class="pdf-caption-label">&lt;img src=x&gt; &amp; &quot;view&quot; 2\.<\/span><\/figcaption>/);
});

test('caption processing enforces the existing byte budget and observes cancellation',()=>{
 const sectionId=randomUUID(),html='<figure><figcaption>Bounded</figcaption></figure>';
 assert.throws(()=>pdfCaptionRenderer(header(),{maxBytes:html.length}).section(html,{sectionId}),{code:'PDF_CAPACITY'});assert.throws(()=>pdfCaptionRenderer(header(),{maxBytes:0}),{code:'PDF_LAYOUT'});
 const renderer=pdfCaptionRenderer(header(),{maxBytes:300});for(let i=0;i<2;i++)renderer.section(html,{sectionId:randomUUID()});assert.throws(()=>renderer.lists(),{code:'PDF_CAPACITY'});
 const controller=new AbortController(),cancelled=pdfCaptionRenderer(header(),{signal:controller.signal});controller.abort();assert.throws(()=>cancelled.section(html,{sectionId}),{name:'AbortError'});assert.throws(()=>cancelled.lists(),{name:'AbortError'});
});
