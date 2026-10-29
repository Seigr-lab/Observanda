import {inventoryLocation} from './editor-presentation.js';
import '../i18n/catalogues/dashboardEditors.js';
import {t} from '../i18n/index.js';
import {dashboardCollection} from '../dashboard-collection-client.js';
import {dashboardScopeSettings,dashboardBookSettings} from '../dashboard-scope.js';
import {renderFigure} from '../figure-renderer.js';
import {balance} from './quantities.js';
import {stockTracked,assetPlacement,inventoryBOMUsage} from './inventory-model.js';
import {inventoryPageProvider,inventoryItemChoices} from './inventory-data.js';
const dt=(key,parameters)=>t('dashboardEditors',key,parameters);


const metrics=()=>[{value:'physical',label:dt("onHand"),color:'#405cb2'},{value:'reserved',label:dt("reserved"),color:'#b77836'},{value:'available',label:dt("available"),color:'#368173'},{value:'used',label:dt("usedBoms"),color:'#7960a2'},{value:'scrapped',label:dt("scrappedBoms"),color:'#b94a50'}];
const selectedMetrics=options=>metrics().filter(m=>(options.comparisonMetrics??['available']).includes(m.value));
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
  x:{kind:'category',label:options.projectLabel??dt("projectStock"),scale:'linear',min:null,max:null},
  y:{label:options.quantityLabel||item.data.unit||dt("items"),scale:'linear',min:0,max:null},legend:options.showLegend??true,
  style:{showTitle:false,fontSize:Math.max(8,Math.min(24,Number(options.chartFontSize)||12)),grid:options.showGrid===false?'none':'y',width:760,height:380,labelStep:1},
  series:selected.map(m=>({id:m.value,name:m.label,color:color(options[m.value+'Color'],m.color),points:rows.map(r=>({x:r.label,y:Number(r[m.value]),error:null}))}))};
}
function holdingsTable(item,esc,options){
 const selected=selectedMetrics(options);
 return '<div class="desk-holdings-table" tabindex="0" role="region" aria-label="'+esc(dt('holdingsRegion',{title:item.title}))+'"><table><caption>'+esc(item.title)+' — '+esc(item.data.unit)+`</caption><thead><tr><th scope="col">${esc(dt("projectStock"))}</th>`+selected.map(m=>'<th scope="col">'+esc(m.label)+'</th>').join('')+'</tr></thead><tbody>'+item.holdings.map(r=>'<tr><th scope="row">'+esc(r.label)+'</th>'+selected.map(m=>'<td>'+esc(r[m.value])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
const comparison=({item,esc,options,panelId})=>{
 if(!selectedMetrics(options).length)return `<p class="desk-empty">${esc(dt("chooseQuantity"))}</p>`;
 const figure=inventoryComparisonFigure(item,options);
 return '<figure class="desk-inventory-chart"><div class="desk-inventory-plot" data-desk-figure="'+esc(item.key)+'">'+renderFigure(figure,{idPrefix:'inventory-'+panelId})+`</div><figcaption>${esc(dt("stockHelp"))}</figcaption></figure><details class="desk-inventory-values"><summary>${esc(dt("exactQuantities"))}</summary>`+holdingsTable(item,esc,options)+'</details>';
};
export function registerInventoryDashboard(registry){
 const presentation=()=>({label:dt('inventory'),group:dt('inventory'),
  fieldMetadata:{kind:{label:dt('itemKind'),format:(value,{esc})=>esc(({material:'kindMaterial',equipment:'kindEquipment',software:'kindSoftware',object:'kindObject'})[value]?dt(({material:'kindMaterial',equipment:'kindEquipment',software:'kindSoftware',object:'kindObject'})[value]):value)},unit:{label:dt('unit')},physical:{label:dt("onHandSelection")},reserved:{label:dt("reservedSelection")},available:{label:dt("availableSelection")},owner:{label:dt("ownedBy")},used:{label:dt("usedSelectedBoms")},scrapped:{label:dt("scrappedSelectedBoms")}},
  views:[{id:'comparison',label:dt("projectComparison"),defaultFields:[],figure:({item,options})=>inventoryComparisonFigure(item,options),render:comparison},{id:'holdings',label:dt("holdingsTable"),defaultFields:[],render:({item,esc,options})=>holdingsTable(item,esc,options)}]
 });
 registry.register({
  ...inventoryPageProvider('resource'),
  id:'resources',label:dt("inventory"),group:dt("inventory"),icon:'projects',scoped:true,
  defaultFields:['owner','kind','physical','reserved','available','unit'],
  ...presentation(),presentation,
  settings:(c,options={},panel)=>[
   ...dashboardScopeSettings(c,options,panel),...(dashboardCollection(c)?dashboardBookSettings(c,options,panel):[]),
   {key:'resourceMode',label:dt("inventoryItems"),type:'select',default:'all',choices:[{value:'all',label:dt("allMatchingItems")},{value:'selected',label:dt("chooseItems")}]},
   ...(options.resourceMode==='selected'?[inventoryItemChoices]:[]),
   {key:'search',label:dt("itemNameContains"),type:'text'},
   {key:'kind',label:dt("itemKind"),type:'select',default:'',choices:[{value:'',label:dt("allKinds")},...['material','equipment','software','object'].map(value=>({value,label:dt(({material:'kindMaterial',equipment:'kindEquipment',software:'kindSoftware',object:'kindObject'})[value])}))]},
   {key:'status',label:dt("itemStatus"),type:'select',default:'',choices:[{value:'',label:dt("allStatuses")},{value:'available',label:dt("available")},{value:'hold',label:dt("onHold")},{value:'retired',label:dt("retired")}]},
   ...(['comparison','holdings'].includes(panel?.presentation)?[{key:'comparisonMetrics',label:dt("compareQuantities"),type:'multi',default:['available'],choices:metrics()}]:[]),
   ...(panel?.presentation==='comparison'?[
    {key:'comparisonType',label:dt("chartOrientation"),type:'select',tab:'display',default:'bar-horizontal',choices:[{value:'bar-horizontal',label:dt("horizontalBars")},{value:'bar',label:dt("verticalBars")}]},
    {key:'projectLabel',label:dt("projectAxisLabel"),type:'text',tab:'display',placeholder:dt('projectStock')},
    {key:'quantityLabel',label:dt("quantityAxisLabel"),type:'text',tab:'display',help:dt("itemUnitHelp")},
    {key:'chartFontSize',label:dt("chartTextSize"),type:'number',min:8,max:24,tab:'display',default:12},
    {key:'showGrid',label:dt("showGrid"),type:'checkbox',tab:'display',default:true},
    {key:'showLegend',label:dt("showLegend"),type:'checkbox',tab:'display',default:true},
    ...selectedMetrics(options).map(m=>({key:m.value+'Color',label:dt('metricColour',{metric:m.label}),type:'color',tab:'display',default:m.color}))
   ]:[])
  ]
 });
}
