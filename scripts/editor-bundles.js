// The shipped editor bundles in src/web/vendor are built from src/editor with these
// options. The build script writes them; a test rebuilds them in memory and compares,
// so a bundle left behind by a source or text change is caught.
const sharedRuntime={name:'shared-runtime',setup(build){
 build.onResolve({filter:/^\.\/equation-runtime\.js$/},()=>({path:'../equation-runtime.js',external:true}));
 build.onResolve({filter:/\/i18n\/index\.js$/},()=>({path:'../i18n/index.js',external:true}));
}};
const common={bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'none'};
export const editorBundles=[
 {...common,entryPoints:['src/editor/equations.js'],outfile:'src/web/vendor/equations.js'},
 {...common,entryPoints:['src/editor/rich-text-editor.js'],outfile:'src/web/vendor/rich-text-editor.js',plugins:[sharedRuntime]}
];
