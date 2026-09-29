// host.js -- host-kant voor modules van jmvm2wat.py: de imports env.print
// (vm.cpp PRINT 0/2/4) en env.syscall (vm.cpp SysCall 0-7), los van Node,
// zodat dezelfde code in Node (run_wasm.js) en in de browser draait.
//
//   const h = makeHost(io);   // io: zie hieronder
//   const inst = new WebAssembly.Instance(mod, { env: h.env });
//   h.attach(inst); inst.exports.run(); h.finish();
//
// io = {
//   readFile(path) -> Uint8Array | null     (bestand lezen, null = bestaat niet)
//   writeFile(path, bytes) -> bool
//   readStdin() -> Uint8Array                (hele stdin, één keer opgevraagd)
//   write(str)                               (stdout, in stukken)
// }
(function (root) {
  function makeHost(io) {
    let inst = null, dv = null, u8 = null;
    const view = () => {
      if (!dv || dv.buffer !== inst.exports.mem.buffer) {
        dv = new DataView(inst.exports.mem.buffer); u8 = new Uint8Array(inst.exports.mem.buffer);
      }
    };
    const cell = a => dv.getBigInt64(a, true);
    const setcell = (a, v) => dv.setBigInt64(a, v, true);
    const ptr = v => Number(v >> 2n);
    const SL = n => BigInt(n) << 2n;
    const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };

    let out = [], outlen = 0;
    const emit = s => { out.push(s); outlen += s.length; if (outlen > 65536) flush(); };
    const flush = () => { if (out.length) io.write(out.join('')); out = []; outlen = 0; };

    // C-string (tot de eerste NUL, zoals vm.cpp) uit een STR-object
    function cstr(v) {
      const d = ptr(v) + 16;
      let e = d; while (u8[e] !== 0) e++;
      return u8.slice(d, e);
    }
    // vm.cpp createString: nieuw STR-object; kan GC doen (sp staat al in de global)
    function mkstring(bytes) {
      const r = inst.exports.palloc(1, bytes.length);
      view();
      u8.set(bytes, r + 16);
      return (BigInt(r) << 2n) | 1n;
    }

    let stdin = null, stdinPos = 0;
    function readLine() {
      if (stdin === null) stdin = io.readStdin() || new Uint8Array(0);
      if (stdinPos >= stdin.length) return new Uint8Array(0);
      let e = stdin.indexOf(10, stdinPos);
      if (e < 0) e = stdin.length;
      let line = stdin.subarray(stdinPos, e);
      stdinPos = e + 1;
      while (line.length && (line[line.length - 1] === 10 || line[line.length - 1] === 13)) line = line.subarray(0, line.length - 1);
      return line.subarray(0, 4095);
    }

    // open_file & co: in het geheugen gebufferd, bij close_file/finish weggeschreven
    const files = new Array(32).fill(null);   // {path, mode, rbuf, rpos, wbuf}
    const fileFlush = f => {
      if (f.mode !== 'r' && f.wbuf) {
        const prev = f.mode === 'a' ? (io.readFile(f.path) || new Uint8Array(0)) : new Uint8Array(0);
        const all = new Uint8Array(prev.length + f.wbuf.length);
        all.set(prev); all.set(f.wbuf, prev.length);
        io.writeFile(f.path, all); f.mode = 'a'; f.wbuf = [];
      }
    };

    const env = {
      print(mode, v) {
        const tag = Number(v & 3n);
        const s = tag === 0 ? String(v >> 2n) : tag === 2 ? '<float>' : '<ptr>';
        if (mode === 4) emit('res: ' + s + '\n');
        else if (mode === 2) emit(String.fromCharCode(Number(((v >> 2n) % 256n + 256n) % 256n)));
        else emit(s + ' ');
      },
      syscall(id, sp) {
        view();
        switch (id) {
          case 0: {                                  // read_file
            let data = io.readFile(latin1(cstr(cell(sp)))) || new Uint8Array(0);
            const nul = data.indexOf(0); if (nul >= 0) data = data.subarray(0, nul);
            setcell(sp, mkstring(data)); return sp;
          }
          case 1: {                                  // write_file
            const ok = io.writeFile(latin1(cstr(cell(sp))), cstr(cell(sp - 8))) ? 1 : 0;
            sp -= 8; setcell(sp, SL(ok)); return sp;
          }
          case 2: {                                  // read_line
            const line = readLine();
            sp += 8; setcell(sp, 0n);
            setcell(sp, mkstring(line)); return sp;
          }
          case 3:                                    // print_string
            emit(latin1(cstr(cell(sp)))); setcell(sp, 0n); return sp;
          case 4: {                                  // open_file
            const path = latin1(cstr(cell(sp))), mode = latin1(cstr(cell(sp - 8))).replace('b', '')[0];
            let fd = -1;
            const i = files.indexOf(null);
            if (i >= 0) {
              if (mode === 'r') { const d = io.readFile(path); if (d) { files[i] = { path, mode, rbuf: d, rpos: 0 }; fd = i; } }
              else if (mode === 'w' || mode === 'a') { files[i] = { path, mode, wbuf: [] }; fd = i; if (mode === 'w') io.writeFile(path, new Uint8Array(0)); files[i].mode = 'a'; }
            }
            sp -= 8; setcell(sp, SL(fd)); return sp;
          }
          case 5: {                                  // close_file
            const fd = Number(cell(sp) >> 2n); let ok = 0;
            if (fd >= 0 && fd < 32 && files[fd]) { fileFlush(files[fd]); files[fd] = null; ok = 1; }
            setcell(sp, SL(ok)); return sp;
          }
          case 6: {                                  // read_char
            const fd = Number(cell(sp) >> 2n); let r = -1;
            const f = fd >= 0 && fd < 32 ? files[fd] : null;
            if (f && f.rbuf && f.rpos < f.rbuf.length) r = f.rbuf[f.rpos++];
            setcell(sp, SL(r)); return sp;
          }
          case 7: {                                  // write_char
            const fd = Number(cell(sp) >> 2n), ch = Number(cell(sp - 8) >> 2n); let ok = 0;
            const f = fd >= 0 && fd < 32 ? files[fd] : null;
            if (f && f.wbuf) { f.wbuf.push(ch & 255); ok = 1; }
            sp -= 8; setcell(sp, SL(ok)); return sp;
          }
          default:
            emit('unknown syscall id ' + id + '\n'); return sp;
        }
      },
    };
    return {
      env,
      attach(i) { inst = i; dv = null; view(); },
      finish() { for (const f of files) if (f) fileFlush(f); flush(); },
    };
  }
  if (typeof module !== 'undefined') module.exports = { makeHost };
  else root.makeHost = makeHost;
})(typeof globalThis !== 'undefined' ? globalThis : this);
