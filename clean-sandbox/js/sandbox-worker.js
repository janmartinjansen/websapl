"use strict";

let window=globalThis; // fix to get js-untar to work in a web worker
importScripts (
	'instructions.js',
	'compiler.js',
	'bcgen.js',
	'bclink.js',
	'bcprelink.js',
	'abc-interpreter.js',
	'../vendor/text-encoding/lib/encoding.js',
	'../engine/abci_sw32_64_web.js',
);

let c_compiler=null;
let c_bcgen=null;
let c_bclink=null;
let c_bcprelink=null;

/* abcopt in the browser (JMVM route and optimised ABC, like clm -optabc).
 * abcopt is a Clean program; abcopt_bestand.bc is its bytecode with fixed
 * file names (abcopt_in.abc -> abcopt_uit.abc), run on Clean's C interpreter
 * compiled with Emscripten (abci_sw32_64_web, with an in-memory file system).
 * bcgen calls it synchronously, through a fresh instance of the already
 * compiled module for every .abc file. The optimised .abc replaces the raw one
 * in place, so the ABC route runs optimised bytecode and the JMVM route
 * (abc2retag, which needs abcopt's output) finds it as well. */
let abcopt=null; /* {module, bc} once loaded */
const abcopt_outputs=new Set(); /* hashes of abcopt outputs: never optimise those again */

function bytes_hash (b)
{
	let h=0x811c9dc5;
	for (let i=0; i<b.length; i++)
		h=Math.imul (h^b[i],0x01000193);
	return (h>>>0).toString (16)+':'+b.length;
}

async function load_abcopt ()
{
	const [wasm,bc]=await Promise.all ([
		fetch ('/engine/abci_sw32_64_web.wasm').then (r => r.arrayBuffer()),
		fetch ('/engine/abcopt_bestand.bc').then (r => r.arrayBuffer()),
	]);
	abcopt={module: await WebAssembly.compile (wasm), bc: new Uint8Array (bc)};
}

function run_abcopt (raw)
{
	const M={
		noInitialRun: true,
		print: () => {},
		printErr: s => console.warn ('abcopt: '+s),
		instantiateWasm: (imports,cb) => {
			cb (new WebAssembly.Instance (abcopt.module,imports),abcopt.module);
			return {};
		},
	};
	createAbciWasm (M); /* synchronous: the module is already compiled */
	M.FS.writeFile ('/abcopt.bc',abcopt.bc);
	M.FS.writeFile ('/abcopt_in.abc',raw);
	M.FS.chdir ('/');
	const rc=M.callMain (['-io','-h','128M','-s','32M','/abcopt.bc']);
	if (rc)
		throw new Error ('abcopt returned '+rc);
	return M.FS.readFile ('/abcopt_uit.abc');
}

/* bcgen's main, with abcopt first on the .abc file it is given (argv[1]). */
function bcgen_call_main_with_abcopt (argc,argv)
{
	if (abcopt!==null && argc>=2){
		try {
			const p=this.HEAPU32[(argv>>2)+1];
			let path='';
			for (let q=p; this.HEAPU8[q]!=0; q++)
				path+=String.fromCharCode (this.HEAPU8[q]);
			if (path.endsWith ('.abc')){
				if (path[0]!='/')
					path=this.FS.cwd()+'/'+path;
				const raw=this.FS.readFile (path);
				if (!abcopt_outputs.has (bytes_hash (raw))){
					const t=performance.now();
					const opt=run_abcopt (raw);
					abcopt_outputs.add (bytes_hash (opt));
					this.FS.writeFile (path,opt);
					try { c_compiler.FS.writeFile (path,opt); } catch (e) {}
					console.log ('abcopt '+path+': '+Math.round (performance.now()-t)+' ms');
				}
			}
		} catch (e) {
			console.warn ('abcopt skipped:',e);
		}
	}
	return clean_call_main.call (this,argc,argv);
}

/* Monkey-patch fetch() to keep a cache */
(() => {
	const org_fetch=globalThis.fetch;
	const cache=new Map();

	globalThis.fetch=path => {
		// Support deployments in directories instead of on the absolute root
		if (path[0]=='/')
			path='..'+path;

		if (cache.has (path))
			return new Promise (resolve => resolve (cache.get (path)));

		return org_fetch (path).then (response => {
			if (response.ok){
				cache.set (path,response);
				response.org_arrayBuffer=response.arrayBuffer;
				response.arrayBuffer=() => {
					var buffer=null;
					var resolve=null;
					var first_read_finished=new Promise (r => {resolve=r;});
					response.arrayBuffer=() => first_read_finished.then (() => buffer);
					return response.org_arrayBuffer().then (b => {
						buffer=b;
						resolve();
						return b;
					});
				};
				return response;
			} else {
				throw 'failed to fetch '+path;
			}
		});
	};
})();

