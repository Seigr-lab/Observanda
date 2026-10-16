import {figureStyle,seriesStyle,FONT_FAMILIES} from './figure-style.js';
import {wrapFigureText} from './figure-text-layout.js';
import {formatFigureNumber} from './figure-number-labels.js';
import {heatmapBand,heatmapThresholdText} from './figure-heatmap.js';
import messages from './locales/en/figureHeatmap.json' with {type:'json'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const foreground=color=>{const rgb=color.slice(1).match(/../g).map(v=>{const n=parseInt(v,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#000000':'#ffffff';};
export function renderHeatmap(figure,{width}={}){
 const style=figureStyle(figure),settings=figure.heatmap,rows=figure.series.filter(s=>seriesStyle(s).visible),columns=[...new Set(rows.flatMap(s=>s.points.map(p=>p.x)))];
 width=Math.max(320,width??style.width);const size=style.fontSize,left=Math.min(width*.35,Math.max(90,...rows.map(s=>s.name.length*size*.64+16))),cellW=Math.max(50,(width-left-24)/Math.max(1,columns.length));width=Math.max(width,left+cellW*columns.length+24);
 const title=style.showTitle?wrapFigureText(figure.title,width-40,style.titleSize):[],columnLines=columns.map(label=>wrapFigureText(label,cellW-8,size)),rowLines=rows.map(s=>wrapFigureText(s.name,left-24,size)),headerLines=Math.max(1,...columnLines.map(v=>v.length)),top=28+title.length*style.titleSize*1.3+size*(3+headerLines*1.25),cellH=Math.max(38,size*(Math.max(1,...rowLines.map(v=>v.length))*1.25+1)),bottom=top+rows.length*cellH;
 const text=(value,x,y,{anchor='middle',fill=style.textColor,font=size,lines=[String(value)]}={})=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${font}" fill="${fill}"><title>${esc(value)}</title>${lines.map((line,i)=>`<tspan x="${x}" dy="${i?font*1.25:0}">${esc(line)}</tspan>`).join('')}</text>`;
 let drawing=text(figure.title,width/2,style.titleSize+8,{font:style.titleSize,lines:title});
 drawing+=text(figure.x.label,left+cellW*columns.length/2,top-size*(headerLines*1.25+1.5));drawing+=text(figure.y.label,8,top-size*.5,{anchor:'start'});
 columns.forEach((label,i)=>{drawing+=text(label,left+(i+.5)*cellW,top-size*(headerLines*1.25),{lines:columnLines[i]});});
 rows.forEach((series,r)=>{drawing+=text(series.name,left-12,top+r*cellH+size*1.5,{anchor:'end',lines:rowLines[r]});const byX=new Map(series.points.map(p=>[p.x,p]));
  columns.forEach((column,c)=>{const p=byX.get(column),value=p?.y??null,band=value===null?null:heatmapBand(value,settings),fill=band?.color??settings.missingColor,x=left+c*cellW,y=top+r*cellH,label=value===null?'—':formatFigureNumber(value,style);
   drawing+=`<g class="figure-heatmap-cell" data-row="${r}" data-column="${c}" data-value="${value??''}"><title>${esc(series.name+' · '+column+': '+(value===null?messages.missing:value)+(band?' · '+band.label:''))}</title><rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill}" stroke="${style.background}"/>${settings.showValues?text(label,x+cellW/2,y+cellH*.62,{fill:foreground(fill),font:Math.min(size,(cellW-8)/Math.max(1,label.length)*1.5)}):''}</g>`;
  });
 });
 let cursor=bottom+size*2.5;drawing+=text(settings.valueLabel||messages.value,left,cursor,{anchor:'start'});cursor+=size*2;
 for(let i=0;i<settings.thresholds.length;i++){const b=settings.thresholds[i],label=b.label+' · '+heatmapThresholdText(settings,i),lines=wrapFigureText(label,width-left-36,size);drawing+=`<rect x="${left}" y="${cursor-size}" width="18" height="${size}" fill="${b.color}"/>`+text(label,left+28,cursor,{anchor:'start',lines});cursor+=size*(1.3*lines.length+.8);}
 drawing+=`<rect x="${left}" y="${cursor-size}" width="18" height="${size}" fill="${settings.missingColor}"/>`+text(messages.missing,left+28,cursor,{anchor:'start'});cursor+=size*2;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${cursor}" width="${width}" height="${cursor}" role="img" aria-label="${esc(figure.title)}"><title>${esc(figure.title)}</title><desc>${esc(messages.help)}</desc><rect width="100%" height="100%" fill="${style.background}"/><g font-family="${FONT_FAMILIES[style.font]}">${drawing}</g></svg>`;
}
