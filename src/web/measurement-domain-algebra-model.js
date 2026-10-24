import {validDomainDefinition,knownDomain,domainCodec,domainComponentCount,domainComponentPosition,domainComponentIndex} from './measurement-domain-model.js';
export const DOMAIN_ALGEBRA_OPERATIONS=['add','subtract','dot','matmul','multiply','divide'];
export const validDomainAlgebraOperation=operation=>DOMAIN_ALGEBRA_OPERATIONS.includes(operation);
export class DomainAlgebraError extends Error{constructor(code='MEASUREMENT_DOMAIN_INCOMPATIBLE'){super(code);this.code=code;}}
const fail=(code)=>{throw new DomainAlgebraError(code);};
// Shapes and codec namespaces are declarations. Component radix can differ;
// each exact component is interpreted under its own pinned context.
export function domainAlgebraShape(operation,left,right){
 if(!validDomainAlgebraOperation(operation))fail();
 for(const domain of [left,right])if(!validDomainDefinition(domain)||!knownDomain(domain)||!['vector','matrix','complex','tensor'].includes(domainCodec(domain)))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');
 const codec=domainCodec(left);if(left.codec!==right.codec||left.codecVersion!==right.codecVersion||left.namespace!==right.namespace)fail();
 const same=left.shape.length===right.shape.length&&left.shape.every((n,i)=>n===right.shape[i]);
 if(['add','subtract'].includes(operation)){if(!same)fail();return {codec,shape:[...left.shape]};}
 if(operation==='dot'){if(codec!=='vector'||!same)fail();return {codec:null,shape:[]};}
 if(operation==='matmul'){
  if(codec!=='matrix'||left.shape[1]!==right.shape[0])fail();const shape=[left.shape[0],right.shape[1]];domainComponentCount({shape});return {codec:'matrix',shape};
 }
 if(codec!=='complex'||!same)fail();return {codec:'complex',shape:[2]};
}


// Reshape changes grouping only. The explicit shape fixes the destination codec
// and the source's last-axis-fastest component ordinal is preserved unchanged.
export function domainReshapeShape(source,shape){
 if(!validDomainDefinition(source)||!knownDomain(source)||!['vector','matrix','tensor'].includes(domainCodec(source)))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');
 if(!Array.isArray(shape)||!shape.length||shape.length>16||!shape.every(n=>Number.isSafeInteger(n)&&n>0))fail();
 let count;try{count=domainComponentCount({shape});}catch{fail();}
 if(count!==domainComponentCount(source))fail();
 return {codec:shape.length===1?'vector':shape.length===2?'matrix':'tensor',shape:[...shape]};
}

// Destination axis j comes from source axis axes[j]. Repeated or omitted axes
// are refused even when their lengths are equal or singleton.
export function domainPermutationShape(source,axes){
 if(!validDomainDefinition(source)||!knownDomain(source)||!['vector','matrix','tensor'].includes(domainCodec(source)))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');
 const rank=source.shape.length;
 if(!Array.isArray(axes)||axes.length!==rank||!Array.from(axes).every(axis=>Number.isSafeInteger(axis)&&axis>=0&&axis<rank)||new Set(axes).size!==rank)fail();
 return {codec:domainCodec(source),shape:axes.map(axis=>source.shape[axis])};
}
export function domainPermutationIndex(source,axes,index,budget){
 const target=domainPermutationShape(source,axes);let destination;
 try{destination=domainComponentPosition(target,index);}catch{fail();}
 const position=Array(axes.length);
 for(let axis=0;axis<axes.length;axis++){budget?.step();position[axes[axis]]=destination[axis];}
 return domainComponentIndex(source,position);
}