const sandbox={
	shared_clean_values: null,

	/* This will be set by sandbox.icl */
	compile: () => console.error ('the Clean backend has not loaded yet!'),

	stdout: (s) => { postMessage ({stdout: s}); },
	program_stdout: (s) => { postMessage ({program_stdout: s}); },
	stderr: (s) => { postMessage ({stderr: s}); },

	init: () => {
		const make_tool=ABCInterpreter.instantiate({
			bytecode_path: '/data/sandbox.pbc',

			heap_size: 2<<20,
			stack_size: 512<<10,

			encoding: 'utf-8',

			with_js_ffi: true,
			js_ffi_options: {}
		}).then (abc => {
			abc.log=s => {postMessage ({stdout: s})};
			const asp=abc.interpreter.instance.exports.get_asp();
			const hp=abc.interpreter.instance.exports.get_hp();
			const hp_free=abc.interpreter.instance.exports.get_hp_free();

			const start_node=abc.memory_array[(abc.start>>2)+2];
			abc.memory_array[hp>>2]=start_node;
			abc.memory_array[(hp>>2)+1]=0;
			abc.interpreter.instance.exports.set_hp (hp+24);
			abc.interpreter.instance.exports.set_hp_free (hp_free-3);

			const index=abc.share_clean_value (hp,sandbox);

			abc.memory_array[asp>>2]=hp;
			abc.memory_array[(asp>>2)+1]=0;
			abc.interpreter.instance.exports.set_pc (start_node);

			const csp=abc.interpreter.instance.exports.get_csp();
			abc.memory_array[csp/4]=658*8; // instruction 0; to return
			abc.interpreter.instance.exports.set_csp (csp+8);

			abc.interpreter.instance.exports.interpret();

			abc.interpret (new SharedCleanValue (index),[sandbox,1]);
		});

		return Promise.all ([init_emscripten_modules(), make_tool])
				.then (() => {
					postMessage ({init_done: {ok: true}});
				}).catch (e => {
					postMessage ({init_done: {ok: false, error: e.message}});
				});
	},

	add_package: (pkg, v, files) => {
		files.forEach (f => {
			if (f.type != '0') /* normal file */
				return;

			let path='/clean/lib';
			const parts=f.name.split ('/');
			parts.pop();
			while (parts.length>0){
				path+='/'+parts.shift();
				try {
					c_compiler.FS.mkdir (path);
				} catch (e) {}
			}
			c_compiler.FS.writeFile ('/clean/lib/'+f.name,new Uint8Array (f.buffer));
		});
		return new Promise (resolve => c_compiler.FS.syncfs (false,resolve));
	},

	run: (path,run_opts={}) => {
		let program=null;
		
		// Redirect stdout to the bottom 'program_stdout' panel
		const compiler_stdout=c_compiler.clean_stdout;
		c_compiler.clean_stdout=sandbox.program_stdout;

		const opts={
			heap_size: (run_opts.heap_mb || 64)<<20,
			stack_size: 4<<20,
			fetch: (p) => {
				return p!==null ? fetch (p) : new Promise ((resolve) => {
					const pbc=c_bcprelink.FS.readFile (path);
					resolve ({
						ok: true,
						arrayBuffer: () => pbc.buffer
					});
				});
			},
			interpreter_imports: {
				handle_illegal_instr: (pc,instr,asp,bsp) => {
					instr=ABCInterpreter.instructions[instr];
					if (instr=='closeF')
						return i_closeF.bind (c_compiler) (program,pc,asp,bsp);
					else if (instr=='stderrF')
						return i_stderrF.bind (c_compiler) (program,pc,asp,bsp);
					else if (instr=='stdioF')
						return i_stdioF.bind (c_compiler) (program,pc,asp,bsp);
					else if (instr=='writeFC')
						return i_writeFC.bind (c_compiler) (program,pc,asp,bsp);
					else if (instr=='writeFI')
						return i_writeFI.bind (c_compiler) (program,pc,asp,bsp);
					else if (instr=='writeFS')
						return i_writeFS.bind (c_compiler) (program,pc,asp,bsp);
					else
						return 0;
				},
				halt: () => {return;}
			}
		};

		return ABCInterpreter.instantiate (opts).then ((abc) => {
			program=abc;

			abc.log=s => {postMessage ({result: s});};
			abc.files=[undefined,undefined];
			abc.stdio_open=false;

			abc.interpreter.instance.exports.set_pc(abc.start);
			const t0=performance.now();
			var r=0;
			try {
				r=abc.interpreter.instance.exports.interpret();
			} catch (e) {
				sandbox.stderr (e+'\n');
				r=-1;
			}
			const durationMs=Math.round (performance.now()-t0);

			postMessage ({flush_output: {}});

			if (r!=0)
				sandbox.stderr ('failed with return code '+r);
			postMessage ({abc_done: {ok: r==0, durationMs}});
		}).finally (() => {c_compiler.clean_stdout=compiler_stdout;});
	}
};

let jmvmLoaded=false;
let jmvmModule=null;
let abc2retagJvb=null;
let retagcompJvb=null;

async function ensureJmvmLoaded ()
{
	if (!jmvmLoaded){
		importScripts ('../engine/jmvm.js');
		jmvmLoaded=true;
	}
	if (!abc2retagJvb){
		const res=await fetch ('/engine/abc2retag.jvb');
		if (!res.ok)
			throw new Error ('Kon /engine/abc2retag.jvb niet laden ('+res.status+')');
		abc2retagJvb=new Uint8Array (await res.arrayBuffer());
	}
	if (!retagcompJvb){
		const res=await fetch ('/engine/retagcomp.jvb');
		if (!res.ok)
			throw new Error ('Kon /engine/retagcomp.jvb niet laden ('+res.status+')');
		retagcompJvb=new Uint8Array (await res.arrayBuffer());
	}
	if (!jmvmModule)
		jmvmModule=await WebAssembly.compile (await (await fetch ('/engine/jmvm.wasm')).arrayBuffer());
}

