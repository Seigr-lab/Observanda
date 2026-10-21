import {calculateDetailed,calculationPreview,convertBase,spreadsheet} from './math.js';
import {chemicalPreview} from './chemistry.js';
self.onmessage=({data})=>{try{
 if(data.kind==='calculator'&&data.value.mode!=='bases'&&data.value.expression.split(/\r?\n/).filter(v=>v.trim()).length>100)throw Error('Use up to 100 expressions in one worksheet.');
 let result;if(data.kind==='calculator-sheet'){
  const value=data.value,rows=value.expression.split(/\r?\n/);if(rows.length>100||value.expression.length>20000)throw Error('Use up to 100 expressions in one worksheet.');
  result=value.mode==='bases'?convertBase(value.digits,Number(value.fromBase),Number(value.toBase),{engine:value.engine??1}):rows.map(expression=>{if(!expression.trim())return {expression,empty:true};try{return {expression,...calculateDetailed(expression,{angle:value.angle,engine:value.engine??1}),tex:calculationPreview(expression)};}catch(e){return {expression,error:e.message};}});
 }else if(data.kind==='calculator')result=data.value.mode==='bases'?convertBase(data.value.digits,Number(data.value.fromBase),Number(data.value.toBase),{engine:data.value.engine??1}):data.value.expression.split(/\r?\n/).filter(v=>v.trim()).map(expression=>{try{return {expression,...calculateDetailed(expression,{angle:data.value.angle,engine:data.value.engine??1})};}catch(e){return {expression,error:e.message};}});
 else if(data.kind==='spreadsheet')result=spreadsheet(data.value.cells,{engine:data.value.engine??1});
 else if(data.kind==='chemical')result=chemicalPreview(data.value.source,data.value.format);
 else throw Error('Unknown tool');self.postMessage({result});
 }catch(e){self.postMessage({error:e.message});}};
