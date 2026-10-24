// A derived column must not keep a method label for a value it no longer holds.
import {revisionText} from './revision-model.js';
import {spectrumComponentDescriptor} from './dataset-spectrum-model.js';
export function spectrumGraphColumn(node,inputs,column){
 if(node.kind==='column'||node.kind==='window'&&['lag','lead'].includes(node.operation))return column;
 const {spectrum,...plain}=column,source=inputs[0]?.spectrum;
 if(!source)return plain;
 if(node.kind==='domain'&&node.operation==='extract')return {...plain,spectrum:spectrumComponentDescriptor(source,node.component?.length===1?node.component[0]:null)};
 if(['domain','scalar'].includes(node.kind)&&node.operation==='copy')return {...plain,spectrum:structuredClone(source)};
 if(['domain','scalar'].includes(node.kind)&&node.operation==='choose'&&revisionText(source)===revisionText(inputs[1]?.spectrum??null))return {...plain,spectrum:structuredClone(source)};
 if(['domain-reshape','domain-permute'].includes(node.kind)&&inputs[0]?.domain?.codec==='observanda.complex'&&column.domain?.codec==='observanda.complex')return {...plain,spectrum:structuredClone(source)};
 return plain;
}
