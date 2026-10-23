import messages from './locales/en/figureHeatmap.json' with {type:'json'};
const keys=(v,k)=>v&&Object.keys(v).sort().join()===k.sort().join();
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f]/u.test(v);
export const defaultHeatmap=()=>({valueLabel:'',showValues:true,missingColor:'#e5e7eb',thresholds:[{max:0,color:'#4575b4',label:messages.low},{max:1,color:'#ffffbf',label:messages.middle},{max:null,color:'#d73027',label:messages.high}]});
export function heatmapIssues(figure,{draft=false,retained=false}={}){
 const h=figure.heatmap;
 if(h!==undefined&&(!keys(h,['valueLabel','showValues','missingColor','thresholds'])||!text(h.valueLabel,retained?Infinity:300)||typeof h.showValues!=='boolean'||!color(h.missingColor)||!Array.isArray(h.thresholds)||!h.thresholds.length||h.thresholds.length>32||h.thresholds.some((b,i)=>!keys(b,['max','color','label'])||!color(b.color)||!text(b.label,retained?Infinity:100)||!draft&&!b.label.trim()||(i===h.thresholds.length-1?b.max!==null:!Number.isFinite(b.max)||Math.abs(b.max)>1e100||i>0&&b.max<=h.thresholds[i-1].max))))return [messages.invalid];
 if(figure.kind!=='heatmap')return [];
 if(!h||figure.x.reversed||figure.y.reversed||figure.x.ticks?.length||figure.y.ticks?.length||figure.x.kind!=='category'||!retained&&figure.series.length>100||figure.annotations?.length||figure.x.scale!=='linear'||figure.y.scale!=='linear')return [messages.matrixInvalid];
 const columns=new Set();
 for(const s of figure.series){const seen=new Set();for(const p of s.points){if(!draft&&seen.has(p.x)||p.error!==null)return [messages.matrixInvalid];seen.add(p.x);columns.add(p.x);}}
 return !retained&&columns.size>100?[messages.matrixInvalid]:[];
}
export function heatmapBand(value,settings){return settings.thresholds.find(b=>b.max===null||value<=b.max);}
export const heatmapThresholdText=(settings,i,format=value=>value)=>{const b=settings.thresholds[i],prior=settings.thresholds[i-1];return b.max===null?(prior?'> '+format(prior.max):messages.allValues):(prior?'> '+format(prior.max)+'; ':'')+'≤ '+format(b.max);};
