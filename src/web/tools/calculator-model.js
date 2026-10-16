// Editing commands retain the same plain expression format used by saved worksheets.
export const expressionLimits=Object.freeze({rows:100,row:2000,total:20000});
export const expressionRows=value=>String(value??'').split(/\r?\n/);
export function validWorksheet(rows){return Array.isArray(rows)&&rows.length>0&&rows.length<=expressionLimits.rows&&rows.every(row=>typeof row==='string'&&row.length<=expressionLimits.row&&!/[\r\n]/.test(row))&&rows.join('\n').length<=expressionLimits.total;}
export const normalizeSymbols=value=>String(value).replace(/\u00d7/g,'*').replace(/[\u00f7]/g,'/').replace(/[\u2212\u2013]/g,'-').replace(/\u03c0/g,'pi').replace(/\u03c4/g,'tau').replace(/\u00b2/g,'^2').replace(/\u00b3/g,'^3');
export function editExpression(value,start,end,command,text=''){
 start=Math.max(0,Math.min(value.length,start));end=Math.max(start,Math.min(value.length,end));let selected=value.slice(start,end);if(!selected&&start===end&&['square','cube','power','fraction','reciprocal','negate'].includes(command)&&start>0){let begin=start;if(value[start-1]===')'){let depth=0;for(let i=start-1;i>=0;i--){if(value[i]===')')depth++;if(value[i]==='('&&--depth===0){begin=i;while(begin>0&&/[a-zA-Z0-9_]/.test(value[begin-1]))begin--;break;}}}else{const previous=/[a-zA-Z]+$|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.exec(value.slice(0,start));if(previous)begin=start-previous[0].length;}start=begin;selected=value.slice(start,end);}let inserted=text,caret=null;
 if(command==='backspace'){if(start===end&&start>0)start--;inserted='';}
 else if(command==='clear'){start=0;end=value.length;inserted='';}
 else if(command==='function'){inserted=text+'('+selected+')';caret=start+text.length+1+(selected?selected.length+1:0);}
 else if(command==='square'||command==='cube'){inserted='('+selected+')^'+(command==='square'?'2':'3');caret=selected?start+inserted.length:start+1;}
 else if(command==='power'){inserted='('+selected+')^()';caret=selected?start+inserted.length-1:start+1;}
 else if(command==='fraction'){inserted='('+selected+')/()';caret=selected?start+inserted.length-1:start+1;}
 else if(command==='reciprocal'){inserted='1/('+selected+')';caret=selected?start+inserted.length:start+3;}
 else if(command==='negate'){inserted='-('+selected+')';caret=selected?start+inserted.length:start+2;}
 else if(command==='scientific'){inserted=selected?selected+'*10^()':'*10^()';caret=start+inserted.length-1;}
 else if(command!=='insert')throw new TypeError('Unknown calculator edit');
 return {value:value.slice(0,start)+inserted+value.slice(end),start:caret??start+inserted.length,end:caret??start+inserted.length};
}
export function statisticExpression(name,value){
 if(!['mean','median','std','variance','min','max','sum','prod'].includes(name))return null;
 const numbers=String(value).trim().split(/[\s,;]+/);if(!numbers.length||numbers.length>200||numbers.some(n=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(n)))return null;
 return name+'('+numbers.join(', ')+')';
}
export function nextArgument(value,start){for(let i=start;i<value.length;i++)if(value[i]==='('&&value[i+1]===')')return i+1;return value.length;}
