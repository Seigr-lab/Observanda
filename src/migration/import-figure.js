import {AppError} from '../errors.js';
import {validFigure} from '../web/figure-model.js';
import {importContent} from './content.js';
import {mappedId} from './import-model.js';
import {cloneFigure} from '../web/figure-composition.js';

// Portable figure JSON is a plotting representation. Its original numeric
// spellings also remain editable text; approximate coordinates need review.
export async function prepareImportedFigure(content,file,recordId,{signal}={}){
 const result=await importContent(content,file,'json',{signal});let figure,approximate=0;
 try{figure=JSON.parse(result.body,(_key,value)=>{if(typeof value==='number'&&!Number.isSafeInteger(value))approximate++;return value;});}catch{throw new AppError('IMPORT_FIGURE');}
 if(!validFigure(figure))throw new AppError('IMPORT_FIGURE');
 const seriesCount=figure.kind==='panels'?0:figure.series.length;let identity=0;
 figure=cloneFigure(figure,()=>{const i=identity++;return i===0?mappedId(recordId,'figure'):i<=seriesCount?mappedId(recordId,'figure-series',i-1):mappedId(recordId,'figure-part',i);});
 return {...result,conversion:'figure',figures:[figure],omitted:approximate?[{element:'approximate-plot-coordinates',count:approximate}]:[]};
}
