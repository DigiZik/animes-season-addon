// Offline CPU/index comparison. No HTTP or provider latency is included.
const fs = require('fs');
const path = require('path');
const os = require('os');
const {execFileSync} = require('child_process');
const {performance} = require('perf_hooks');
const BASELINE = '59024c06fa04b7df377909270c0107f938a64da2';
const argument = name => process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const directory = argument('worker');
if(directory) {
    const ids=JSON.parse(fs.readFileSync(path.join(directory,'ids.json'),'utf8'));
    const mode=argument('mode');
    const module=require(mode==='baseline'?path.join(directory,'anime-mappings.js'):path.join(process.cwd(),'build/src/native-meta.js'));
    let fribb,tsv;
    if(mode==='baseline'||mode==='cinemeta') {fribb=fs.readFileSync(path.join(argument('snapshots'),'fribb.json'),'utf8');if(mode==='baseline')tsv=fs.readFileSync(path.join(argument('snapshots'),'animeapi.tsv'),'utf8');}
    const cinemeta=mode==='cinemeta'?require(path.join(process.cwd(),'build/src/cinemeta.js')):undefined;
    global.gc(); const before=process.memoryUsage().heapUsed,start=performance.now();
    let index,exported=0;
    if(mode==='baseline')index=new module.AnimeMappings(JSON.parse(fribb),tsv);
    if(mode==='cinemeta')index=cinemeta.imdbIndex(JSON.parse(fribb));
    for(const id of ids) {
        if(mode==='baseline') {index.preferredId(id);exported++;}
        else if(mode==='cinemeta') {if(index.get('movie:'+id)||index.get('series:'+id))exported++;}
        else {module.anilistId(id);exported++;}
    }
    const milliseconds=performance.now()-start;
    global.gc();console.log(JSON.stringify({milliseconds,heapMiB:(process.memoryUsage().heapUsed-before)/1048576,exported}));
} else {
    const samples=Number(argument('samples')||7), snapshots=argument('baseline-snapshots');
    if(!Number.isInteger(samples)||samples<3||samples>15)throw Error('--samples must be 3 through 15');
    const ids=new Set();
    function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.json'))for(const meta of JSON.parse(fs.readFileSync(file,'utf8')).metas)ids.add(Number(meta.id.slice(8)));}}
    walk('catalog');
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'native-id-benchmark-'));
    try{
        fs.writeFileSync(path.join(temporary,'ids.json'),JSON.stringify([...ids]));
        if(snapshots){
            const ts=require('typescript');
            for(const name of ['anime-mappings','mapping-cache']){
                const code=execFileSync('git',['show',`${BASELINE}:src/${name}.ts`],{encoding:'utf8'});
                fs.writeFileSync(path.join(temporary,name+'.js'),ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText);
            }
        }
        const results=[];
        for(const mode of snapshots?['baseline','native','cinemeta']:['native']){
            const trials=[];
            for(let sample=0;sample<samples;sample++)trials.push(JSON.parse(execFileSync(process.execPath,['--expose-gc',__filename,`--worker=${temporary}`,`--mode=${mode}`,...(snapshots?[`--snapshots=${path.resolve(snapshots)}`]:[])],{encoding:'utf8'})));
            results.push({mode,milliseconds:median(trials.map(r=>r.milliseconds)),heapMiB:median(trials.map(r=>r.heapMiB)),selectedIds:trials[0].exported});
        }
        const report={baseline:snapshots?BASELINE:null,node:process.version,platform:process.platform+'/'+process.arch,samples,uniqueSourceIds:ids.size,conditions:'Fresh processes; median; JSON parsing, indexing and one selection per source ID; excludes disk reads, HTTP, fallback metadata, pagination and deployment.',results};
        fs.mkdirSync('.cache',{recursive:true});fs.writeFileSync('.cache/id-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
    }finally{if(path.dirname(temporary)!==path.resolve(os.tmpdir()))throw Error('Unsafe cleanup');fs.rmSync(temporary,{recursive:true,force:true});}
}
