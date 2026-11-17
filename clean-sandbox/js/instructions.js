/* All these functions must be bound to the emscripten module, for instance:
 * i_ccall.bind(Module)
 */

"use strict";

function i_ccall (abc,pc,asp,bsp)
{
	const fun='_'+abc.get_clean_string (abc.memory_array[pc/4+2]-8);
	var type=abc.get_clean_string (abc.memory_array[pc/4+4]-8);

	if (!(fun in this))
		throw 'ccall: unknown function '+fun;

	if (type.indexOf (':')>=0)
		type=type.split (':');
	else if (type.indexOf ('-')>=0)
		type=type.split ('-');
	else
		throw 'ccall: illegal type '+type;

	if (type.length<2 || type.length>3)
		throw 'ccall: illegal type '+type;

	const argtypes=type[0];
	var rettypes=type[1];

	const args=[];
	const to_free=[];
	const strings_to_copy=[];
	for (let t of argtypes){
		switch (t){
			case 'I':
			case 'p':
				args.push (abc.memory_array[bsp/4]);
				bsp+=8;
				break;
			case 'S':
				/* Clean strings use 8 bytes for the length, but Emscripten has a
				 * 32-bit size_t, so we must use only 4 bytes when sending a string
				 * to C. */
				const hp_ptr=abc.memory_array[asp/4];
				const size=abc.memory_array[hp_ptr/4+2];
				const string_buffer=new Uint8Array (abc.memory.buffer,hp_ptr+12,size+4);
				const size_buffer=new Uint8Array (abc.memory.buffer,hp_ptr+8,4);
				const c_ptr=this._malloc (string_buffer.length+3);
				this.HEAPU8.set (string_buffer,c_ptr)
				this.HEAPU8.set (size_buffer,c_ptr)
				args.push (c_ptr);
				to_free.push (c_ptr);
				if (this[fun].sync_strings_back_to_clean)
					strings_to_copy.push ([c_ptr,hp_ptr]);
				asp-=8;
				break;
			case 'G':
			case 'P':
				break;
			default:
				throw 'ccall: unimplemented argument type '+t;
		}
	}

	if (rettypes[0]=='V')
		rettypes=rettypes.slice (1);

	const ret_ptrs=[];
	if (rettypes.length>1){
		for (var i=0; i<rettypes.length; i++){
			switch (rettypes[i]){
				case 'I':
				case 'p':
				case 'S':
					const c_ptr=this._malloc (4);
					args.push (c_ptr);
					to_free.push (c_ptr);
					ret_ptrs.unshift (c_ptr);
					break;
				default:
					throw 'ccall: unimplemented result type '+rettypes[i];
			}
		}
	}

	const res=this[fun].apply (null,args);

	// TODO: this is not correct, but what should it be?
	// ArgEnv functions assume the order without reversal, but getCommonFileInfoC
	// assumes the order with reversal!
	if (rettypes.length > 2)
		rettypes=rettypes.split ('').reverse().join ('');

	// Copy argument strings from C back to Clean, because C may have modified
	// them. This is not something we want to support, but ArgEnv uses it...
	for (let cp of strings_to_copy){
		var c_ptr=cp[0]/4;
		var hp_ptr=cp[1]/4;
		const size=this.HEAP32[c_ptr];

		abc.memory_array[hp_ptr+2]=size;
		abc.memory_array[hp_ptr+3]=0;

		c_ptr++;
		hp_ptr+=4;
		for (var i=0; i<size; i+=4)
			abc.memory_array[hp_ptr++]=this.HEAP32[c_ptr++];
	}

	const results=[];
	if (rettypes.length==1){
		results.push (res);
	} else {
		for (var i=0; i<rettypes.length; i++){
			results.push (this.HEAP32[ret_ptrs[i]/4]);
		}
	}

	for (var i=0; i<results.length; i++){
		switch (rettypes[i]){
			case 'I':
			case 'p':
				bsp-=8;
				abc.memory_array[bsp/4]=results[i];
				abc.memory_array[bsp/4+1]=results[i]<0 ? 0xffffffff : 0;
				break;
			case 'S':
				var c_ptr=results[i]/4;
				const size=this.HEAP32[c_ptr];
				const nwords=2+((size+7)>>3);
				abc.require_hp (nwords);
				var hp=abc.interpreter.instance.exports.get_hp();
				var hp_free=abc.interpreter.instance.exports.get_hp_free();
				asp+=8;
				abc.memory_array[asp/4]=hp;
				abc.memory_array[asp/4+1]=0;
				abc.memory_array[hp/4]=5*8+2; // _STRING_
				abc.memory_array[hp/4+1]=0;
				abc.memory_array[hp/4+2]=size;
				abc.memory_array[hp/4+3]=0;
				hp+=16;
				c_ptr++;
				for (var j=0; j<size; j+=8){
					abc.memory_array[hp/4]=this.HEAPU32[c_ptr++];
					abc.memory_array[hp/4+1]=this.HEAPU32[c_ptr++];
					hp+=8;
				}
				hp_free-=nwords;
				// need to update asp here already in case a next S copy triggers gc
				abc.interpreter.instance.exports.set_asp (asp);
				abc.interpreter.instance.exports.set_hp (hp);
				abc.interpreter.instance.exports.set_hp_free (hp_free);
				break;
			default:
				throw 'ccall: unimplemented result type '+rettypes;
		}
	}

	for (let p of to_free)
		this._free (p);

	abc.interpreter.instance.exports.set_asp (asp);
	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+24;
}

