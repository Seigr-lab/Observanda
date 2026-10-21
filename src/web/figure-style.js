// Presentation is independent of measurements. Old figures use these defaults.
export const FIGURE_FONTS = [['sans','Sans serif'],['serif','Serif'],['mono','Monospace']];
export const FONT_FAMILIES = {sans:'system-ui, sans-serif',serif:'Georgia, serif',mono:'ui-monospace, monospace'};
export const figureStyleDefaults = () => ({
  font:'sans',fontSize:12,titleSize:18,legendSize:12,textColor:'#344155',
  background:'#ffffff',gridColor:'#dde3ed',axisColor:'#8997aa',
  grid:'y',showTitle:true,legendPosition:'top',labelRotation:'auto',
  labelStep:0,numberFormat:'auto',radix:10,decimals:null,dateFormat:'date',annotationLabels:'auto',
  width:840,height:460
});
export const seriesStyleDefaults = () => ({lineWidth:2.3,dash:'solid',marker:'circle',radius:3.5,visible:true});
export const figureStyle = figure => ({...figureStyleDefaults(),...figure.style});
export const seriesStyle = series => ({...seriesStyleDefaults(),...series.style});
const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const within = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v>=min && v<=max;
const schema = {
  font:v=>FIGURE_FONTS.some(([id])=>id===v),fontSize:v=>within(v,8,32),titleSize:v=>within(v,10,48),legendSize:v=>within(v,8,28),
  textColor:color,background:color,gridColor:color,axisColor:color,
  grid:v=>['none','y','both'].includes(v),showTitle:v=>typeof v==='boolean',
  legendPosition:v=>['top','bottom','right'].includes(v),
  labelRotation:v=>['auto','0','-45','-90'].includes(v),
  labelStep:v=>Number.isInteger(v)&&within(v,0,1000),
  numberFormat:v=>['auto','decimal','scientific','percent','radix'].includes(v),
  radix:v=>Number.isInteger(v)&&within(v,2,36),
  decimals:v=>v===null||Number.isInteger(v)&&within(v,0,8),
  dateFormat:v=>['date','month','year','datetime'].includes(v),
  annotationLabels:v=>['auto','key','hidden'].includes(v),
  width:v=>within(v,320,2400),height:v=>within(v,240,2400)
};
const seriesSchema = {
 lineWidth:v=>within(v,.5,10),dash:v=>['solid','dashed','dotted'].includes(v),
 marker:v=>['circle','square','diamond','none'].includes(v),radius:v=>within(v,1,12),visible:v=>typeof v==='boolean'
};
const valid = (value,fields) => value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,v])=>Object.hasOwn(fields,key)&&fields[key](v));
export const validFigureStyle = value => valid(value,schema);
export const validSeriesStyle = value => valid(value,seriesSchema);
export function setFigureDesign(figure, path, value, seriesIndex = null) {
  const target = seriesIndex === null ? figure : figure.series[seriesIndex];
  if (!target) return;
  if (path.startsWith('style.')) {
    const key = path.slice(6), fields = seriesIndex === null ? schema : seriesSchema;
    if (Object.hasOwn(fields,key) && fields[key](value)) (target.style ??= {})[key]=value;
  } else if (seriesIndex !== null && ['name','color'].includes(path)) target[path]=value;
  else if (['title','legend'].includes(path)) figure[path]=value;
  else if (path==='x.label'||path==='y.label') figure[path[0]].label=value;
}
