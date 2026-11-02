const fields={searchField:'pickerSearchField',filter:'pickerFilter',recordType:'pickerType',status:'pickerStatus',dateFrom:'pickerFromDate',dateTo:'pickerToDate',dateKnowledge:'pickerDateKnowledge',tagMode:'pickerTagMode',sort:'pickerSort'};
const choices={
 searchField:{all:'pickerAnyField',title:'pickerTitleField',reference:'pickerReferenceField',tag:'pickerTagField'},
 filter:{all:'pickerAll',media:'pickerWithMedia',text:'pickerTextOnly'},
 dateKnowledge:{all:'pickerAnyDate',known:'pickerDateKnown',estimated:'pickerDateEstimated',unknown:'pickerDateUnknown'},
 tagMode:{all:'pickerMatchAllTags',any:'pickerMatchAnyTags'},
 sort:{default:'pickerDefaultOrder','date-desc':'pickerNewest','date-asc':'pickerOldest','title-asc':'pickerTitleAZ','title-desc':'pickerTitleZA'}
};
export function websitePickerRefinements(state,{msg,esc,types,statusLabel,button,facet}){
 types??={ids:[],statuses:[],label:value=>value};
 const label=key=>esc(msg(key));
 function display(key,value){
  if(key==='recordType')return value?types.label(value):msg('pickerAnyType');
  if(key==='status')return value?statusLabel(value):msg('pickerAnyStatus');
  return choices[key]?.[value]?msg(choices[key][value]):value;
 }
 function select(key){
  const values=key==='recordType'?['',...types.ids]:key==='status'?['',...types.statuses]:Object.keys(choices[key]);
  return '<label>'+label(fields[key])+'<select data-picker-field="'+key+'">'+values.map(value=>'<option value="'+esc(value)+'" '+(state.fields[key]===value?'selected':'')+'>'+esc(display(key,value))+'</option>').join('')+'</select></label>';
 }
 const date=key=>'<label>'+label(fields[key])+'<input type="date" data-picker-field="'+key+'" value="'+esc(state.fields[key])+'"></label>';
 const filters=[...['project','book'].flatMap(key=>state.owners[key].chosen?[[key,state.owners[key].chosen.title??state.owners[key].chosen.id]]:[]),
  ...Object.entries(state.criteria).filter(([key,value])=>value&&value!==Object.keys(choices[key]??{})[0]&&key!=='sort').map(([key,value])=>[key,key==='search'?value:msg(fields[key])+' · '+display(key,value)]),
  ...state.tags.map(value=>['tag',value,value])];
 const chips=filters.length?'<div class="website-picker-applied" aria-label="'+label('pickerActiveFilters')+'">'+filters.map(([key,text,value])=>'<button type="button" data-action="website-files-picker-remove-filter" data-key="'+key+'" '+(value?'data-value="'+esc(value)+'"':'')+' aria-label="'+esc(msg('pickerRemoveFilter',{label:text}))+'">'+esc(text)+' <span aria-hidden="true">×</span></button>').join('')+button('pickerClearFilters','reset-filters')+'</div>':'';
 const search='<div class="website-picker-search"><label>'+label('pickerSearch')+'<input type="search" data-picker-search maxlength="160" value="'+esc(state.fields.search)+'"></label>'+select('searchField')+button('pickerFind','search')+select('sort')+button(state.filtersShown?'pickerHideFilters':'pickerShowFilters','toggle-filters','aria-expanded="'+state.filtersShown+'" aria-controls="website-picker-refinements"')+'</div>'+chips;
 const rail='<aside id="website-picker-refinements" class="website-picker-refinements" '+(state.filtersShown?'':'hidden')+' aria-label="'+label('pickerFilters')+'"><h3>'+label('pickerFilters')+'</h3><div class="website-picker-facets">'+facet('project')+facet('book')+facet('tag')+'</div>'+select('filter')+select('recordType')+select('status')+date('dateFrom')+date('dateTo')+select('dateKnowledge')+(state.tags.length?select('tagMode'):'')+button('pickerApplyFilters','search')+'</aside>';
 return {search,rail,filtered:!!filters.length};
}