let saplcompJvb=null;
async function ensureSaplcompLoaded ()
{
	await ensureJmvmLoaded();
	if (!saplcompJvb){
		const res=await fetch ('/engine/saplcomp.jvb');
		if (!res.ok)
			throw new Error ('Kon /engine/saplcomp.jvb niet laden ('+res.status+')');
		saplcompJvb=new Uint8Array (await res.arrayBuffer());
	}
}

/* A fresh jmvm.wasm instance from the module compiled once (no fetch per
 * instance: the cached Response of the patched fetch cannot be compiled by
 * streaming twice, and the third instance hung). */
function newJmvm (opts)
{
	return createJMVMModule (Object.assign ({
		noInitialRun: true,
		instantiateWasm: (imports,cb) => {
			WebAssembly.instantiate (jmvmModule,imports).then (inst => cb (inst,jmvmModule));
			return {};
		},
	},opts));
}

function collectAbcFiles (fs, dir, out)
{
	let entries=[];
	try {
		entries=fs.readdir (dir);
	} catch (e) {
		return;
	}
	const decoder=new TextDecoder();
	for (const entry of entries){
		if (entry==='.' || entry==='..')
			continue;
		const full=dir+'/'+entry;
		try {
			const st=fs.stat (full);
			if (fs.isDir (st.mode)){
				collectAbcFiles (fs,full,out);
			} else if (entry.endsWith ('.abc')){
				out[entry]=decoder.decode (fs.readFile (full));
			}
		} catch (e) {}
	}
}


/* Run a .jvb on a fresh jmvm.wasm instance and report jmvm_done
 * (shared by the Clean route via abc2retag and the Sapl route via gen1). */
async function runJvbOnJmvm (progJvb,tTotal,extra={})
{
		postMessage ({jmvm_status: 'jmvm.wasm starten...'});

		const outBuf=[];
		const errBuf=[];
		const runInst=await newJmvm ({
			stdin: () => null,
			stdout: (c) => outBuf.push (String.fromCharCode (c)),
			stderr: (c) => errBuf.push (String.fromCharCode (c))
		});
		runInst.FS.writeFile ('/tmp/Sandbox.jvb',progJvb);
		postMessage ({jmvm_status: 'Uitvoeren op jmvm.wasm...'});

		const tExec=performance.now();
		try {
			runInst.callMain (['/tmp/Sandbox.jvb']);
		} catch (e) {
			if (e && typeof e.status==='number' && e.status!==0)
				errBuf.push ('\nExit status: '+e.status);
		}
		const execMs=Math.round (performance.now()-tExec);
		const totalMs=Math.round (performance.now()-tTotal);

		postMessage ({
			jmvm_done: {
				ok: true,
				stdout: outBuf.join (''),
				stderr: errBuf.join (''),
				execMs,
				totalMs,
				jvbSize: progJvb.length,
				...extra
			}
		});
}

async function runJmvmPipeline ()
{
	const tTotal=performance.now();
	try {
		await ensureJmvmLoaded();

		const abcFiles={};
		collectAbcFiles (c_compiler.FS,'/clean',abcFiles);
		if (!abcFiles['Sandbox.abc'])
			throw new Error ('Sandbox.abc niet gevonden in virtueel bestandssysteem.');

		postMessage ({jmvm_status: 'abc2retag.jvb uitvoeren...'});
		const abcStdin='/tmp/Sandbox.cfp_retag\n/tmp/abc/Sandbox.abc\n/tmp/abc\n';
		let abcStdinIdx=0;
		const abcLog=[];
		let abcInst=await newJmvm ({
			stdin: () => (abcStdinIdx<abcStdin.length ? abcStdin.charCodeAt (abcStdinIdx++) : null),
			stdout: (c) => abcLog.push (String.fromCharCode (c)),
			stderr: (c) => abcLog.push (String.fromCharCode (c))
		});
		abcInst.FS.writeFile ('/abc2retag.jvb',abc2retagJvb);
		abcInst.FS.mkdir ('/tmp/abc');
		for (const [fname, content] of Object.entries (abcFiles)){
			abcInst.FS.writeFile ('/tmp/abc/'+fname,content);
		}
		try {
			abcInst.callMain (['/abc2retag.jvb']);
		} catch (e) {}

		if (!abcInst.FS.analyzePath ('/tmp/Sandbox.cfp_retag').exists)
			throw new Error ('abc2retag mislukt:\n'+abcLog.join (''));

		const retagText=new TextDecoder().decode (abcInst.FS.readFile ('/tmp/Sandbox.cfp_retag'));
		abcInst=null; /* each jmvm.wasm instance holds ~690 MB: let the GC take it before the next one */

		postMessage ({retag_ready: {abc: abcFiles['Sandbox.abc'], retag: retagText}});
		postMessage ({jmvm_status: 'retagcomp.jvb uitvoeren...'});

		const stdinText='/tmp/Sandbox.cfp_retag\n/tmp/Sandbox.jvb\n';
		let stdinIdx=0;
		const compLog=[];
		let compInst=await newJmvm ({
			stdin: () => (stdinIdx<stdinText.length ? stdinText.charCodeAt (stdinIdx++) : null),
			stdout: (c) => compLog.push (String.fromCharCode (c)),
			stderr: (c) => compLog.push (String.fromCharCode (c))
		});
		compInst.FS.writeFile ('/retagcomp.jvb',retagcompJvb);
		compInst.FS.writeFile ('/tmp/Sandbox.cfp_retag',retagText);
		try {
			compInst.callMain (['/retagcomp.jvb']);
		} catch (e) {}

		if (!compInst.FS.analyzePath ('/tmp/Sandbox.jvb').exists)
			throw new Error ('retagcomp mislukt:\n'+compLog.join (''));

		const progJvb=compInst.FS.readFile ('/tmp/Sandbox.jvb');
		compInst=null;
		await runJvbOnJmvm (progJvb,tTotal);
	} catch (e) {
		postMessage ({
			jmvm_done: {
				ok: false,
				error: e && e.message ? e.message : String (e),
				totalMs: Math.round (performance.now()-tTotal)
			}
		});
	}
}


