import katex from 'katex';
// Native MathML needs no web font, CSS injection, network request or runtime script.
// Fresh macro state and finite expansion/size limits are applied to every block.
export function renderEquation(source){return katex.renderToString(source,{output:'mathml',displayMode:true,trust:false,strict:'error',throwOnError:true,maxExpand:100,maxSize:20,macros:{}});}
