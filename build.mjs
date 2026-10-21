import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../output');
const labels = {};
for (const [key, file] of Object.entries({food:'quad_food_label.jpg',tools:'quad_tools_label.jpg',instruments:'quad_instruments_label.jpg',medicine:'quad_medicine_label.jpg'})) {
  labels[key] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'assets', file)).toString('base64');
}
const result = await build({
  entryPoints:[path.join(root,'src/app.js')],bundle:true,minify:true,format:'iife',target:['es2020'],write:false,
  define:{__LABEL_IMAGES__:JSON.stringify(labels)},legalComments:'inline'
});
const licenses=[];const seen=new Set();
function collectLicenses(pkg){
  if(seen.has(pkg))return;seen.add(pkg);
  const dir=path.join(root,'node_modules',pkg);const spec=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const names=fs.readdirSync(dir).filter(x=>/^licen[sc]e(?:\.|$)|^copying$/i.test(x)&&fs.statSync(path.join(dir,x)).isFile());
  for(const file of names)licenses.push({name:pkg.replaceAll('/','_')+'_'+file,text:pkg+' '+spec.version+'\n\n'+fs.readFileSync(path.join(dir,file),'utf8')});
  for(const dep of Object.keys(spec.dependencies||{}))collectLicenses(dep);
}
collectLicenses('three');collectLicenses('jszip');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const licenseHtml='<details hidden id="third-party-licenses"><summary>Third-party licenses</summary><pre>'+escape(licenses.map(x=>x.text).join('\n\n================\n\n'))+'</pre></details>';
const html = fs.readFileSync(path.join(root,'index.template.html'),'utf8').replace('/*__BUNDLE__*/',()=>result.outputFiles[0].text.replaceAll('</script','<\\/script')).replace('</body>',()=>licenseHtml+'</body>');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/index.html'),html);
fs.writeFileSync(path.join(root,'dist/.nojekyll'),'');
if(fs.existsSync(output))fs.writeFileSync(path.join(output,'视觉物块仿真.html'),html);
fs.mkdirSync(path.join(root,'dist/licenses'),{recursive:true});
for(const entry of licenses)fs.writeFileSync(path.join(root,'dist/licenses',entry.name+'.txt'),entry.text);
console.log(JSON.stringify({offline:path.join(output,'视觉物块仿真.html'),pages:path.join(root,'dist/index.html'),bytes:Buffer.byteLength(html)},null,2));
