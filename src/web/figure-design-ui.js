import {FIGURE_FONTS,figureStyle,seriesStyle} from './figure-style.js';
import {heatmapText as h} from './figure-heatmap-ui.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function figureDesignView(figure,{tab='text',keys=figure.series.map((s,i)=>String(i))}={}){
 const style=figureStyle(figure);
 const attrs=(path,key)=>`data-figure-design="${path}" ${key===undefined?'':'data-design-series="'+esc(key)+'"'}`;
 const input=(path,label,value,type='text',key,limits='')=>`<label>${label}<input aria-label="${esc(label)}" type="${type}" ${attrs(path,key)} value="${esc(value)}" ${limits}></label>`;
 const select=(path,label,values,value,key)=>`<label>${label}<select aria-label="${esc(label)}" ${attrs(path,key)}>${values.map(([id,label])=>`<option value="${id}" ${String(id)===String(value)?'selected':''}>${label}</option>`).join('')}</select></label>`;
 const check=(path,label,value,key)=>`<label class="figure-column-check"><input aria-label="${esc(label)}" type="checkbox" ${attrs(path,key)} ${value?'checked':''}>${label}</label>`;
 let content='';
 if(figure.kind==='heatmap')content=tab==='text'?`<div class="figure-design-fields">${input('title',h('title'),figure.title)}${check('style.showTitle',h('showTitle'),style.showTitle)}${input('x.label',h('column'),figure.x.label)}${input('y.label',h('row'),figure.y.label)}${select('style.font',h('font'),FIGURE_FONTS,style.font)}${input('style.fontSize',h('fontSize'),style.fontSize,'number',undefined,'min="8" max="32"')}${input('style.titleSize',h('titleSize'),style.titleSize,'number',undefined,'min="10" max="48"')}${input('style.textColor',h('textColor'),style.textColor,'color')}${select('style.numberFormat',h('numberFormat'),['auto','decimal','scientific','percent'].map(v=>[v,h(v)]),style.numberFormat)}${input('style.decimals',h('decimals'),style.decimals,'number',undefined,'min="0" max="8"')}</div>`:tab==='appearance'?`<div class="figure-design-fields">${input('style.background',h('background'),style.background,'color')}${input('style.width',h('width'),style.width,'number',undefined,'min="320" max="2400"')}</div>`:figure.series.map((series,i)=>`<fieldset><legend>${esc(series.name)}</legend>${check('style.visible',h('rowVisible'),seriesStyle(series).visible,keys[i])}${input('name',h('rowName'),series.name,'text',keys[i])}</fieldset>`).join('');
 else if(tab==='text')content=`
  <div class="figure-design-fields">
   ${input('title','Figure title',figure.title)}
   ${check('style.showTitle','Title inside graph',style.showTitle)}
   ${input('x.label',figure.kind==='bar-horizontal'?'Category axis label':'Horizontal axis label',figure.x.label)}
   ${input('y.label',figure.kind==='bar-horizontal'?'Value axis label':'Vertical axis label',figure.y.label)}
   ${select('style.font','Font',FIGURE_FONTS,style.font)}
   <div class="figure-design-pair">${input('style.fontSize','Label size',style.fontSize,'number',undefined,'min="8" max="32"')}${input('style.titleSize','Title size',style.titleSize,'number',undefined,'min="10" max="48"')}</div>
   ${input('style.textColor','Text colour',style.textColor,'color')}
   ${figure.x.kind==='category'&&figure.kind!=='bar-horizontal'?select('style.labelRotation','Category label angle',[['auto','Automatic'],['0','Horizontal'],['-45','Diagonal'],['-90','Vertical']],style.labelRotation):''}
   ${input('style.labelStep','Label interval · 0 fits automatically',style.labelStep,'number',undefined,'min="0" max="1000" step="1"')}
   <div class="figure-design-pair">${select('style.numberFormat','Number format',[['auto','Automatic'],['decimal','Decimal'],['scientific','Scientific'],['percent','Percentage']],style.numberFormat)}${input('style.decimals','Decimal places · blank is automatic',style.decimals,'number',undefined,'min="0" max="8" step="1"')}</div>
   ${figure.x.kind==='date'?select('style.dateFormat','Date format',[['date','Year-month-day'],['month','Year-month'],['year','Year'],['datetime','Date and time (UTC)']],style.dateFormat):''}
  </div>`;
 else if(tab==='appearance')content=`<div class="figure-design-fields">
  <div class="figure-design-pair">${input('style.background','Background',style.background,'color')}${input('style.axisColor','Axes colour',style.axisColor,'color')}</div>
  <div class="figure-design-pair">${select('style.grid','Grid lines',[['none','None'],['y','Value axis'],['both','Both axes']],style.grid)}${input('style.gridColor','Grid colour',style.gridColor,'color')}</div>
  ${check('legend','Show series legend',figure.legend)}
  <div class="figure-design-pair">${select('style.legendPosition','Legend position',[['top','Top'],['bottom','Bottom'],['right','Right']],style.legendPosition)}${input('style.legendSize','Legend size',style.legendSize,'number',undefined,'min="8" max="28"')}</div>
  <div class="figure-design-pair">${input('style.width','Export width (px)',style.width,'number',undefined,'min="320" max="2400"')}${input('style.height','Minimum export height (px)',style.height,'number',undefined,'min="240" max="2400"')}</div>
  <p class="editor-hint">The preview fits its available width. Category lists grow vertically to keep labels readable.</p>
 </div>`;
 else content=figure.series.map((series,i)=>{
  const line=seriesStyle(series),key=keys[i],bars=figure.kind.startsWith('bar');
  return `<fieldset class="figure-trace-design"><legend>${esc(series.name)}</legend>
   ${check('style.visible','Show series',line.visible,key)}
   <div class="figure-design-pair">${input('name','Name',series.name,'text',key)}${input('color','Colour',series.color,'color',key)}</div>
   ${bars?'':`<div class="figure-design-pair">${input('style.lineWidth','Line width',line.lineWidth,'number',key,'min="0.5" max="10" step="0.5"')}${select('style.dash','Line style',[['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']],line.dash,key)}</div>
   <div class="figure-design-pair">${select('style.marker','Marker',[['circle','Circle'],['square','Square'],['diamond','Diamond'],...(figure.kind==='scatter'?[]:[['none','None']])],line.marker,key)}${input('style.radius','Marker size',line.radius,'number',key,'min="1" max="12" step="0.5"')}</div>`}
  </fieldset>`;
 }).join('');
 return `<section class="figure-design-panel" aria-label="Graph presentation"><div class="figure-design-title">Graph presentation</div>
  <div class="figure-design-tabs" role="tablist" aria-label="Graph presentation">${[['text','Text'],['appearance','Appearance'],['series','Series']].map(([id,label])=>`<button type="button" role="tab" aria-selected="${id===tab}" data-action="figure-design-tab" data-tab="${id}">${label}</button>`).join('')}</div>
  <div role="tabpanel">${content}</div></section>`;
}
export function figureDesignInput(target){
 if(!target.matches('[data-figure-design]'))return null;
 return {path:target.dataset.figureDesign,key:target.dataset.designSeries,
  value:target.type==='checkbox'?target.checked:target.type==='number'?(target.value===''?null:Number(target.value)):target.value};
}
