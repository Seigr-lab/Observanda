import {dashboardCollection} from '../dashboard-collection-client.js';
import {dashboardScopeSettings,dashboardBookSettings} from '../dashboard-scope.js';
import {renderFigure} from '../figure-renderer.js';
import {balance} from './quantities.js';
import {inventoryLocation,stockTracked,assetPlacement,inventoryBOMUsage} from './inventory-model.js';
import {inventoryPageProvider,inventoryItemChoices} from './inventory-data.js';

const metrics=[{value:'physical',label:'On hand',color:'#405cb2'},{value:'reserved',label:'Reserved',color:'#b77836'},{value:'available',label:'Available',color:'#368173'},{value:'used',label:'Used in BOMs',color:'#7960a2'},{value:'scrapped',label:'Scrapped in BOMs',color:'#b94a50'}];
const selectedMetrics=options=>metrics.filter(m=>(options.comparisonMetrics??['available']).includes(m.value));
const color=(value,fallback)=>/^#[a-f0-9]{6}$/i.test(value??'')?value:fallback;
export function inventoryComparisonRows(book,entities,resource,scope){
 const tracked=stockTracked(resource.data),placement=assetPlacement(resource);
 const rows=[...scope].map(projectId=>({projectId,label:inventoryLocation(book,projectId),
  ...inventoryBOMUsage(entities,resource.id,new Set([projectId])),...(tracked?balance(entities,resource.id,new Set([projectId])):{physical:placement===projectId?'1':'0',reserved:'0',available:placement===projectId&&resource.data.status==='available'?'1':'0'})}));
 const counts=new Map();for(const row of rows)counts.set(row.label,(counts.get(row.label)??0)+1);
 return rows.map(row=>({...row,label:counts.get(row.label)>1?row.label+' ['+(row.projectId??'workspace')+']':row.label}));
}
export function inventoryComparisonFigure(item,options={}){
 const selected=selectedMetrics(options),rows=item.holdings;
 return {id:item.key,title:item.title,kind:options.comparisonType==='bar'?'bar':'bar-horizontal',
  x:{kind:'category',label:options.projectLabel??'Project / central stock',scale:'linear',min:null,max:null},
  y:{label:options.quantityLabel||item.data.unit||'Items',scale:'linear',min:0,max:null},legend:options.showLegend??true,
  style:{showTitle:false,fontSize:Math.max(8,Math.min(24,Number(options.chartFontSize)||12)),grid:options.showGrid===false?'none':'y',width:760,height:380,labelStep:1},
  series:selected.map(m=>({id:m.value,name:m.label,color:color(options[m.value+'Color'],m.color),points:rows.map(r=>({x:r.label,y:Number(r[m.value]),error:null}))}))};
}
function holdingsTable(item,esc,options){
 const selected=selectedMetrics(options);
 return '<div class="desk-holdings-table" tabindex="0" role="region" aria-label="'+esc(item.title+' holdings')+'"><table><caption>'+esc(item.title)+' — '+esc(item.data.unit)+'</caption><thead><tr><th scope="col">Project / central stock</th>'+selected.map(m=>'<th scope="col">'+esc(m.label)+'</th>').join('')+'</tr></thead><tbody>'+item.holdings.map(r=>'<tr><th scope="row">'+esc(r.label)+'</th>'+selected.map(m=>'<td>'+esc(r[m.value])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
const comparison=({item,esc,options,panelId})=>{
 if(!selectedMetrics(options).length)return '<p class="desk-empty">Choose at least one quantity in Content settings.</p>';
 const figure=inventoryComparisonFigure(item,options);
 return '<figure class="desk-inventory-chart"><div class="desk-inventory-plot" data-desk-figure="'+esc(item.key)+'">'+renderFigure(figure,{idPrefix:'inventory-'+panelId})+'</div><figcaption>Direct stock at each selected location. Subprojects are separate. BOM use and scrap follow the stock source; they exclude transfers, adjustments and unfinished builds.</figcaption></figure><details class="desk-inventory-values"><summary>Exact quantities</summary>'+holdingsTable(item,esc,options)+'</details>';
};
export function registerInventoryDashboard(registry){
 registry.register({
  ...inventoryPageProvider('resource'),
  id:'resources',label:'Inventory',group:'Inventory',icon:'projects',scoped:true,
  defaultFields:['owner','kind','physical','reserved','available','unit'],
  fieldMetadata:{physical:{label:'On hand in selection'},reserved:{label:'Reserved in selection'},available:{label:'Available in selection'},owner:{label:'Owned by'},used:{label:'Used in BOMs from selected stock'},scrapped:{label:'Scrapped in BOMs from selected stock'}},
  views:[{id:'comparison',label:'Project comparison',defaultFields:[],figure:({item,options})=>inventoryComparisonFigure(item,options),render:comparison},{id:'holdings',label:'Holdings table',defaultFields:[],render:({item,esc,options})=>holdingsTable(item,esc,options)}],
  settings:(c,options={},panel)=>[
   ...dashboardScopeSettings(c,options,panel),...(dashboardCollection(c)?dashboardBookSettings(c,options,panel):[]),
   {key:'resourceMode',label:'Inventory items',type:'select',default:'all',choices:[{value:'all',label:'All matching items'},{value:'selected',label:'Choose items'}]},
   ...(options.resourceMode==='selected'?[inventoryItemChoices]:[]),
   {key:'search',label:'Item name contains',type:'text'},
   {key:'kind',label:'Item kind',type:'select',default:'',choices:[{value:'',label:'All kinds'},...['material','equipment','software','object'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))]},
   {key:'status',label:'Item status',type:'select',default:'',choices:[{value:'',label:'All statuses'},{value:'available',label:'Available'},{value:'hold',label:'On hold'},{value:'retired',label:'Retired'}]},
   ...(['comparison','holdings'].includes(panel?.presentation)?[{key:'comparisonMetrics',label:'Quantities to compare',type:'multi',default:['available'],choices:metrics}]:[]),
   ...(panel?.presentation==='comparison'?[
    {key:'comparisonType',label:'Chart orientation',type:'select',tab:'display',default:'bar-horizontal',choices:[{value:'bar-horizontal',label:'Horizontal bars'},{value:'bar',label:'Vertical bars'}]},
    {key:'projectLabel',label:'Project axis label',type:'text',tab:'display',default:'Project / central stock'},
    {key:'quantityLabel',label:'Quantity axis label',type:'text',tab:'display',help:'Leave empty to use each item’s unit.'},
    {key:'chartFontSize',label:'Chart text size',type:'number',min:8,max:24,tab:'display',default:12},
    {key:'showGrid',label:'Show grid',type:'checkbox',tab:'display',default:true},
    {key:'showLegend',label:'Show legend',type:'checkbox',tab:'display',default:true},
    ...selectedMetrics(options).map(m=>({key:m.value+'Color',label:m.label+' colour',type:'color',tab:'display',default:m.color}))
   ]:[])
  ]
 });
}
