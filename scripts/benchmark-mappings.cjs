// Compare the exact previous resolver with this checkout using identical full-size inputs.
// The loopback fixture makes network conditions reproducible; it is not a GitHub latency forecast.
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const { createHash } = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { performance } = require('perf_hooks');
const BASELINE = 'b318225020decbedaa89fa81ba5fd685f48a259d';
const ROOT = process.cwd();
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function worker() {
    const implementation = option('worker');
    let requests = 0, bytes = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        requests++;
        const response = await originalFetch(`${option('url')}/${String(url).includes('Fribb') ? 'fribb' : 'animeApi'}`, options);
        bytes += Number(response.headers.get('content-length') || 0);
        return response;
    };
    const module = require(implementation === 'baseline' ? path.join(option('directory'), 'baseline.cjs') : path.join(ROOT, 'build/src/anime-mappings.js'));
    const ids = JSON.parse(await fs.readFile(path.join(option('directory'), 'ids.json'), 'utf8'));
    global.gc?.();
    const beforeHeap = process.memoryUsage().heapUsed;
    const started = performance.now();
    let index, error;
    try {
        index = implementation === 'baseline' ? await module.loadAnimeMappings() :
            await module.loadMappingIndex({ directory: path.join(option('directory'), 'snapshots'), sleep: async () => {} });
    } catch (failure) { error = failure.message; }
    const loadMs = performance.now() - started;
    global.gc?.();
    const heapMiB = (process.memoryUsage().heapUsed - beforeHeap) / 1048576;
    let lookupMs = null;
    if (index) {
        for (let i = 0; i < 20000; i++) index.preferredId(ids[i % ids.length]);
        const trials = [];
        let checksum = 0;
        for (let round = 0; round < 5; round++) {
            const start = performance.now();
            for (let i = 0; i < 100000; i++) checksum += index.preferredId(ids[i % ids.length]).length;
            trials.push(performance.now() - start);
        }
        lookupMs = median(trials);
        if (!checksum) throw Error('Benchmark results were unused');
    }
    // Let both parallel baseline failures settle before reporting their request count.
    if (error) await wait(20);
    process.stdout.write(JSON.stringify({ loadMs, lookupMs, heapMiB, requests, bytes, success: !!index, error }));
}
async function runWorker(implementation, directory, url) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--expose-gc', __filename, `--worker=${implementation}`, `--directory=${directory}`, `--url=${url}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', errors = '';
        child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
        child.on('error', reject); child.on('exit', code => code ? reject(Error(errors || output)) : resolve(JSON.parse(output)));
    });
}
async function main() {
    const samples = Number(option('samples') || 5);
    if (!Number.isInteger(samples) || samples < 3 || samples > 15) throw Error('--samples must be 3 through 15');
    const snapshots = option('snapshots');
    const bodies = {};
    for (const [name, file] of [['fribb', 'fribb.json'], ['animeApi', 'animeapi.tsv']]) {
        bodies[name] = snapshots ? await fs.readFile(path.join(snapshots, file), 'utf8') :
            JSON.parse(await fs.readFile(path.join(ROOT, '.cache/mappings', `${name}.snapshot.json`), 'utf8')).body;
    }
    const ids = [...new Set(JSON.parse(bodies.fribb).map(row => Number(row.anilist_id)).filter(id => Number.isSafeInteger(id) && id > 0))];
    const buffers = Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, Buffer.from(body)]));
    let unavailable = false;
    const server = http.createServer(async (request, response) => {
        if (unavailable) { response.writeHead(503, { 'content-length': 4 }); response.end('busy'); return; }
        const name = request.url.slice(1), body = buffers[name];
        if (!body) { response.writeHead(404); response.end(); return; }
        const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
        if (request.headers['if-none-match'] === etag) { response.writeHead(304, { etag }); response.end(); return; }
        response.writeHead(200, { etag, 'content-length': body.length });
        for (let offset = 0; offset < body.length && !response.destroyed; offset += 65536) {
            response.write(body.subarray(offset, offset + 65536));
            await wait(5);
        }
        response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anime-mapping-benchmark-'));
    try {
        const ts = require('typescript');
        const baseline = execFileSync('git', ['show', `${BASELINE}:src/anime-mappings.ts`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1000000 });
        await fs.writeFile(path.join(directory, 'baseline.cjs'), ts.transpileModule(baseline, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
        await fs.writeFile(path.join(directory, 'ids.json'), JSON.stringify(ids));
        const runs = [];
        for (const mode of ['cold', 'unchanged', 'outage']) {
            unavailable = mode === 'outage';
            const trials = { baseline: [], current: [] };
            for (let sample = 0; sample < samples; sample++) {
                // Alternate order to reduce warm-filesystem and CPU scheduling bias.
                for (const implementation of sample % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
                    if (mode === 'cold' && implementation === 'current') {
                        const target = path.resolve(directory, 'snapshots');
                        if (path.dirname(target) !== directory) throw Error('Unsafe snapshot cleanup');
                        await fs.rm(target, { recursive: true, force: true });
                    }
                    trials[implementation].push(await runWorker(implementation, directory, url));
                }
            }
            for (const [implementation, results] of Object.entries(trials)) {
                runs.push({ mode, implementation, success: results.every(result => result.success),
                    loadMs: median(results.map(result => result.loadMs)), lookup100kMs: results[0].lookupMs === null ? null : median(results.map(result => result.lookupMs)),
                    retainedHeapMiB: median(results.map(result => result.heapMiB)), requests: median(results.map(result => result.requests)),
                    responseBodyBytes: median(results.map(result => result.bytes)) });
            }
        }
        const report = { baseline: BASELINE, node: process.version, platform: `${process.platform}/${process.arch}`, samples,
            fixture: { bytes: buffers.fribb.length + buffers.animeApi.length, uniqueAnilist: ids.length,
                sha256: Object.fromEntries(Object.entries(buffers).map(([name, body]) => [name, createHash('sha256').update(body).digest('hex')])) },
            conditions: 'Loopback HTTP, 64 KiB chunks every 5 ms per source; fresh process per sample; median; outage retries have sleep disabled.', runs };
        await fs.mkdir('.cache', { recursive: true }); await fs.writeFile('.cache/mapping-benchmark.json', JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw Error('Unsafe benchmark cleanup');
        await fs.rm(directory, { recursive: true, force: true });
    }
}
(option('worker') ? worker() : main()).catch(error => { console.error(error.message); process.exitCode = 1; });
