import {modelMessages} from './model-messages.js';
import displayMessages from './locales/en/figureDisplay.json' with {type:'json'};
import {computationLabel} from './measurement-computation.js';
import {validMeasurementProjection,projectionTransform} from './measurement-transform.js';
import {numeralUsesRadix} from './numeral-context.js';
import {wrapFigureText} from './figure-text-layout.js';
import {figureStyle,FONT_FAMILIES} from './figure-style.js';
import messages from './locales/en/measurementTransform.json' with {type:'json'};

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const quantity=q=>numeralUsesRadix(q.representation)?q.radix+'#('+q.spelling+')':q.spelling;
export function projectionAxisLabel(figure,axis,{translate}={}){
 const text=modelMessages('measurementTransform',messages,translate);
 const savedLabel=figure.kind==='heatmap'&&axis==='y'?figure.heatmap.valueLabel:figure[axis].label,label=savedLabel||(axis==='x'?'X':modelMessages('figureDisplay',displayMessages,translate)('value'));
 return figure.projection?.[axis]?text('projectedAxis',{label}):savedLabel;
}
export function projectionDescription(figure,{translate}={}){
 const text=modelMessages('measurementTransform',messages,translate);
 if(!validMeasurementProjection(figure.projection))return [];
 return ['x','y'].filter(axis=>figure.projection[axis]).map(axis=>{
  const transform=figure.projection[axis];return text('formula',{axis:projectionAxisLabel(figure,axis,{translate}),origin:quantity(transform.origin),scale:quantity(transform.scale)});
 });
}
export function sameAxisProjection(a,b,axis){
 const canonical=f=>{const t=projectionTransform(f.projection?.[axis],{resourcePolicy:f.projection?.resourcePolicy});return [String(t.origin.numerator),String(t.origin.denominator),String(t.scale.numerator),String(t.scale.denominator)];};
 return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
export function projectionTableDescription(figure,{translate}={}){
 const text=modelMessages('measurementTransform',messages,translate);
 const label=computationLabel(figure,{translate}),interpretation=label?'<p class="figure-computation-description">'+escape(label)+'</p>':'';
 const lines=projectionDescription(figure,{translate});return interpretation+(lines.length?'<aside class="figure-projection-description"><h4>'+escape(text('retained'))+'</h4>'+lines.map(line=>'<p>'+escape(line)+'</p>').join('')+'<p>'+escape(text('coordinateValues'))+'</p></aside>':'');
}
// The formula travels inside standalone SVG exports, including heatmaps. It is
// wrapped completely rather than clipped to an axis title or a tooltip.
export function appendProjectionDescription(svg,figure,{translate}={}){
 const text=modelMessages('measurementTransform',messages,translate);
 const descriptions=projectionDescription(figure,{translate}),label=computationLabel(figure,{translate});if(!descriptions.length&&!label)return svg;
 const box=svg.match(/^<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/);if(!box)throw new Error('Missing figure view box');
 const width=Number(box[1]),height=Number(box[2]),style=figureStyle(figure),size=style.fontSize,lineHeight=size*1.3;
 const lines=[...(label?[label]:[]),...(descriptions.length?[text('retained'),...descriptions,text('coordinateValues')]:[])].flatMap(line=>wrapFigureText(line,width-40,size)),extra=lines.length*lineHeight+32,total=height+extra;
 const footer='<g class="figure-projection-description" fill="'+style.textColor+'" font-family="'+FONT_FAMILIES[style.font]+'" font-size="'+size+'"><rect x="0" y="'+height+'" width="'+width+'" height="'+extra+'" fill="'+style.background+'"/>'+lines.map((line,i)=>'<text x="20" y="'+(height+20+i*lineHeight)+'">'+escape(line)+'</text>').join('')+'</g>';
 return svg.replace(/^<svg[^>]*>/,tag=>tag.replace(/viewBox="[^"]+"/,'viewBox="0 0 '+width+' '+total+'"').replace(/ height="[^"]+"/,' height="'+total+'"')).replace(/<\/svg>$/,footer+'</svg>');
}
