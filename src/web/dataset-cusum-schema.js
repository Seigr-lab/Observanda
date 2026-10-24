// Keep a method label only while a graph still represents that same result.
import {revisionText} from './revision-model.js';
export function cusumGraphColumn(node,inputs,column){
 if(node.kind==='column'||node.kind==='window'&&['lag','lead'].includes(node.operation))return column;
 const {cusum,...plain}=column,source=inputs[0]?.cusum;if(!source)return plain;
 if(node.kind==='scalar'&&node.operation==='copy')return {...plain,cusum:structuredClone(source)};
 if(node.kind==='scalar'&&node.operation==='choose'&&revisionText(source)===revisionText(inputs[1]?.cusum??null))return {...plain,cusum:structuredClone(source)};
 return plain;
}
