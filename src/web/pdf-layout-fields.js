import './i18n/catalogues/pdfEditor.js';
import {pdfPageMasterFields,changePdfPageMaster} from './pdf-page-master-fields.js';
import {t} from './i18n/index.js';
import {BUNDLED_FONTS} from './font-catalogue.js';
const tr=key=>t('pdfEditor',key);
export function pdfLayoutFields(layout,owner,{esc,fonts=[]}){
 const attrs=key=>'data-pdf-layout="'+owner+'" data-key="'+key+'"'+(layout.pageMaster&&['header','footer','pageNumbers'].includes(key)?' disabled':''),field=(key,input)=>'<label class="field">'+esc(tr(key))+input+'</label>';
 const number=(key,value,min,max,step=1)=>field(key,'<input type="number" '+attrs(key)+' min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'">');
 return '<div class="pdf-layout-fields">'+number('width',layout.widthMm,40,1000,.1)+number('height',layout.heightMm,40,1000,.1)+['top','right','bottom','left'].map(key=>number(key,layout.margins[key],0,400,.1)).join('')+
 field('font','<select '+attrs('font')+'>'+[...BUNDLED_FONTS,...fonts].map(f=>'<option value="'+esc(f.id)+'"'+(layout.font===f.id?' selected':'')+'>'+esc(f.family??f.label)+'</option>').join('')+'</select>')+
 number('fontSize',layout.fontSizePt,6,96,.5)+number('lineHeight',layout.lineHeight,1,3,.1)+number('columns',layout.columns,1,4)+number('columnGap',layout.columnGapMm,0,100,.1)+
 ['header','footer'].map(key=>field(key,'<input '+attrs(key)+' maxlength="240" value="'+esc(layout[key])+'">')).join('')+
 field('numbers','<input type="checkbox" '+attrs('pageNumbers')+(layout.pageNumbers?' checked':'')+'>')+
 field('links','<select '+attrs('links')+'>'+['enabled','disabled'].map(key=>'<option value="'+key+'"'+(layout.links===key?' selected':'')+'>'+esc(tr(key))+'</option>').join('')+'</select>')+
 ['background','color'].map(key=>field(key,'<input type="color" '+attrs(key)+' value="'+layout[key]+'">')).join('')+'</div>'+pdfPageMasterFields(layout,owner,{esc});
}
export function changePdfLayout(layout,key,value){
 if(changePdfPageMaster(layout,key,value))return;
 const numeric={width:'widthMm',height:'heightMm',fontSize:'fontSizePt',lineHeight:'lineHeight',columns:'columns',columnGap:'columnGapMm'};
 if(['top','right','bottom','left'].includes(key))layout.margins[key]=Number(value);
 else if(numeric[key])layout[numeric[key]]=Number(value);
 else if(['font','header','footer','links','background','color','pageNumbers'].includes(key))layout[key]=value;
}
