// Retain a fit label only when an operation preserves the selected fitted value.
import {revisionText} from './revision-model.js';
export function weightedFitGraphColumn(node,inputs,column){
 if(node.kind==='column'||node.kind==='window'&&['lag','lead'].includes(node.operation))return column;
 const {weightedFit,...plain}=column,source=inputs[0]?.weightedFit;if(!source)return plain;
 if(node.kind==='scalar'&&node.operation==='copy'||node.kind==='scalar'&&node.operation==='choose'&&revisionText(source)===revisionText(inputs[1]?.weightedFit??null))return {...plain,weightedFit:structuredClone(source)};
 return plain;
}
