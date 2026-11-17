"use strict";

function escapeHTML (unsafe)
{
	const map={
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
		"/": '&#x2F;'
	};
	return String (unsafe).replace (/[&<>"'\/]/g, (s) => map[s]);
}

const sandbox={
	worker: null,

	output_timer: null,
	output_buffer: '',
	flush_output: () => {
		if (sandbox.output_timer){
			window.clearTimeout (sandbox.output_timer);
			sandbox.output_timer=null;
		}

		const at_bottom=sandbox.output.scrollTop+sandbox.output.offsetHeight>=sandbox.output.scrollHeight;
		sandbox.output.append (sandbox.output_buffer);
		sandbox.output_buffer='';
		if (at_bottom)
			sandbox.output.parentNode.scrollTop=sandbox.output.parentNode.scrollHeight;
	},
	stdout: (s) => {
		/* Add zero-width space to allow line wrapping on commas */
		s=String (s).replace (/,/g,',\u200b');
		sandbox.output_buffer+=s;
		if (s.indexOf ('\n')>=0)
			/* Flush immediately on line endings */
			sandbox.flush_output();
		else if (sandbox.output_timer===null)
			/* We use an interval to not spend all our time in layout */
			sandbox.output_timer=window.setTimeout (sandbox.flush_output,100);
	},
	stderr: (s) => {
		let span=document.createElement ('span');
		span.className='err';
		span.textContent=s;
		/* Stderr is less frequent than stdout, so we just write without timeout */
		sandbox.flush_output();
		sandbox.output.append (span);
	},
	program_output_timer: null,
	program_output_buffer: '',
	flush_program_output: () => {
		if (sandbox.program_output_timer){
			window.clearTimeout (sandbox.program_output_timer);
			sandbox.program_output_timer=null;
		}

		const container=sandbox.program_output.parentNode;
		const at_bottom=container.scrollTop+container.offsetHeight>=container.scrollHeight;
		sandbox.program_output.append (sandbox.program_output_buffer);
		sandbox.program_output_buffer='';
		if (at_bottom)
			container.scrollTop=container.scrollHeight;
	},
	program_stdout: (s) => {
		/* Add zero-width space to allow line wrapping on commas */
		s=String (s).replace (/,/g,',\u200b');
		sandbox.sec_abc_stdout.classList.remove ('leeg');
		sandbox.program_output_buffer+=s;
		if (s.indexOf ('\n')>=0)
			sandbox.flush_program_output();
		else if (sandbox.program_output_timer===null)
			sandbox.program_output_timer=window.setTimeout (sandbox.flush_program_output,100);
	},

	update_package_views: () => {
		sandbox.packages_selection.innerHTML='';
		sandbox.packages_add_name.innerHTML='';
		sandbox.packages_add_button.disabled=true;

		for (let name in sandbox.packages){
			if (sandbox.packages[name].loaded !== null){
				let li=document.createElement ('li');
				li.innerText=name + ' ' + sandbox.packages[name].loaded;
				sandbox.packages_selection.appendChild (li);
			} else {
				let option=document.createElement ('option');
				option.value=name;
				option.innerText=name;
				sandbox.packages_add_name.appendChild (option);
				sandbox.packages_add_button.disabled=false;
			}
		};
		sandbox.packages_add_name.onchange(); /* update version field */
	},

	add_package_callback: null,
	fetch_package: (pkg, v) => {
		return new Promise ((resolve,reject) => {
					if (sandbox.packages[pkg].loaded !== null)
						reject ('This package has already been loaded.');
					sandbox.packages[pkg].loaded=v;
					sandbox.update_package_views();
					resolve();
				}).then (() => fetch ('data/packages/'+pkg+'-'+v+'.tar.gz'))
				.then (res => res.arrayBuffer())
				.then (pako.inflate)
				.then (arr => untar (arr.buffer))
				.then (files => new Promise ((resolve,reject) => {
					sandbox.add_package_callback=function (e) {
						sandbox.add_package_callback=null;
						if (e.ok)
							resolve();
						else
							reject (e.error);
					};

					sandbox.worker.postMessage ({add_package: {
						name: pkg,
						version: v,
						files: files
					}});
				}));
	},

	init: (opts) => {
		sandbox.btn_compile_run=opts.btn_compile_run;
		sandbox.btn_chapters=opts.btn_chapters;
		sandbox.chapter_description=opts.chapter_description;
		sandbox.chapter_heading=opts.chapter_heading;
		sandbox.chapter_navigation=opts.chapter_navigation;
		sandbox.chapter_next=opts.chapter_next;
		sandbox.chapter_number=opts.chapter_number;
		sandbox.chapter_previous=opts.chapter_previous;
		sandbox.chapter_title=opts.chapter_title;
		sandbox.chapters_hide=opts.chapters_hide;
		sandbox.chapters_modal=opts.chapters_modal;
		sandbox.chapters_overview=opts.chapters_overview;
		sandbox.compile_indicator=opts.compile_indicator;
		sandbox.engine_select=opts.engine_select;
		sandbox.output=opts.output;
		sandbox.program_output=opts.program_output;
		sandbox.jmvm_output=opts.jmvm_output;
		sandbox.abc_timing=opts.abc_timing;
		sandbox.jmvm_timing=opts.jmvm_timing;
		sandbox.sec_abc_result=opts.sec_abc_result;
		sandbox.sec_abc_stdout=opts.sec_abc_stdout;
		sandbox.sec_jmvm_result=opts.sec_jmvm_result;
		sandbox.abc_view=opts.abc_view;
		sandbox.retag_view=opts.retag_view;

		const update_engine_sections=() => {
			const eng=sandbox.engine_select.value;
			const showAbc=eng==='abc' || eng==='both';
			const showJmvm=eng==='jmvm' || eng==='both';
			sandbox.sec_abc_result.classList.toggle ('d-none',!showAbc);
			sandbox.sec_abc_stdout.classList.toggle ('d-none',!showAbc);
			sandbox.sec_jmvm_result.classList.toggle ('d-none',!showJmvm);
		};
		sandbox.engine_select.onchange=update_engine_sections;
		update_engine_sections();

		/* Language: Clean (ABC directly, or JMVM via abc2retag) or Sapl (ABC via
		 * sapl2abc, or JMVM via gen1); the engine choice stays the same */
		sandbox.lang_select=opts.lang_select;
		const abc_option=[...sandbox.engine_select.options].find (o => o.value==='abc');
		const jmvm_option=[...sandbox.engine_select.options].find (o => o.value==='jmvm');
		sandbox.update_language=() => {
			const sapl=sandbox.lang_select.value==='sapl';
			abc_option.textContent=sapl ? 'ABC Interpreter (sapl2abc)' : 'ABC Interpreter';
			jmvm_option.textContent=sapl ? 'JMVM (gen1)' : 'JMVM (abc2retag)';
			update_engine_sections();
		};
		sandbox.lang_select.onchange=sandbox.update_language;
		sandbox.update_language();
		sandbox.packages_selection=opts.packages_selection;
		sandbox.packages_add_name=opts.packages_add_name;
		sandbox.packages_add_version=opts.packages_add_version;
		sandbox.packages_add_button=opts.packages_add_button;
		const tour_enabled=new URLSearchParams (window.location.search).get ('tour')!=='off'; /* on by default in the JMVM version: the examples are the benchmarks */
		sandbox.btn_chapters.classList.toggle ('d-none',!tour_enabled);
		sandbox.chapter_heading.classList.toggle ('d-none',!tour_enabled);
		sandbox.chapter_navigation.classList.toggle ('d-none',!tour_enabled);

		/* Interface */
		const ui=create_monaco_editor (opts.editor).then (editor => {
			sandbox.editor=editor;
			if (tour_enabled)
				initialize_chapters (editor);
			else
				editor.setValue (`module Sandbox

import StdEnv

Start :: *World -> *World
Start world
	# (io,world) = stdio world
	# io = foldl (\\io p -> io <<< p <<< ' ') io (take 10 primes)
	# io = io <<< '\\n'
	# (_,world) = fclose io world
	= world

primes =:
	[ 2, 3
	:[ p
	\\\\ p <- [5,7..]
	 | isEmpty [d \\\\ d <- takeWhile (\\d -> d*d <= p) primes | p rem d == 0]
	]]
`);
		});

		let compiled_program=null;
		let compiling_program=null;
		sandbox.btn_compile_run.onclick=() => {
			sandbox.output.innerHTML='';
			sandbox.flush_program_output();
			sandbox.program_output.innerHTML='';
			sandbox.sec_abc_stdout.classList.add ('leeg');
			sandbox.jmvm_output.innerHTML='';
			sandbox.abc_timing.innerText='';
			sandbox.jmvm_timing.innerText='';
			sandbox.retag_view.innerText='';

			if (sandbox.lang_select.value==='sapl'){
				sandbox.abc_view.innerText='';
				sandbox.btn_compile_run.disabled=true;
				sandbox.compile_indicator.style.display='inline-block';
				compiled_program=null;
				sandbox.worker.postMessage ({sapl_run: {source: sandbox.editor.getValue(),engine: sandbox.engine_select.value}});
				return;
			}

			let paths=['/clean/src'];
			for (let name in sandbox.packages)
				if (sandbox.packages[name].loaded !== null)
					paths.push ('/clean/lib/'+name+'-'+sandbox.packages[name].loaded+'/lib');

			const program={
				module: sandbox.editor.getValue(),
				paths: paths
			};

			const engine=sandbox.engine_select.value;
			const program_key=JSON.stringify (program);
			if (program_key===compiled_program){
				// If the program didn't change, don't re-compile
				sandbox.btn_compile_run.disabled=true;
				sandbox.compile_indicator.style.display='inline-block';
				sandbox.worker.postMessage ({run: {engine}});
			} else {
				sandbox.abc_view.innerText='';
				sandbox.btn_compile_run.disabled=true;
				sandbox.compile_indicator.style.display='inline-block';
				sandbox.output.classList.add ('compiling');
				compiling_program=program_key;
				sandbox.worker.postMessage ({compile: {
					module: program.module,
					paths: paths
				}});
			}
		};

		sandbox.packages_add_name.onchange=() => {
			sandbox.packages_add_version.innerHTML='';
			let name=sandbox.packages_add_name.value;
			if (!name)
				return;
			sandbox.packages[name].forEach (version => {
				let option=document.createElement ('option');
				option.value=version;
				option.innerText=version;
				sandbox.packages_add_version.appendChild (option);
			});
			sandbox.packages_add_version.childNodes[sandbox.packages_add_version.childNodes.length-1].selected=true;
		};

		sandbox.packages_add_button.onclick=() => {
			let pkg=sandbox.packages_add_name.value;
			let v=sandbox.packages_add_version.value;

			/* disabled status of the button is handled in update_package_views() */
			sandbox.packages_add_name.disabled=true;
			sandbox.packages_add_version.disabled=true;

			sandbox.fetch_package (pkg,v)
					.catch (e => {
						window.alert (e);
					}).finally (() => {
						sandbox.packages_add_name.disabled=false;
						sandbox.packages_add_version.disabled=false;
					});
		};

		/* Libraries */
		const packages=fetch ('data/packages.json')
				.then (res => res.arrayBuffer())
				.then (buf => new TextDecoder().decode (buf))
				.then (JSON.parse)
				.then (packages => {
					sandbox.packages=packages;
					for (let name in sandbox.packages)
						sandbox.packages[name].loaded=null;
					sandbox.update_package_views();
				});

		/* Sandbox worker */
		let init_resolve=null;
		let init_reject=null;
		let init_promise=new Promise ((resolve,reject) => {
			init_resolve=resolve;
			init_reject=reject;
		});
		sandbox.worker=new Worker ('js/sandbox-worker.js');
			sandbox.worker.onmessage=function (e) {
			e=e.data;
			if ('stdout' in e)
				sandbox.stdout (e.stdout);
			if ('result' in e)
				sandbox.stdout (e.result);
			/* bcgen/bclink warn about the file I/O instructions of StdFile that the
			 * interpreter in the browser does not support; harmless unless a
			 * program opens files, so not shown */
			if ('stderr' in e && !/^Warning: (some instructions require file I\/O|instruction \w+ is not supported by the interpreter)/.test (e.stderr))
				sandbox.stderr (e.stderr);
			if ('program_stdout' in e)
				sandbox.program_stdout (e.program_stdout);
			if ('flush_output' in e){
				sandbox.flush_output();
				sandbox.flush_program_output();
			}
			if ('init_done' in e){
				if (e.init_done.ok)
					init_resolve();
				else
					init_reject (e.init_done.error);
			}
			if ('add_package_done' in e)
				sandbox.add_package_callback (e.add_package_done);
			if ('compile_done' in e){
				sandbox.flush_output();
				if (e.compile_done.abc)
					sandbox.abc_view.innerText=e.compile_done.abc;
				if (e.compile_done.ok){
					compiled_program=compiling_program;
					sandbox.output.classList.remove ('compiling');
					sandbox.output.innerHTML='';
					sandbox.worker.postMessage ({run: {engine: sandbox.engine_select.value}});
				} else {
					sandbox.btn_compile_run.disabled=false;
					sandbox.compile_indicator.style.display='none';
				}
				compiling_program=null;
			}
			if ('abc_status' in e)
				sandbox.abc_timing.innerText=e.abc_status;
			if ('abc_build' in e){
				const b=e.abc_build;
				sandbox.abc_build_text='vertalen '+b.totalMs+' ms';
				sandbox.abc_timing.title='gen1 '+b.gen1Ms+' ms, sapl2abc '+b.s2aMs+' ms, abcopt '+b.optMs+' ms, bcgen/bclink/bcprelink '+b.linkMs+' ms';
				sandbox.abc_timing.innerText=sandbox.abc_build_text;
				sandbox.flush_output();
				sandbox.output.innerHTML=''; /* bcgen's warnings about the runtime modules, as the Clean route clears the compiler's output */
			}
			if ('abc_done' in e){
				if (e.abc_done.ok===false && e.abc_done.error){
					sandbox.abc_timing.innerText='fout';
					sandbox.stderr (e.abc_done.error+'\n');
					sandbox.flush_output();
				} else
				{
					if (!(sandbox.lang_select.value==='sapl' && sandbox.abc_build_text))
						sandbox.abc_timing.title='';
					sandbox.abc_timing.innerText=(sandbox.lang_select.value==='sapl' && sandbox.abc_build_text ? sandbox.abc_build_text+', ' : '')+'exec '+e.abc_done.durationMs+' ms';
				}
				sandbox.abc_build_text=null;
				if (sandbox.engine_select.value==='abc'){
					sandbox.btn_compile_run.disabled=false;
					sandbox.compile_indicator.style.display='none';
				}
			}
			if ('jmvm_status' in e){
				sandbox.jmvm_timing.innerText=e.jmvm_status;
			}
			if ('retag_ready' in e){
				if (e.retag_ready.abc)
					sandbox.abc_view.innerText=e.retag_ready.abc;
				if (e.retag_ready.retag)
					sandbox.retag_view.innerText=e.retag_ready.retag;
			}
			if ('jmvm_done' in e){
				sandbox.btn_compile_run.disabled=false;
				sandbox.compile_indicator.style.display='none';
				if (e.jmvm_done.ok){
					sandbox.jmvm_timing.innerText=(e.jmvm_done.compileMs!==undefined ? 'gen1 '+e.jmvm_done.compileMs+' ms, ' : 'vertalen '+(e.jmvm_done.totalMs-e.jmvm_done.execMs)+' ms, ')+'exec '+e.jmvm_done.execMs+' ms';
					/* Only the program's own output: the VM's start/stop lines and
					 * statistics go to the tooltip of the timing; "res: v" becomes v,
					 * except for a Clean Start that returns the World (the ABC
					 * interpreter shows nothing for that either) */
					const all=(e.jmvm_done.stdout || '')+(e.jmvm_done.stderr ? '\n'+e.jmvm_done.stderr : '');
					const meta=/^(VM starting|Reading file|\d+ instr read|execution started|stop$|Elapsed time|nr gc|calls:|creates:)/;
					const worldStart=sandbox.lang_select.value==='clean' && /^Start\s*::.*\*World/m.test (sandbox.editor.getValue());
					const stats=[];
					const lines=[];
					all.replace (/\nstop$/m,'\n').split ('\n').forEach (l => {
						if (meta.test (l)){
							if (/^(Elapsed|nr gc|calls|creates)/.test (l))
								stats.push (l);
						} else if (/(^| )res: /.test (l)){
							/* the VM prints "res: v" after the program's own output, on
							 * the same line when that does not end in a newline. For
							 * Clean via abc2retag an inline res is the artificial result
							 * after the printed list (ABC shows only the list); a Sapl
							 * start's value is shown by the ABC route too */
							const i=l.lastIndexOf ('res: ');
							const before=l.slice (0,i);
							const v=l.slice (i+5).replace (/^\(string: (.*)\)$/,'"$1"'); /* as the ABC interpreter shows a string */
							if (sandbox.lang_select.value==='sapl')
								lines.push (before+v);
							else if (worldStart)
								lines.push (before.replace (/ +$/,''));
							else if (before.trim()!==''){
								/* a Clean Start that returns a list: abc2retag prints the
								 * elements with spaces; show it as the ABC interpreter does */
								const items=before.trim().split (/\s+/);
								lines.push (items.every (x => /^(-?\d+(\.\d+)?(e-?\d+)?|True|False|'.')$/.test (x))
									? '['+items.join (',​')+']' : before.replace (/ +$/,''));
							} else
								lines.push (v);
						} else
							lines.push (l);
					});
					sandbox.jmvm_timing.title=['totaal '+e.jmvm_done.totalMs+' ms, '+e.jmvm_done.jvbSize+' bytes bytecode (.jvb)',...stats].join ('\n');
					sandbox.jmvm_output.innerText=lines.join ('\n').replace (/^\n+/,'').replace (/\n+$/,'\n');
				} else {
					sandbox.jmvm_timing.innerText='fout ('+e.jmvm_done.totalMs+' ms)';
					const errSpan=document.createElement ('span');
					errSpan.className='err';
					errSpan.innerText=e.jmvm_done.error || 'Onbekende fout';
					sandbox.jmvm_output.innerHTML='';
					sandbox.jmvm_output.appendChild (errSpan);
				}
			}
		};
		sandbox.worker.postMessage ({init: {}});

		const stdenv=Promise.all ([packages, init_promise])
				.then (() => {
					let stdenv_versions=sandbox.packages['base-stdenv'];
					return sandbox.fetch_package ('base-stdenv',stdenv_versions[stdenv_versions.length-1]);
				});

		return Promise.all ([ui, packages, init_promise, stdenv])
				.then (() => {
					sandbox.btn_compile_run.disabled=false;
				});
	},
};

function initialize_chapters (editor,tour_hidden=false)
{
	const drafts=chapters.map (chapter => chapter.source);
	let active_chapter=null;
	const overview_buttons=[];
	const chapter_index_from_url=() => {
		const slug=new URL (window.location.href).searchParams.get ('chapter');
		const index=chapters.findIndex (chapter => chapter.slug===slug);
		return index<0 ? 0 : index;
	};
	const update_chapter_url=(index,history_method) => {
		const url=new URL (window.location.href);
		const slug=chapters[index].slug;
		const current_values=url.searchParams.getAll ('chapter');
		if (current_values.length===1 && current_values[0]===slug)
			return;
		url.searchParams.set ('chapter',slug);
		window.history[history_method] (window.history.state,'',url);
	};

	const update_chapter_view=() => {
		const chapter=chapters[active_chapter];
		sandbox.chapter_number.textContent='Chapter '+(active_chapter+1)+' of '+chapters.length;
		sandbox.chapter_title.textContent=chapter.title;
		sandbox.chapter_description.innerHTML=chapter.description;
		sandbox.chapter_previous.disabled=active_chapter===0;
		sandbox.chapter_next.disabled=active_chapter===chapters.length-1;
		overview_buttons.forEach ((button,index) => {
			button.classList.toggle ('active',index===active_chapter);
			button.setAttribute ('aria-current',index===active_chapter ? 'true' : 'false');
		});
	};

	const show_tour=() => {
		sandbox.chapter_heading.classList.remove ('d-none');
		sandbox.chapter_navigation.classList.remove ('d-none');
		editor.layout();
	};
	const hide_tour=() => {
		sandbox.chapter_heading.classList.add ('d-none');
		sandbox.chapter_navigation.classList.add ('d-none');
		editor.layout();
	};

	const open_chapter=(index,history_method=null,reveal_tour=true) => {
		if (index!==active_chapter){
			if (active_chapter!==null)
				drafts[active_chapter]=editor.getValue();
			active_chapter=index;
			editor.setValue (drafts[index]);
			if (chapters[index].lang && sandbox.lang_select && sandbox.lang_select.value!==chapters[index].lang){
				sandbox.lang_select.value=chapters[index].lang;
				sandbox.update_language();
			}
			update_chapter_view();
		}
		if (reveal_tour)
			show_tour();
		if (sandbox.chapters_modal.classList.contains ('show'))
			bootstrap.Modal.getOrCreateInstance (sandbox.chapters_modal).hide();
		editor.focus();
		if (history_method!==null)
			update_chapter_url (index,history_method);
	};

	chapters.forEach ((chapter,index) => {
		const button=document.createElement ('button');
		button.type='button';
		button.className='list-group-item list-group-item-action px-4 py-3';
		const title=document.createElement ('span');
		title.className='d-block fw-bold';
		title.textContent=(index+1)+'. '+chapter.title;
		const description=document.createElement ('span');
		description.className='d-block small text-muted mt-1';
		description.innerHTML=chapter.description;
		button.append (title,description);
		button.onclick=() => open_chapter (index,'pushState');
		sandbox.chapters_overview.appendChild (button);
		overview_buttons.push (button);
	});

	sandbox.chapter_previous.onclick=() => {
		if (active_chapter>0)
			open_chapter (active_chapter-1,'pushState');
	};
	sandbox.chapter_next.onclick=() => {
		if (active_chapter<chapters.length-1)
			open_chapter (active_chapter+1,'pushState');
	};
	sandbox.chapters_hide.onclick=() => {
		drafts[active_chapter]=editor.getValue();
		hide_tour();
		editor.focus();
	};

	window.addEventListener ('popstate',() => {
		open_chapter (chapter_index_from_url(),'replaceState',false);
	});

	open_chapter (chapter_index_from_url(),'replaceState',false);
	if (tour_hidden)
		hide_tour();
	else
		show_tour();
}

function create_monaco_editor (div,val)
{
	const monarch_definition={
		keywords: [
			'foreign', 'export', 'ccall', 'stdcall',
			'code', 'inline',
			'implementation', 'definition', 'system', 'module',
			'import', 'qualified', 'as', 'from', 'library',
			'infixl', 'infixr', 'infix',
			'if', 'otherwise',
			'let', 'in', 'case', 'of', 'with', 'where',
			'class', 'instance', 'special',
			'generic', 'derive',
			'dynamic'
		],

		// C# style strings
		escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,2}|0\d{0,2})/,

		brackets: [
			['{','}','delimiter.curly'],
			['[',']','delimiter.square'],
			['(',')','delimiter.parenthesis']
		],

		// The main tokenizer for our languages
		tokenizer: {
			root: [
				// identifiers and keywords
				[/[a-z_$][\w$]*/, {
					cases: {
						'@keywords': 'keyword',
						'@default': 'identifier'
					}
				}],
				[/[A-Z][\w\$]*/, {
					cases: {
						'Start': 'identifier',
						'@default': 'type.identifier'
					}
				}],

				// whitespace
				{ include: '@whitespace' },

				// list of characters shorthand (must be before brackets)
				[/\['/, { token: 'string.quote', bracket: '@open', next: '@charlist'} ],

				// delimiters and operators
				[/[{}()\[\]]/, '@brackets'],
				[/[;,.]/, 'delimiter'],

				// numbers
				[/\d+\.\d+([eE][\-+]?\d+)?/, 'number.float'],
				[/0[xX][0-9a-fA-F]+/, 'number.hex'],
				[/\d+/, 'number'],

				// strings
				[/"([^"\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
				[/"/,  { token: 'string.quote', bracket: '@open', next: '@string' } ],

				// characters
				[/'[^\\']'/, 'string'],
				[/(')(@escapes)(')/, ['string','string.escape','string']],
				[/'/, 'string.invalid']
			],

			comment: [
				[/[^\/*]+/, 'comment' ],
				[/\/\/.*/,  'comment'],
				[/\/\*/,    'comment', '@push'],
				["\\*/",    'comment', '@pop'],
				[/[\/*]/,   'comment' ]
			],

			string: [
				[/[^\\"]+/,  'string'],
				[/@escapes/, 'string.escape'],
				[/\\./,      'string.escape.invalid'],
				[/"/,        { token: 'string.quote', bracket: '@close', next: '@pop' } ]
			],

			charlist: [
				[/[^\\']+/,  'string'],
				[/@escapes/, 'string.escape'],
				[/\\./,      'string.escape.invalid'],
				[/']/,       { token: 'string.quote', bracket: '@close', next: '@pop' } ]
			],

			whitespace: [
				[/[ \t\r\n]+/, 'white'],
				[/\/\*/,       'comment', '@comment' ],
				[/\/\/.*$/,    'comment'],
			],
		},
	};

	const monarch_config={
		brackets: [
			['{','}'],
			['[',']'],
			['(',')']
		],
		surroundingPairs: [
			{open: '{', close: '}'},
			{open: '[', close: ']'},
			{open: '(', close: ')'},
			{open: '"', close: '"'},
			{open: "'", close: "'"},
		],
		autoClosingPairs: [
			{open: '{', close: '}'},
			{open: '[', close: ']'},
			{open: '(', close: ')'},
			{open: '"', close: '"'},
			{open: "'", close: "'"},
		]
	};

	return monaco_promise.then (() => {
		monaco.languages.register ({id: 'clean'});
		monaco.languages.setMonarchTokensProvider ('clean',monarch_definition);
		monaco.languages.setLanguageConfiguration ('clean',monarch_config);

		const editor=monaco.editor.create (div,{
			automaticLayout: true,
			detectIndentation: false,
			fontSize: 12,
			insertSpaces: false,
			language: 'clean',
			lineNumbersMinChars: 4,
			minimap: {enabled: false},
			mouseWheelZoom: true,
			renderWhitespace: 'selection',
			roundedSelection: false,
			showUnused: true,
			tabSize: 4,
			value: val
		});

		editor.addAction ({
			id: 'clean-sandbox-compile-run',
			contextMenuGroupId: '99_clean',
			label: 'Compile & run',
			run: () => {
				sandbox.btn_compile_run.click();
			}
		});

		return editor;
	});
}