function i_closeF (abc,pc,asp,bsp)
{
	bsp+=8;
	const i=abc.memory_array[bsp/4];

	if (i==0){
		if (!abc.stdio_open)
			throw 'fclose: file not open (stdio)';
		abc.stdio_open=false;
		abc.memory_array[bsp/4]=1;
		abc.memory_array[bsp/4+1]=0;
	} else if (i==1){
		abc.memory_array[bsp/4]=1;
		abc.memory_array[bsp/4+1]=0;
	} else {
		try {
			this.FS.close (abc.files[i].stream);
			abc.memory_array[bsp/4]=1;
			abc.memory_array[bsp/4+1]=0;
		} catch (e) {
			console.debug (`closeF ${i}:`,e);
			abc.memory_array[bsp/4]=0;
			abc.memory_array[bsp/4+1]=0;
		}
	}

	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_endF (abc,pc,asp,bsp)
{
	const i=abc.memory_array[bsp/4+2];
	bsp-=8;
	abc.memory_array[bsp/4]=0;
	abc.memory_array[bsp/4+1]=0;

	if (i<2){
		throw 'FEnd: not allowed for StdIO and StdErr';
	} else {
		try {
			// TODO: is there no other way to do this?
			const b=new Uint8Array (1);
			const end=this.FS.read (abc.files[i].stream,b,0,1)==0;
			if (!end)
				this.FS.llseek (abc.files[i].stream,-1,1); // -1, SEEK_CUR
			abc.memory_array[bsp/4]=end;
		} catch (e) {
			console.debug ('endF:',e);
		}
	}

	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_openF (abc,pc,asp,bsp)
{
	const FILE_MODES=['r','w','a','rb','wb','ab'];

	const path=abc.get_clean_string (abc.memory_array[asp/4]);
	asp-=8;
	var mode=abc.memory_array[bsp/4];

	if (mode<0 || mode>5)
		throw 'openF: illegal mode';
	mode=FILE_MODES[mode];

	bsp-=16;
	abc.memory_array[bsp/4+2]=0;
	abc.memory_array[bsp/4+3]=0;

	try {
		const stream=this.FS.open (path,mode[0]);

		const file={
			stream: this.FS.open (path,mode[0]),
			mode: mode,
			error: false
		};

		const i=abc.files.push (file)-1;

		console.debug ('open',path);

		abc.memory_array[bsp/4]=1;
		abc.memory_array[bsp/4+1]=0;
		abc.memory_array[bsp/4+4]=i;
		abc.memory_array[bsp/4+5]=0;
	} catch (e) {
		abc.memory_array[bsp/4]=0;
		abc.memory_array[bsp/4+1]=0;
	}

	abc.interpreter.instance.exports.set_asp (asp);
	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_readLineF (abc,pc,asp,bsp)
{
	const MAX_LENGTH=1000; // TODO
	const i=abc.memory_array[bsp/4+2];

	asp+=8;

	if (i==0){
		throw 'readLineF not implemented for stdio'; // TODO
	} else if (i==1){
		throw 'freadline: can\'t read from stderr';
	} else {
		try {
			// TODO this implementation is quite inefficient
			var s=[];
			const buffer=new Uint8Array (1);
			const f=abc.files[i].stream;
			while (s.length<MAX_LENGTH){
				if (!this.FS.read (f,buffer,0,1))
					break;
				s.push (buffer[0]);
				if (buffer[0]==10) /* newline */
					break;
			}

			const nwords=2+((s.length+7)>>3);
			abc.require_hp (nwords);

			var hp=abc.interpreter.instance.exports.get_hp();
			var hp_free=abc.interpreter.instance.exports.get_hp_free();

			abc.memory_array[asp/4]=hp;
			abc.memory_array[asp/4+1]=0;
			abc.memory_array[hp/4]=5*8+2; // _STRING_
			abc.memory_array[hp/4+1]=0;
			abc.memory_array[hp/4+2]=s.length;
			abc.memory_array[hp/4+3]=0;

			const s_in_memory=new Uint8Array (abc.memory_array.buffer,hp+16);
			s_in_memory.set (s);

			hp+=nwords<<3;
			hp_free-=nwords;
			abc.interpreter.instance.exports.set_hp (hp);
			abc.interpreter.instance.exports.set_hp_free (hp_free);
		} catch (e) {
			console.debug ('readLineF:',i,e);
		}
	}

	abc.interpreter.instance.exports.set_asp (asp);

	return pc+8;
}

function i_stderrF (abc,pc,asp,bsp)
{
	bsp-=16;
	abc.memory_array[bsp/4+0]=0xffffffff;
	abc.memory_array[bsp/4+1]=0xffffffff;
	abc.memory_array[bsp/4+2]=1;
	abc.memory_array[bsp/4+3]=0;

	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_stdioF (abc,pc,asp,bsp)
{
	if (abc.stdio_open)
		throw 'stdio: already open';

	abc.stdio_open=true;

	bsp-=16;
	abc.memory_array[bsp/4]=0xffffffff;
	abc.memory_array[bsp/4+1]=0xffffffff;
	abc.memory_array[bsp/4+2]=0;
	abc.memory_array[bsp/4+3]=0;

	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_writeFC (abc,pc,asp,bsp)
{
	const c=abc.memory_array[bsp/4];
	bsp+=8;
	const i=abc.memory_array[bsp/4+2];

	if (i==0){
		this.clean_stdout (String.fromCharCode (c%256));
	} else if (i==1){
		this.clean_stderr (String.fromCharCode (c%256));
	} else {
		try {
			const c_arr=new Uint8Array ([c]);
			this.FS.write (abc.files[i].stream,c_arr,0,1);
		} catch (e) {
			console.debug ('writeFC:',e);
		}
	}

	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_writeFI (abc,pc,asp,bsp)
{
	const n=abc.memory_array[bsp/4];
	bsp+=8;
	const i=abc.memory_array[bsp/4+2];

	if (i==0){
		this.clean_stdout (n);
	} else if (i==1){
		this.clean_stderr (n);
	} else {
		try {
			const f=abc.clean_files[i];
			if (f.mode.length==1){ // text mode
				const s=(new TextEncoder()).encode (n);
				this.FS.write (f.stream,s,0,s.length);
			} else { // data mode
				const s=new Uint8Array (new Uint32Array ([n]).buffer);
				this.FS.write (f.stream,s,0,s.length);
			}
		} catch (e) {
			console.debug ('writeFI:',e);
		}
	}

	abc.interpreter.instance.exports.set_bsp (bsp);

	return pc+8;
}

function i_writeFS (abc,pc,asp,bsp)
{
	const i=abc.memory_array[bsp/4+2];

	const s_ptr=abc.memory_array[asp/4];
	const size=abc.memory_array[s_ptr/4+2];
	const s=new Uint8Array (abc.memory_array.buffer,s_ptr+16,size);

	if (i==0){
		this.clean_stdout ((new TextDecoder ('utf-8')).decode (s));
	} else if (i==1){
		this.clean_stderr ((new TextDecoder ('utf-8')).decode (s));
	} else {
		try {
			this.FS.write (abc.files[i].stream,s,0,size);
		} catch (e) {
			console.debug ('writeFS:',e);
		}
	}

	asp-=8;

	abc.interpreter.instance.exports.set_asp (asp);

	return pc+8;
}
