const button=(label,action,extra='')=>`<button type="button" class="button" data-action="material-${action}" ${extra}>${label}</button>`;
export function researchMaterialsLaunch(subject,{readonly=false}={}){
 return `<section class="research-links"><header><h3>Evidence &amp; analysis</h3>${button('Open evidence & analysis','open',readonly?'data-readonly="true"':'')}</header><p class="muted">${readonly?'Read original files, datasets and retained analyses associated with this record.':'Original files, datasets and analysis revisions stay private. Figures added to the record follow its sharing setting.'}</p>${!readonly&&subject?.type==='run'?button('Create another run or take','repeat'):''}</section>`;
}
