import {AppError} from './errors.js';
import {serialize} from './storage-format.js';
import {openPublicationFigure} from './publication-retained-figures.js';
import {retainedFigureSVG} from './web/retained-figure-svg.js';
import {retainedFigureTable,retainedFigureCSV} from './web/retained-figure-data.js';
import {figureTextChunks,escapeFigureText as esc} from './web/retained-figure-text.js';
import {figureResultView} from './web/result-statements.js';
import {bookText} from './web/book-messages.js';
import {publicationText} from './web/publication-messages.js';
import compositionMessages from './web/locales/en/figureComposition.json' with {type:'json'};
const fail=()=>{throw new AppError('JOB_DAMAGED');};
const withoutSource=value=>{if(!value||typeof value!=='object')return value;const {source,...rest}=value;void source;return rest;};
// Public plot values follow the existing inline projection: authored scientific
// settings remain, but private provenance and storage identities do not escape.
export function publicFigureReader(reader){
 const row=value=>value?{...value,value:typeof value.value==='object'?{...withoutSource(value.value),...(value.value.header?{header:withoutSource(value.value.header)}:{})}:value.value}:value;
 return {
  async header(options){const value=await reader.header(options);return {...value,header:withoutSource(value.header),source:undefined,document:{format:'published-figure',version:1}};},
  async *items(options){for await(const value of reader.items(options))yield row(value);},
  async window(options){const value=await reader.window(options);return {...value,items:value.items.map(row)};},
  async item(options){return row(await reader.item(options));},
  categoryPosition:options=>reader.categoryPosition(options),
  async pointAtCategory(options){return row(await reader.pointAtCategory(options));},
  textChunks(options){if(/(^|\.)source($|\.)/.test(options.field??''))fail();return reader.textChunks(options);}
 };
}
async function* resultLinks(reader,header,figure,results,signal){
 const root=results?.statements.some(value=>value.kind==='figure'&&value.figureId===figure.id);
 if(header.kind!=='panels'||root)yield figureResultView(figure,results,esc);
 if(header.kind!=='panels')return;
 for await(const panel of reader.items({collection:'panels'})){
  signal?.throwIfAborted();const linked=results?.statements.some(value=>value.kind==='figure'&&value.figureId===panel.plotId);
  if(linked){yield '<div class="figure-panel-results"><p>';for await(const text of figureTextChunks(reader,panel.value.label,{collection:'panels',id:panel.id,field:'label'}))yield esc(text);yield '</p>'+figureResultView({id:panel.plotId},results,esc)+'</div>';}
  else if(!root){const [before,after]=compositionMessages.missingPanelResult.split('{panel}');yield '<p>'+esc(before);for await(const text of figureTextChunks(reader,panel.value.label,{collection:'panels',id:panel.id,field:'label'}))yield esc(text);yield esc(after)+'</p>';}
 }
}
export async function* publicationFigureContents(input,recordId,figure,{writer,data=false,results,signal}={}){
 signal?.throwIfAborted();const selected=await input.get('records',recordId),choice=selected?.selection?.figures.find(value=>value.id===figure.id);
 if(!choice||data&&!choice.data)fail();
 const original=await openPublicationFigure(input,recordId,figure.id,{signal});if(serialize(original.originalFigure??original.figure)!==serialize(figure))fail();
 const reader=publicFigureReader(original),{header}=await reader.header(),selection={collection:'header',id:header.id,field:'title'},stem=recordId+'-'+figure.id;
 await writer.retain('figures/'+stem+'.svg',retainedFigureSVG(reader,{signal,idPrefix:'published-'+stem}));
 if(data)await writer.retain('figures/'+stem+'.csv',retainedFigureCSV(reader,{signal}));signal?.throwIfAborted();
 const title=async function*(){for await(const chunk of figureTextChunks(reader,header.title,selection)){signal?.throwIfAborted();yield esc(chunk);}};
 yield '<div class="figure-reading-view"><label class="figure-reading-control"><input type="checkbox"> <span>'+esc(bookText('enlargeFigure'))+'</span></label><p class="figure-reading-hint">'+esc(bookText('panFigure'))+'</p><div class="figure-reading-viewport" role="region" aria-label="'+esc(bookText('figureViewport'))+' ';yield* title();yield '" tabindex="0"><img src="../figures/'+stem+'.svg" alt="';yield* title();yield '"></div></div><figcaption>';yield* title();yield* resultLinks(reader,header,figure,results,signal);yield '</figcaption>';
 if(data){yield '<details><summary>'+esc(publicationText('viewData'))+'</summary>';yield* retainedFigureTable(reader,{signal});yield '</details>';}
 yield '<a href="../figures/'+stem+'.svg" download>'+esc(publicationText('downloadSvg'))+'</a>';
 if(data)yield ' &middot; <a href="../figures/'+stem+'.csv" download>'+esc(publicationText('downloadCsv'))+'</a>';
}
