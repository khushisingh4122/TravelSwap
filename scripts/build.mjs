import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
const assets={};for(const [name,type] of [['index.html','text/html; charset=utf-8'],['app.js','application/javascript; charset=utf-8'],['style.css','text/css; charset=utf-8'],['favicon.svg','image/svg+xml']])assets['/'+name]={type,body:readFileSync('public/'+name,'utf8')};
const security=readFileSync('src/security.mjs','utf8').replaceAll('export ','');
const matching=readFileSync('src/matching.mjs','utf8').replaceAll('export ','');
const worker=readFileSync('src/worker.mjs','utf8').replace(/^import .*;\r?\n/gm,'');
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js','const assets='+JSON.stringify(assets)+';\n'+security+'\n'+matching+'\n'+worker);
cpSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built TravelSwap Worker and four embedded assets.');

