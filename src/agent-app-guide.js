// The main app commands an agent needs, with example bodies, published in the
// OpenAPI description under x-observanda-guide. Each command is the app's own:
// the path after /api/v1/agent/app/. A value written as "{name}" is one the
// agent substitutes from an earlier reply; the notes say which step gives it.
// test/agent-app-guide.test.js runs every step against a real app.
const book='projects/{projectId}/lab-books/{labBookId}/';
const step=value=>Object.freeze(value);
export const AGENT_APP_GUIDE=Object.freeze([
 step({id:'lab-book-start',method:'POST',command:book+'workspace/read/start',summary:'Open a lab book for reading and writing; the reply\'s metadata.id is the lab book\'s workspaceId.',body:{},
  notes:'projectId and labBookId come from the projects/list and lab-books/list operations. Pass metadata.id as workspaceId to the lab book commands below.'}),
 step({id:'record-read',method:'POST',command:book+'workspace/read/selection',summary:'Read whole records, including their attachments, sections and links.',body:{workspaceId:'{workspaceId}',ids:['{recordId}']},
  notes:'workspaceId comes from lab-book-start; record ids come from the records/list operation. Each record is in book.entries, with its files in attachments; recordRevisions gives each record\'s revision.'}),
 step({id:'record-share-read',method:'POST',command:book+'research/records/values/read',summary:'Read whether a record may appear on websites and other publications.',body:{workspaceId:'{workspaceId}',recordId:'{recordId}',field:'share'},
  notes:'The reply is {value:{value:true|false},revision}. Pass revision as expectedRevision when you change the value.'}),
 step({id:'record-share-save',method:'POST',command:book+'research/records/values/save',summary:'Make a record available to websites and other publications, or private again with false.',
  body:{workspaceId:'{workspaceId}',recordId:'{recordId}',field:'share',expectedRevision:'{valueRevision}',value:{value:true}},
  notes:'valueRevision is the revision from record-share-read. The body must hold exactly these keys. Private parts of a record stay private either way.'}),
 step({id:'workspace-start',method:'POST',command:'workspace/read/start',summary:'Open the workspace\'s own lab book; its metadata.id identifies the workspace for PDF commands.',body:{},
  notes:'Needs a workspace key.'}),
 step({id:'website-session',method:'POST',command:'website-files/session',summary:'Open the website editor: the workspace, the first websites and any work in progress.',body:{},
  notes:'Website commands need a workspace key.'}),
 step({id:'website-create',method:'POST',command:'website-files/create',summary:'Create a website from a first page.',
  body:{name:'Lab results',html:'<!doctype html><html lang="en"><head><title>Lab results</title></head><body><main><h1>Lab results</h1></main></body></html>'},
  notes:'Optional keys: css (the site stylesheet), language, and starter (a ready-made design, then without html and css). The reply\'s site.id is the siteId and site.revision the siteRevision for the next change.'}),
 step({id:'website-list',method:'POST',command:'website-files/list',summary:'List the websites, one page at a time, with their pages and revisions.',body:{limit:25},
  notes:'Pass the reply\'s next as after to read the following page; archived:true lists archived websites.'}),
 step({id:'website-page-create',method:'POST',command:'website-files/page/create',summary:'Add a page to a website.',
  body:{siteId:'{siteId}',expectedRevision:'{siteRevision}',path:'results.html',title:'Results',language:'en',inclusion:'included'},
  notes:'siteRevision is site.revision from the latest website reply. inclusion is included (part of the published site) or private (a draft that is not published). Every website change answers with the new site.revision.'}),
 step({id:'website-open',method:'POST',command:'website-files/open',summary:'Read one page of a website: its HTML, its stylesheet and the site\'s current revision.',body:{siteId:'{siteId}',path:'results.html'},
  notes:'path defaults to index.html. The reply\'s html and css are what website-save expects back.'}),
 step({id:'website-save',method:'POST',command:'website-files/save',summary:'Save a page\'s HTML and stylesheet.',
  body:{siteId:'{siteId}',expectedRevision:'{siteRevision}',path:'results.html',html:'{html}',css:'{css}',title:'Results'},
  notes:'html and css are required: start from the html and css that website-open returned and change them. title is optional; historyKey and recovery are used by the editor\'s own undo and recovery.'}),
 step({id:'website-feed-save',method:'POST',command:'website-files/feed/save',summary:'Place a list of lab book records on a page, kept up to date as records are shared.',
  body:{siteId:'{siteId}',expectedRevision:'{siteRevision}',path:'results.html',heading:'Experiments',criteria:{recordType:'experiment',sort:'title-asc'},template:'full',layout:'list',pageSize:12},
  notes:'criteria takes the same keys as a saved search (an empty object lists every shared record); template is full, card or custom (custom needs itemHTML; card may add cardFields); layout is list or grid; pageSize is 1 to 100. Add feedId to change an existing list. Only records available to websites appear. The reply is plain JSON, with feedId; with Accept: application/x-ndjson it streams progress lines and ends with the result line.'}),
 step({id:'website-feed-read',method:'POST',command:'website-files/feed/read',summary:'Read the record lists placed on a page.',body:{siteId:'{siteId}',expectedRevision:'{siteRevision}',path:'results.html'},
  notes:'Add feedId to read one list. The reply lists each feed with its criteria, layout and number of records.'}),
 step({id:'website-saved-search-save',method:'POST',command:'website-files/library/saved-searches/save',summary:'Save a named record search to reuse when placing lists and records on a website.',
  body:{siteId:'{siteId}',id:'{newId}',revision:null,name:'Experiments',criteria:{recordType:'experiment',sort:'title-asc'}},
  notes:'newId is a new UUID chosen by the agent; revision is null for a new search, or the saved search\'s revision to change it. criteria keys: search, searchField, filter, dateFrom, dateTo, dateKnowledge, recordType, status, tagMode, sort, projectId, notebookId and tags.'}),
 step({id:'website-saved-search-list',method:'POST',command:'website-files/library/saved-searches/list',summary:'List a website\'s saved searches.',body:{siteId:'{siteId}',after:'',query:''},
  notes:'Pass the reply\'s next as after to read the following page; query narrows by name.'}),
 step({id:'website-publish-target',method:'POST',command:'website-files/publish-target',summary:'See where the website is published: a folder, a remote destination, or not chosen yet.',body:{siteId:'{siteId}'},
  notes:'The reply\'s kind is folder, remote or choose.'}),
 step({id:'website-destination',method:'POST',command:'website-files/destination',summary:'Read the website\'s remote publishing destination and the state of its last transfer.',body:{siteId:'{siteId}'},
  notes:'configured is false until the owner sets up a destination in the app.'}),
 step({id:'pdf-list',method:'POST',command:'pdf/list',summary:'List the workspace\'s PDF documents.',body:{workspaceId:'{rootWorkspaceId}',limit:20},
  notes:'rootWorkspaceId is metadata.id from workspace-start. Pass the reply\'s next as after to read the following page. Needs a workspace key.'})
]);
