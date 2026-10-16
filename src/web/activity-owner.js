export function activityOwner(kind, view){
 const bookCreation=/^\/api\/projects\/([a-f0-9-]{36})\/lab-books\/(?:create|import)(?:\/(?:resume|cancel))?$/.exec(kind);if(bookCreation)return '#/projects/'+bookCreation[1];
 const bookDelete=/^\/api\/projects\/([a-f0-9-]{36})\/lab-books\/[a-f0-9-]{36}\/storage\/delete(?:\/resume)?$/.exec(kind);if(bookDelete)return '#/projects/'+bookDelete[1];
 if(/^\/api\/projects\/[a-f0-9-]{36}\/storage\/delete(?:\/resume)?$/.test(kind))return '#/projects';
 if(['/api/storage/rename','/api/storage/rename/resume'].includes(kind))return '#/preferences';
 if(kind.startsWith('/api/storage/'))return '#/preferences/storage';
 return typeof view==='string'&&/^#\/[a-zA-Z0-9/_:-]*$/.test(view)?view:null;
}

export function activityViewMatches(view,route){
 const project=typeof view==='string'?/^#\/projects\/([a-f0-9-]{36})$/.exec(view):null;
 return view===route||project&&route==='#/owners/'+project[1]+'/projects/'+project[1]||typeof view==='string'&&/^#\/modules\/[^/]+$/.test(view)&&route.startsWith(view+'/');
}

// A project writer can only explain waiting in the same owner. A workspace
// operation or a sibling project is not the blocker for that request.
export function activityResource(kind){const book=/^\/api\/projects\/([a-f0-9-]{36})\/lab-books\/([a-f0-9-]{36})\//.exec(kind);if(book)return 'lab-book:'+book[1]+':'+book[2];const match=/^\/api\/projects\/([a-f0-9-]{36})\//.exec(kind);return match?'project:'+match[1]:(kind.startsWith('/api/projects/create')||kind.startsWith('/api/projects/open'))?'project-registry':'workspace';}
export function activityCommand(kind){return kind.replace(/^\/api\/projects\/[a-f0-9-]{36}\/(?:lab-books\/[a-f0-9-]{36}\/)?/,'/api/');}
