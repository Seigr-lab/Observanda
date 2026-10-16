import {calculate,calculationPreview,convertBase,spreadsheet} from './math.js';
import {chemicalPreview} from './chemistry.js';
self.onmessage=({data})=>{try{
 if(data.kind==='calculator'&&data.value.mode!=='bases'&&data.value.expression.split(/\r?\n/).filter(v=>v.trim()).length>100)throw Error('Use up to 100 expressions in one worksheet.');
 let result;if(data.kind==='calculator-sheet'){
  const value=data.value,rows=value.expression.split(/\r?\n/);if(rows.length>100||value.expression.length>20000)throw Error('Use up to 100 expressions in one worksheet.');
  result=value.mode==='bases'?convertBase(value.digits,Number(value.fromBase),Number(value.toBase)):rows.map(expression=>{if(!expression.trim())return {expression,empty:true};try{return {expression,result:calculate(expression,{angle:value.angle}),tex:calculationPreview(expression)};}catch(e){return {expression,error:e.message};}});
 }else if(data.kind==='calculator')result=data.value.mode==='bases'?convertBase(data.value.digits,Number(data.value.fromBase),Number(data.value.toBase)):data.value.expression.split(/\r?\n/).filter(v=>v.trim()).map(expression=>{try{return {expression,result:calculate(expression,{angle:data.value.angle})};}catch(e){return {expression,error:e.message};}});
 else if(data.kind==='spreadsheet')result=spreadsheet(data.value.cells);
 else if(data.kind==='chemical')result=chemicalPreview(data.value.source,data.value.format);
 else throw Error('Unknown tool');self.postMessage({result});
 }catch(e){self.postMessage({error:e.message});}};