/* Sapl route: gen1 (saplcomp.jvb, the self-hosted Sapl compiler, as in
 * WebSapl) compiles the source to .jvb on jmvm.wasm, then it runs on a fresh
 * instance. gen1 does not follow #import: a program must be one file. */
function stripSaplComments (source)
{
	return source.split ('\n').map (line => {
		if (line.trim().startsWith ('||'))
			return '';
		let inStr=false, out='';
		for (let i=0; i<line.length; i++){
			if (inStr && line[i]==='\\' && i+1<line.length){
				out+=line[i]+line[i+1];
				i++;
				continue;
			}
			if (line[i]==='"')
				inStr=!inStr;
			if (!inStr && line[i]==='|' && line[i+1]==='|')
				break;
			out+=line[i];
		}
		return out;
	}).join ('\n');
}

async function runSaplPipeline (source)
{
	const tTotal=performance.now();
	try {
		if (/^\s*#import\s/m.test (source))
			throw new Error ('#import wordt hier niet ondersteund: zet alles in één bestand.');
		await ensureSaplcompLoaded();
		postMessage ({jmvm_status: 'gen1 (saplcomp.jvb) compileert...'});
		const stdinText='/tmp/in.cfp\n/tmp/Sandbox.jvb\njvb\n';
		let stdinIdx=0;
		const compLog=[];
		const tComp=performance.now();
		let compInst=await newJmvm ({
			stdin: () => (stdinIdx<stdinText.length ? stdinText.charCodeAt (stdinIdx++) : null),
			stdout: (c) => compLog.push (String.fromCharCode (c)),
			stderr: (c) => compLog.push (String.fromCharCode (c))
		});
		compInst.FS.writeFile ('/saplcomp.jvb',saplcompJvb);
		compInst.FS.writeFile ('/tmp/in.cfp',stripSaplComments (source));
		try {
			compInst.callMain (['/saplcomp.jvb']);
		} catch (e) {}
		const compileMs=Math.round (performance.now()-tComp);
		if (!compInst.FS.analyzePath ('/tmp/Sandbox.jvb').exists){
			/* Only the compiler's own messages, not the VM's start/stop lines */
			const msg=compLog.join ('').split ('\n').filter (l => !/^(VM starting|Reading file|execution started|res: |stop$|Elapsed time|nr gc|calls:|creates:|\d+ instr read)/.test (l)).join ('\n').trim();
			throw new Error ('gen1: compileren mislukt\n'+msg);
		}
		const progJvb=compInst.FS.readFile ('/tmp/Sandbox.jvb');
		compInst=null;
		await runJvbOnJmvm (progJvb,tTotal,{compileMs});
	} catch (e) {
		postMessage ({
			jmvm_done: {
				ok: false,
				error: e && e.message ? e.message : String (e),
				totalMs: Math.round (performance.now()-tTotal)
			}
		});
	}
}

/* Sapl on the ABC interpreter: ABC text (from sapl2abc) -> abcopt -> bcgen ->
 * bclink (+ runtime modules) -> bcprelink -> .pbc in c_bcprelink.FS, the same
 * Emscripten tools the make tool uses. Everything lives in /sapl, outside the
 * IDBFS mount of /clean (a syncfs would delete it there). */
const SAPL_RT_MODULES=['saplio','_Unsafe','_SystemEnumStrict','_SystemStrictLists','StdStrictLists',
	'_SystemEnum','StdEnum','StdMisc','StdFunctions','StdCharList','StdTuple','StdOrdList','StdList',
	'StdClass','StdFile','StdString','_SystemArray','StdArray','StdChar','StdReal','StdInt',
	'StdOverloaded','StdBool','StdEnv'];
let saplRtBc=null; /* {name: Uint8Array}, built once */

/* bcgen/bclink/bcprelink have no exported callMain: build argv in the memory
 * of the module and call its main, as clean_call_main does for the make tool. */
function call_backend_main (M,args)
{
	const enc=new TextEncoder();
	const argv=M._malloc (4*(args.length+1));
	const ptrs=args.map (a => {
		const b=enc.encode (a);
		const p=M._malloc (b.length+1);
		M.HEAPU8.set (b,p);
		M.HEAPU8[p+b.length]=0;
		return p;
	});
	ptrs.forEach ((p,i) => { M.HEAPU32[(argv>>2)+i]=p; });
	M.HEAPU32[(argv>>2)+args.length]=0;
	let rc;
	try {
		/* clean_call_main itself, not M.clean_call_main: for c_bcgen that is
		 * bcgen_call_main_with_abcopt, which would run abcopt over every
		 * runtime module (~10 s the first time) and a second time over the
		 * program, which the Sapl route has already optimised itself */
		rc=clean_call_main.call (M,args.length,argv);
	} finally {
		ptrs.forEach (p => M._free (p));
		M._free (argv);
	}
	return rc;
}

function mkdir_p (FS,dir)
{
	try { FS.mkdir (dir); } catch (e) {}
}

function bcgen_file (abcPath,bcPath)
{
	try { c_bcgen.FS.unlink (bcPath); } catch (e) {}
	const rc=call_backend_main (c_bcgen,['/bcgen',abcPath,'-o',bcPath]);
	if (!c_bcgen.FS.analyzePath (bcPath).exists)
		throw new Error ('bcgen mislukt voor '+abcPath+' (rc '+rc+')');
	return c_bcgen.FS.readFile (bcPath);
}

async function ensureSaplRt ()
{
	if (saplRtBc)
		return;
	const t0=performance.now();
	const rt={};
	mkdir_p (c_bcgen.FS,'/sapl');
	mkdir_p (c_bcgen.FS,'/sapl/rt');
	for (const m of ['_system',...SAPL_RT_MODULES]){
		const res=await fetch ('/engine/abc_rt/'+m+'.abc');
		if (!res.ok)
			throw new Error ('Kon /engine/abc_rt/'+m+'.abc niet laden');
		c_bcgen.FS.writeFile ('/sapl/rt/'+m+'.abc',new Uint8Array (await res.arrayBuffer()));
		rt[m]=bcgen_file ('/sapl/rt/'+m+'.abc','/sapl/rt/'+m+'.bc');
	}
	saplRtBc=rt;
	console.log ('sapl runtime-modules gebouwd: '+Math.round (performance.now()-t0)+' ms');
}

/* ABC text -> {pbc: path in c_bcprelink.FS, ms} */
async function saplAbcToPbc (abcText,name)
{
	const t0=performance.now();
	await ensureSaplRt();
	mkdir_p (c_bcgen.FS,'/sapl');
	mkdir_p (c_bclink.FS,'/sapl');
	mkdir_p (c_bcprelink.FS,'/sapl');
	const tRt=performance.now();
	c_bcgen.FS.writeFile ('/sapl/'+name+'.abc',abcText);
	const bc=bcgen_file ('/sapl/'+name+'.abc','/sapl/'+name+'.bc');
	const tGen=performance.now();
	const needIo=/^\.impmod saplio$/m.test (abcText);
	const inputs=['/sapl/'+name+'.bc'];
	c_bclink.FS.writeFile ('/sapl/'+name+'.bc',bc);
	if (needIo)
		for (const m of SAPL_RT_MODULES){
			c_bclink.FS.writeFile ('/sapl/'+m+'.bc',saplRtBc[m]);
			inputs.push ('/sapl/'+m+'.bc');
		}
	c_bclink.FS.writeFile ('/sapl/_system.bc',saplRtBc['_system']);
	inputs.push ('/sapl/_system.bc');
	const lnk='/sapl/'+name+'.lnk.bc';
	try { c_bclink.FS.unlink (lnk); } catch (e) {}
	const rc1=call_backend_main (c_bclink,['/bclink',...inputs,'-o',lnk]);
	if (!c_bclink.FS.analyzePath (lnk).exists)
		throw new Error ('bclink mislukt (rc '+rc1+')');
	const tLink=performance.now();
	c_bcprelink.FS.writeFile (lnk,c_bclink.FS.readFile (lnk));
	const pbc='/sapl/'+name+'.pbc';
	try { c_bcprelink.FS.unlink (pbc); } catch (e) {}
	const rc2=call_backend_main (c_bcprelink,['/bcprelink',lnk,'-o',pbc]);
	if (!c_bcprelink.FS.analyzePath (pbc).exists)
		throw new Error ('bcprelink mislukt (rc '+rc2+')');
	const r=Math.round;
	const now=performance.now();
	console.log ('sapl abc: runtime '+r (tRt-t0)+' ms, bcgen '+r (tGen-tRt)+' ms, bclink '+r (tLink-tGen)+' ms, bcprelink '+r (now-tLink)+' ms');
	return {pbc,ms: r (now-t0)};
}

/* Run a .jvb tool on a fresh jmvm.wasm instance with a stdin text; files is
 * {path: contents} to write first; returns {log, fs} */
async function runJvbTool (toolJvb,stdinText,files)
{
	let idx=0;
	const log=[];
	const inst=await newJmvm ({
		stdin: () => (idx<stdinText.length ? stdinText.charCodeAt (idx++) : null),
		stdout: (c) => log.push (String.fromCharCode (c)),
		stderr: (c) => log.push (String.fromCharCode (c))
	});
	inst.FS.writeFile ('/tool.jvb',toolJvb);
	for (const [p,c] of Object.entries (files))
		inst.FS.writeFile (p,c);
	try {
		inst.callMain (['/tool.jvb']);
	} catch (e) {}
	return {log: log.join (''),fs: inst.FS};
}

function toolMessages (log)
{
	return log.split ('\n').filter (l => !/^(VM starting|Reading file|execution started|res: |stop$|Elapsed time|nr gc|calls:|creates:|\d+ instr read)/.test (l)).join ('\n').trim();
}

let sapl2abcJvb=null;
const SAPL_ABC_OPT='int,case,scrut,velden,bool,repl,lits';
const SAPL_ABC_MODULE='SaplProg';

/* Sapl -> gen1 (stage retag) -> sapl2abc -> abcopt -> bcgen/bclink/bcprelink
 * -> ABC interpreter. Reports abc_build, then sandbox.run reports abc_done. */
async function runSaplAbcPipeline (source)
{
	const t0=performance.now();
	try {
		if (/^\s*#import\s/m.test (source))
			throw new Error ('#import wordt hier niet ondersteund: zet alles in één bestand.');
		await ensureSaplcompLoaded();
		if (!sapl2abcJvb){
			const res=await fetch ('/engine/sapl2abc.jvb');
			if (!res.ok)
				throw new Error ('Kon /engine/sapl2abc.jvb niet laden ('+res.status+')');
			sapl2abcJvb=new Uint8Array (await res.arrayBuffer());
		}
		if (abcopt===null)
			await load_abcopt();

		postMessage ({abc_status: 'gen1 (stage retag)...'});
		let t=performance.now();
		let r=await runJvbTool (saplcompJvb,'/tmp/in.cfp\n/tmp/prog.retag\nretag\n',
			{'/tmp/in.cfp': stripSaplComments (source)});
		if (!r.fs.analyzePath ('/tmp/prog.retag').exists)
			throw new Error ('gen1: compileren mislukt\n'+toolMessages (r.log));
		const retag=new TextDecoder().decode (r.fs.readFile ('/tmp/prog.retag'));
		r=null;
		const gen1Ms=Math.round (performance.now()-t);

		postMessage ({abc_status: 'sapl2abc...'});
		t=performance.now();
		r=await runJvbTool (sapl2abcJvb,'/tmp/prog.retag\n/tmp/prog.abc\n'+SAPL_ABC_MODULE+'\n'+SAPL_ABC_OPT+'\n',
			{'/tmp/prog.retag': retag});
		if (!r.fs.analyzePath ('/tmp/prog.abc').exists)
			throw new Error ('sapl2abc mislukt\n'+toolMessages (r.log));
		const abcRaw=r.fs.readFile ('/tmp/prog.abc');
		r=null;
		const s2aMs=Math.round (performance.now()-t);
		postMessage ({retag_ready: {abc: new TextDecoder().decode (abcRaw),retag}});

		postMessage ({abc_status: 'abcopt...'});
		t=performance.now();
		const abcOpt=new TextDecoder().decode (run_abcopt (abcRaw));
		const optMs=Math.round (performance.now()-t);

		postMessage ({abc_status: 'bcgen, bclink, bcprelink...'});
		const b=await saplAbcToPbc (abcOpt,SAPL_ABC_MODULE);
		postMessage ({abc_build: {gen1Ms,s2aMs,optMs,linkMs: b.ms,totalMs: Math.round (performance.now()-t0)}});
		await sandbox.run (b.pbc);
	} catch (e) {
		postMessage ({abc_done: {ok: false,error: e && e.message ? e.message : String (e)}});
	}
}

/* probe: fixed ABC text, no sapl2abc */
async function runAbcTextProbe (abcText,name,heapMB)
{
	try {
		const r=await saplAbcToPbc (abcText,name);
		postMessage ({probe_done: {ok: true,buildMs: r.ms,pbcSize: c_bcprelink.FS.readFile (r.pbc).length}});
		await sandbox.run (r.pbc,{heap_mb: heapMB});
	} catch (e) {
		postMessage ({probe_done: {ok: false,error: e && e.message ? e.message : String (e)}});
	}
}

/* When the compiler has to compile the whole standard environment in one
 * session (the first compile after the library was installed), it sometimes
 * reports a parse error in a library .dcl it has already read once in that
 * session, e.g. the last line of _SystemDynamic.dcl while compiling StdEnum.
 * The file is read correctly, and the error moves between runs; the original
 * sandbox has the same problem. A second compile, which only compiles what is
 * still out of date, succeeds. So: on a parse error in a library .dcl, compile
 * once more (the page clears the output of the first attempt). */
function compileWithRetry (paths,done,attempt=1)
{
	let log='';
	const out=c_compiler.clean_stdout, err=c_compiler.clean_stderr;
	c_compiler.clean_stdout=s => { log+=s; out (s); };
	c_compiler.clean_stderr=s => { log+=s; err (s); };
	sandbox.compile (paths,'Sandbox',ok => {
		c_compiler.clean_stdout=out;
		c_compiler.clean_stderr=err;
		if (!ok && attempt<3 && /Parse error \[(?!Sandbox\.)[^,\]]+\.dcl,/.test (log)){
			console.warn ('compile: parse error in a library module, compiling again');
			postMessage ({compile_retry: {attempt: attempt+1}});
			/* not from inside this callback, which may run within the interpreter */
			setTimeout (() => compileWithRetry (paths,done,attempt+1),0);
		} else
			done (ok);
	});
}

onmessage=function (e) {
	e=e.data;
	if ('abc_probe' in e)
		runAbcTextProbe (e.abc_probe.abc,e.abc_probe.name,e.abc_probe.heapMB);
	if ('init' in e)
		sandbox.init();
	if ('add_package' in e){
		sandbox.add_package (e.add_package.name,e.add_package.version,e.add_package.files)
				.then (() => {
					postMessage ({add_package_done: {ok: true}});
				}).catch (e => {
					postMessage ({add_package_done: {ok: false, error: e.message}});
				});
	}
	if ('compile' in e)
		c_compiler.FS.syncfs (true,() => {
			c_compiler.FS.writeFile ('/clean/src/Sandbox.icl',e.compile.module);
			compileWithRetry (e.compile.paths,ok => {
				let sandboxAbc=null;
				if (ok){
					try {
						const raw=c_compiler.FS.readFile ('/clean/src/Clean System Files/Sandbox.abc');
						sandboxAbc=new TextDecoder().decode (raw);
					} catch (err) {}
				}
				postMessage ({compile_done: {ok: ok, abc: sandboxAbc}});
			});
		});
	if ('sapl_run' in e){
		const engine=e.sapl_run.engine || 'jmvm';
		if (engine==='jmvm')
			runSaplPipeline (e.sapl_run.source);
		else if (engine==='abc')
			runSaplAbcPipeline (e.sapl_run.source);
		else if (engine==='both')
			runSaplAbcPipeline (e.sapl_run.source).then (() => runSaplPipeline (e.sapl_run.source));
	}
	if ('run' in e){
		const engine=e.run.engine || 'abc';
		if (engine==='abc')
			sandbox.run ('Sandbox.pbc');
		else if (engine==='jmvm')
			runJmvmPipeline();
		else if (engine==='both')
			sandbox.run ('Sandbox.pbc').then (() => runJmvmPipeline());
	}
};

function fmtime (path)
{
	try {
		return this.stat (path).mtime.getTime();
	} catch (e) {}
	return 0;
}

function read_abc_dependencies (path)
{
	try {
		const arr=c_compiler.FS.readFile (path);
		const decoder=new TextDecoder();
		const deps=[];

		var start=0;
		while (start<arr.length){
			for (var end=start; end<arr.length && arr[end]!=10; end++);
			const s=decoder.decode (new Uint8Array (arr.buffer,start,end-start));
			if (s.substring (0,7)=='.depend')
				deps.push (s.substring (9,s.length-1));
			else if (s=='.endinfo')
				break;
			start=end+1;
		}

		return deps;
	} catch (e) {console.warn (e);}

	return [];
}

let clean_compiler=null;

function create_clean_compiler ()
{
	return ABCInterpreter.instantiate ({
		bytecode_path: '/data/cocl.pbc',
		heap_size: 128<<20,
		stack_size: 2<<20,

		interpreter_imports: {
			handle_illegal_instr: (pc,instr,asp,bsp,csp,hp,hp_free) => {
				instr=ABCInterpreter.instructions[instr];
				if (instr=='ccall')
					return i_ccall.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='closeF')
					return i_closeF.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='endF')
					return i_endF.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='openF')
					return i_openF.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='readLineF')
					return i_readLineF.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='stderrF')
					return i_stderrF.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='stdioF')
					return i_stdioF.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='writeFC')
					return i_writeFC.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='writeFI')
					return i_writeFI.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else if (instr=='writeFS')
					return i_writeFS.bind (c_compiler) (clean_compiler,pc,asp,bsp);
				else
					return 0;
			},
			illegal_instr: function (addr, instr) {
				const name=ABCInterpreter.instructions[instr];
				addr=addr/8-clean_compiler.code_offset;
				throw 'illegal instruction '+instr+' ('+name+') at address '+addr;
			},
			out_of_memory: function () {
				throw 'out of memory';
			},
			halt: function (pc, hp_free, hp_size) {
			},

			putchar: function (v) {
				if (clean_compiler.skip_next_newline){
					clean_compiler.skip_next_newline=false;
					if (v==10)
						return;
					else
						sandbox.stdout (65536);
				}
				sandbox.stdout (String.fromCharCode(v));
			},
			print_int: function (high,low) {
				if ((high==0 && low>=0) || (high==-1 && low<0)){
					if (low==65536){
						clean_compiler.skip_next_newline=true;
						return;
					}
					sandbox.stdout (low);
				} else if (typeof BigInt!='undefined'){
					var n=BigInt(high)*BigInt(2)**BigInt(32);
					if (low<0) {
						n+=BigInt(2)**BigInt(31);
						low+=2**31;
					}
					n+=BigInt(low);
					sandbox.stdout (n);
				} else {
					console.warn ('print_int: truncating 64-bit integer because this browser has no BigInt');
					sandbox.stdout (low);
				}
			},
			print_bool: function (v) {
				sandbox.stdout (v==0 ? 'False' : 'True');
			},
			print_char: function (v) {
				sandbox.stdout ("'"+String.fromCharCode(v)+"'");
			},
			print_real: function (v) {
				sandbox.stdout (Number(0+v).toLocaleString(
					['en-US'],
					{
						useGrouping: false,
						maximumSignificantDigits: 15,
					}
				));
			},
		}
	}).then (abc => {
		clean_compiler=abc;

		// hack to not show '65536' after every run
		clean_compiler.skip_next_newline=false;

		clean_compiler.files=[undefined,undefined]; /* first two are stdio and stderr */
		clean_compiler.stdio_open=false;

		clean_compiler.clear_cafs=function(){
			var p=97*2;
			while (p!=0){
				var next=clean_compiler.memory_array[p-2]>>2;
				clean_compiler.memory_array[p-2]=0;
				clean_compiler.memory_array[p-1]=0;
				clean_compiler.memory_array[p  ]=0;
				clean_compiler.memory_array[p+1]=0;
				p=next;
			}
			clean_compiler.memory_array[97*2]=97*8;
		};

		clean_compiler.compile=function(){
			clean_compiler.clear_cafs();
			c_compiler.clean_stdio_open=false;

			var res=0;
			try {
				clean_compiler.interpreter.instance.exports.set_pc (clean_compiler.start);
				clean_compiler.interpreter.instance.exports.interpret()==0;
				res=c_compiler.clean_return_code;
			} catch (e) {
				console.warn (e);
				res=e;
				/* Memory may be badly corrupted, create a new instance to be sure */
				create_clean_compiler();
			}

			postMessage ({flush_output: {}});

			return res;
		};
	});
}

