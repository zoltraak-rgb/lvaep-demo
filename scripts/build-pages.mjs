import {build} from 'vite';
import {cp, mkdir, readdir, rm, writeFile} from 'node:fs/promises';
await build({base:'./'});
await mkdir('docs',{recursive:true});
// Only replace known generated outputs; leave any other documentation untouched.
for(const name of ['assets','index.html','404.html','.nojekyll']) await rm(`docs/${name}`,{recursive:true,force:true});
for(const name of await readdir('dist')) await cp(`dist/${name}`,`docs/${name}`,{recursive:true});
await writeFile('docs/.nojekyll','');
console.log('GitHub Pages build ready in docs/');
