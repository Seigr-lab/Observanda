import {t} from './i18n/index.js';
import {scientificText as st,figureFontOptions} from './scientific-editor-text.js';
import {FIGURE_FONTS,figureStyle,seriesStyle} from './figure-style.js';
import {heatmapText as h} from './figure-heatmap-ui.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function figureDesignView(figure,{tab='text',keys=figure.series.map((s,i)=>String(i))}={}){
 const style=figureStyle(figure);
 const attrs=(path,key)=>`data-figure-design="${path}" ${key===undefined?'':'data-design-series="'+esc(key)+'"'}`;
 const input=(path,label,value,type='text',key,limits='')=>`<label>${esc(label)}<input aria-label="${esc(label)}" type="${type}" ${attrs(path,key)} value="${esc(value)}" ${limits}></label>`;
 const select=(path,label,values,value,key)=>`<label>${esc(label)}<select aria-label="${esc(label)}" ${attrs(path,key)}>${values.map(([id,label])=>`<option value="${id}" ${String(id)===String(value)?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
 const check=(path,label,value,key)=>`<label class="figure-column-check"><input aria-label="${esc(label)}" type="checkbox" ${attrs(path,key)} ${value?'checked':''}>${esc(label)}</label>`;
 let content='';
 if(figure.kind==='heatmap')content=tab==='text'?`<div class="figure-design-fields">${input('title',h('title'),figure.title)}${check('style.showTitle',h('showTitle'),style.showTitle)}${input('x.label',h('column'),figure.x.label)}${input('y.label',h('row'),figure.y.label)}${select('style.font',h('font'),figureFontOptions(FIGURE_FONTS),style.font)}${input('style.fontSize',h('fontSize'),style.fontSize,'number',undefined,'min="8" max="32"')}${input('style.titleSize',h('titleSize'),style.titleSize,'number',undefined,'min="10" max="48"')}${input('style.textColor',h('textColor'),style.textColor,'color')}${select('style.numberFormat',h('numberFormat'),['auto','decimal','scientific','percent','radix'].map(v=>[v,h(v)]),style.numberFormat)}${input('style.decimals',h('decimals'),style.decimals,'number',undefined,'min="0" max="8"')}${input('style.radix',h('numeralBase'),style.radix,'number',undefined,'min="2" max="36" step="1"')}<p class="editor-hint">${esc(h('radixHelp'))}</p></div>`:tab==='appearance'?`<div class="figure-design-fields">${input('style.background',h('background'),style.background,'color')}${input('style.width',h('width'),style.width,'number',undefined,'min="320" max="2400"')}</div>`:figure.series.map((series,i)=>`<fieldset><legend>${esc(series.name)}</legend>${check('style.visible',h('rowVisible'),seriesStyle(series).visible,keys[i])}${input('name',h('rowName'),series.name,'text',keys[i])}</fieldset>`).join('');
 else if(tab==='text')content=`
  <div class="figure-design-fields">
   ${input('title',t("figureHeatmap","title"),figure.title)}
   ${check('style.showTitle',t("figureHeatmap","showTitle"),style.showTitle)}
   ${input('x.label',figure.kind==='bar-horizontal'?st("categoryAxisLabel"):st("horizontalAxisLabel"),figure.x.label)}
   ${input('y.label',figure.kind==='bar-horizontal'?st("valueAxisLabel"):st("verticalAxisLabel"),figure.y.label)}
   ${select('style.font',t("retainedFigureEditor","style.font"),figureFontOptions(FIGURE_FONTS),style.font)}
   <div class="figure-design-pair">${input('style.fontSize',t("figureHeatmap","fontSize"),style.fontSize,'number',undefined,'min="8" max="32"')}${input('style.titleSize',t("retainedFigureEditor","style.titleSize"),style.titleSize,'number',undefined,'min="10" max="48"')}</div>
   ${input('style.textColor',t("figureHeatmap","textColor"),style.textColor,'color')}
   ${figure.x.kind==='category'&&figure.kind!=='bar-horizontal'?select('style.labelRotation',st("categoryLabelAngle"),[['auto',t("retainedFigureEditor","option_auto")],['0',st("horizontal")],['-45',st("diagonal")],['-90',st("vertical")]],style.labelRotation):''}
   ${input('style.labelStep',st("labelInterval"),style.labelStep,'number',undefined,'min="0" max="1000" step="1"')}
   <div class="figure-design-pair">${select('style.numberFormat',t("retainedFigureEditor","style.numberFormat"),[['auto',t("retainedFigureEditor","option_auto")],['decimal',t("retainedFigureEditor","option_decimal")],['scientific',t("retainedFigureEditor","option_scientific")],['percent',t("figureHeatmap","percent")],['radix',t("retainedFigureEditor","style.radix")]],style.numberFormat)}${input('style.decimals',t("figureHeatmap","decimals"),style.decimals,'number',undefined,'min="0" max="8" step="1"')}</div>
   ${input('style.radix',h('numeralBase'),style.radix,'number',undefined,'min="2" max="36" step="1"')}<p class="editor-hint">${esc(h('radixHelp'))}</p>
   ${figure.x.kind==='date'?select('style.dateFormat',t("retainedFigureEditor","style.dateFormat"),[['date',st("yearMonthDay")],['month',st("yearMonth")],['year',t("retainedFigureEditor","option_year")],['datetime',st("dateTimeUTC")]],style.dateFormat):''}
  </div>`;
 else if(tab==='appearance')content=`<div class="figure-design-fields">
  <div class="figure-design-pair">${input('style.background',t("figureHeatmap","background"),style.background,'color')}${input('style.axisColor',st("axesColour"),style.axisColor,'color')}</div>
  <div class="figure-design-pair">${select('style.grid',t("retainedFigureEditor","style.grid"),[['none',t("retainedFigureEditor","option_none")],['y',t("figureComposition","value")],['both',st("bothAxes")]],style.grid)}${input('style.gridColor',st("gridColour"),style.gridColor,'color')}</div>
  ${check('legend',st("showSeriesLegend"),figure.legend)}
  <div class="figure-design-pair">${select('style.legendPosition',t("retainedFigureEditor","style.legendPosition"),[['top',t("retainedFigureEditor","option_top")],['bottom',t("retainedFigureEditor","option_bottom")],['right',t("retainedFigureEditor","option_right")]],style.legendPosition)}${input('style.legendSize',t("retainedFigureEditor","style.legendSize"),style.legendSize,'number',undefined,'min="8" max="28"')}</div>
  <div class="figure-design-pair">${input('style.width',t("figureHeatmap","width"),style.width,'number',undefined,'min="320" max="2400"')}${input('style.height',st("minimumExportHeight"),style.height,'number',undefined,'min="240" max="2400"')}</div>
  <p class="editor-hint">${esc(st("previewWidthHelp"))}</p>
 </div>`;
 else content=figure.series.map((series,i)=>{
  const line=seriesStyle(series),key=keys[i],bars=figure.kind.startsWith('bar');
  return `<fieldset class="figure-trace-design"><legend>${esc(series.name)}</legend>
   ${check('style.visible',t("retainedFigureEditor","style.visible"),line.visible,key)}
   <div class="figure-design-pair">${input('name',t("retainedFigureEditor","name"),series.name,'text',key)}${input('color',st("colour"),series.color,'color',key)}</div>
   ${bars?'':`<div class="figure-design-pair">${input('style.lineWidth',t("retainedFigureEditor","style.lineWidth"),line.lineWidth,'number',key,'min="0.5" max="10" step="0.5"')}${select('style.dash',st("lineStyle"),[['solid',t("retainedFigureEditor","option_solid")],['dashed',t("retainedFigureEditor","option_dashed")],['dotted',t("retainedFigureEditor","option_dotted")]],line.dash,key)}</div>
   <div class="figure-design-pair">${select('style.marker',st("marker"),[['circle',t("retainedFigureEditor","option_circle")],['square',t("retainedFigureEditor","option_square")],['diamond',t("retainedFigureEditor","option_diamond")],...(figure.kind==='scatter'?[]:[['none',t("retainedFigureEditor","option_none")]])],line.marker,key)}${input('style.radius',st("markerSize"),line.radius,'number',key,'min="1" max="12" step="0.5"')}</div>`}
  </fieldset>`;
 }).join('');
 return `<section class="figure-design-panel" aria-label="${esc(st("graphPresentation"))}"><div class="figure-design-title">${esc(st("graphPresentation"))}</div>
  <div class="figure-design-tabs" role="tablist" aria-label="${esc(st("graphPresentation"))}">${[['text',st("text")],['appearance',st("appearance")],['series',t("retainedFigureEditor","series")]].map(([id,label])=>`<button type="button" role="tab" aria-selected="${id===tab}" data-action="figure-design-tab" data-tab="${id}">${esc(label)}</button>`).join('')}</div>
  <div role="tabpanel">${content}</div></section>`;
}
export function figureDesignInput(target){
 if(!target.matches('[data-figure-design]'))return null;
 return {path:target.dataset.figureDesign,key:target.dataset.designSeries,
  value:target.type==='checkbox'?target.checked:target.type==='number'?(target.value===''?null:Number(target.value)):target.value};
}