function clean_call_main (argc,argv)
{
	try {
		return this._main (argc,argv);
	} catch (e) {
		console.warn (e);
		throw e;
		return -1;
	}
}

function init_emscripten_modules ()
{
	const instantiate_opts={
		print: (s) => sandbox.stdout (s+'\n'),
		printErr: (s) => sandbox.stderr (s+'\n')
	};

	return compiler (Object.assign ({},instantiate_opts)).then ((instance) => {
		c_compiler=instance;
		c_compiler.clean_stdout=sandbox.stdout;
		c_compiler.clean_stderr=sandbox.stderr;

		// ArgEnv
		c_compiler._ArgEnvGetCommandLineCountC=() => c_compiler.clean_argc;

		c_compiler._ArgEnvGetCommandLineArgumentC=(i,sizep,sp) => {
			const arg=c_compiler.HEAP32[c_compiler.clean_argv/4+i];
			var p=arg;
			for (; c_compiler.HEAPU8[p]!=0; p++);
			c_compiler.HEAP32[sizep/4]=p-arg;
			c_compiler.HEAP32[sp/4]=arg;
		};

		c_compiler._ArgEnvCopyCStringToCleanStringC=(cs,cleans) => {
			const size=c_compiler.HEAP32[cleans/4];
			cleans+=4;
			for (var i=0; i<size; i++)
				c_compiler.HEAPU8[cleans++]=c_compiler.HEAPU8[cs++];
		};
		c_compiler._ArgEnvCopyCStringToCleanStringC.sync_strings_back_to_clean=true;

		// set_return_code
		c_compiler._set_return_code=(c) => {c_compiler.clean_return_code=c;};
	}).then (() => Promise.all ([
		create_clean_compiler(),
		bcgen     (Object.assign ({},instantiate_opts)).then ((instance) => c_bcgen=instance),
		bclink    (Object.assign ({},instantiate_opts)).then ((instance) => c_bclink=instance),
		bcprelink (Object.assign ({},instantiate_opts)).then ((instance) => c_bcprelink=instance),
		load_abcopt().catch (e => console.warn ('abcopt not available:',e))
	])).then (() => {
		c_bcgen.clean_call_main=bcgen_call_main_with_abcopt.bind (c_bcgen);
		c_bclink.clean_call_main=clean_call_main.bind (c_bclink);
		c_bcprelink.clean_call_main=clean_call_main.bind (c_bcprelink);

		c_compiler.FS.mkdir ('/clean');
		c_compiler.FS.mount (c_compiler.IDBFS,{},'/clean');
		c_compiler.FS.mkdir ('/clean/lib');
		c_compiler.FS.mkdir ('/clean/src');
		c_compiler.FS.fmtime=fmtime.bind (c_compiler.FS);

		const mount=backend => new Promise (resolve => {
			backend.FS.mkdir ('/clean');
			backend.FS.mount (backend.IDBFS,{},'/clean');
			backend.FS.syncfs (true,err => {
				if (err)
					throw err;
				backend.FS.chdir ('/clean/src');
				resolve();
			});
			backend.FS.fmtime=fmtime.bind (backend.FS);
		});

		return new Promise (resolve => {
			c_compiler.FS.syncfs (false,() => {
				Promise.all ([
					mount (c_bcgen),
					mount (c_bclink),
					mount (c_bcprelink),
				]).then (resolve);
			});
		});
	});
}
