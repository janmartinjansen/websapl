/**
 * CodeMirror 5 Syntax Mode for the Sapl Functional Language & JMVM Bytecode
 */

(function(mod) {
  if (typeof exports === "object" && typeof module === "object") {
    mod(require("codemirror"));
  } else if (typeof define === "function" && define.amd) {
    define(["codemirror"], mod);
  } else {
    mod(CodeMirror);
  }
})(function(CodeMirror) {
  "use strict";

  CodeMirror.defineMode("sapl", function() {
    const keywords = {
      "case": true, "of": true, "let": true, "in": true, "where": true,
      "nomatch": true, "if": true, "then": true, "else": true, "type": true,
      "seq": true, "readFile": true, "writeFile": true, "openFile": true,
      "closeFile": true, "readChar": true, "writeChar": true, "readLine": true,
      "printString": true
    };

    const builtins = {
      "True": true, "False": true, "Nil": true, "Cons": true
    };

    return {
      startState: function() {
        return { inString: false, inComment: false };
      },

      token: function(stream, state) {
        // Handle whitespace
        if (stream.eatSpace()) return null;

        const ch = stream.peek();

        // 1. Comments: || to end of line
        if (stream.match("||")) {
          stream.skipToEnd();
          return "comment";
        }

        // 2. Preprocessor: #import "..."
        if (stream.sol() && stream.match(/^#import\b/)) {
          return "def";
        }

        // 3. String literals: "..."
        if (ch === '"') {
          stream.next();
          while (!stream.eol()) {
            const nextCh = stream.next();
            if (nextCh === '"' && stream.string.charAt(stream.pos - 2) !== '\\') {
              break;
            }
          }
          return "string";
        }

        // 4. Character literals: 'c'
        if (ch === "'") {
          stream.next();
          while (!stream.eol()) {
            const nextCh = stream.next();
            if (nextCh === "'" && stream.string.charAt(stream.pos - 2) !== '\\') {
              break;
            }
          }
          return "string-2";
        }

        // 5. Strictness annotation: !ident or !
        if (ch === "!") {
          stream.next();
          if (stream.match(/^[a-zA-Z0-9_]+/)) {
            return "variable-3"; // Highlighted as strict variable
          }
          return "operator";
        }

        // 6. Numbers (integers and floats)
        if (stream.match(/^[0-9]+(\.[0-9]+)?/)) {
          return "number";
        }

        // 7. Operators & Type definition symbols
        if (stream.match(/^::/) || stream.match(/^->/) || stream.match(/^[=+\-*\/%<>|!&]+/)) {
          return "operator";
        }

        // 8. Brackets
        if (/[\[\]{}()]/.test(ch)) {
          stream.next();
          return "bracket";
        }

        // 9. Identifiers (functions, constructors, keywords)
        if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
          const word = stream.current();
          if (keywords[word]) return "keyword";
          if (builtins[word]) return "atom";
          if (/^[A-Z]/.test(word)) return "variable-2"; // Constructor / Type name
          if (stream.sol()) return "def"; // Top-level function definition
          return "variable";
        }

        stream.next();
        return null;
      },

      lineComment: "||"
    };
  });

  CodeMirror.defineMIME("text/x-sapl", "sapl");
});
