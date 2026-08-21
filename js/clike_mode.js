/**
 * CodeMirror 5 Syntax Mode for C and C++ (.c, .cpp, .cc, .cxx, .h, .hpp, .hh, .hxx)
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

  function words(str) {
    var obj = {}, list = str.split(" ");
    for (var i = 0; i < list.length; ++i) {
      if (list[i]) obj[list[i]] = true;
    }
    return obj;
  }

  var cKeywords = words(
    "auto break case catch class const constexpr consteval constinit continue " +
    "decltype default delete do else enum explicit export extern final for " +
    "friend goto if inline mutable namespace new noexcept operator override " +
    "private protected public register reinterpret_cast return sizeof static " +
    "static_assert static_cast struct switch template this thread_local throw " +
    "try typedef typeid typename union using virtual volatile while " +
    "concept requires co_await co_yield co_return alignas alignof " +
    "dynamic_cast const_cast"
  );

  var cTypes = words(
    "int long short char void float double signed unsigned bool " +
    "size_t ssize_t ptrdiff_t intptr_t uintptr_t intmax_t uintmax_t " +
    "int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t " +
    "int_least8_t int_least16_t int_least32_t int_least64_t " +
    "uint_least8_t uint_least16_t uint_least32_t uint_least64_t " +
    "int_fast8_t int_fast16_t int_fast32_t int_fast64_t " +
    "uint_fast8_t uint_fast16_t uint_fast32_t uint_fast64_t " +
    "FILE time_t clock_t off_t pid_t va_list " +
    "string wstring u8string u16string u32string string_view " +
    "vector map set unordered_map unordered_set deque list forward_list " +
    "stack queue priority_queue array tuple pair " +
    "unique_ptr shared_ptr weak_ptr auto_ptr " +
    "function optional variant any span " +
    "char8_t char16_t char32_t wchar_t"
  );

  var cBuiltins = words(
    "true false NULL nullptr stdout stdin stderr EOF " +
    "cout cin cerr clog endl " +
    "printf fprintf sprintf snprintf scanf fscanf sscanf " +
    "malloc calloc realloc free memcpy memmove memset memcmp " +
    "strlen strcpy strncpy strcat strncat strcmp strncmp strchr strstr strtok " +
    "exit abort assert std"
  );

  CodeMirror.defineMode("clike", function() {
    return {
      startState: function() {
        return {
          inComment: false,
          inString: false,
          stringQuote: null,
          inPreprocessor: false
        };
      },

      token: function(stream, state) {
        // Whitespace
        if (stream.eatSpace()) return null;

        // Inside multiline comment /* ... */
        if (state.inComment) {
          while (!stream.eol()) {
            if (stream.match("*/")) {
              state.inComment = false;
              break;
            }
            stream.next();
          }
          return "comment";
        }

        // Inside multiline string
        if (state.inString) {
          var quote = state.stringQuote;
          var escaped = false;
          while (!stream.eol()) {
            var ch = stream.next();
            if (ch === quote && !escaped) {
              state.inString = false;
              state.stringQuote = null;
              break;
            }
            escaped = !escaped && ch === "\\";
          }
          return "string";
        }

        // Multiline comment start /*
        if (stream.match("/*")) {
          state.inComment = true;
          while (!stream.eol()) {
            if (stream.match("*/")) {
              state.inComment = false;
              break;
            }
            stream.next();
          }
          return "comment";
        }

        // Single line comment //
        if (stream.match("//")) {
          stream.skipToEnd();
          return "comment";
        }

        // Preprocessor directive #...
        if (stream.sol()) {
          stream.eatSpace();
          if (stream.peek() === "#") {
            stream.next();
            stream.eatSpace();
            stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
            return "meta";
          }
        }

        // Strings "..." or '...'
        var ch = stream.peek();
        if (ch === '"' || ch === "'") {
          var quote = stream.next();
          var escaped = false;
          while (!stream.eol()) {
            var nextCh = stream.next();
            if (nextCh === quote && !escaped) {
              return quote === "'" ? "string-2" : "string";
            }
            escaped = !escaped && nextCh === "\\";
          }
          state.inString = true;
          state.stringQuote = quote;
          return quote === "'" ? "string-2" : "string";
        }

        // Numbers (Hex, Binary, Float, Decimal with suffixes)
        if (stream.match(/^0x[0-9a-fA-F]+('?[0-9a-fA-F]+)*([uU]?[lL]{0,2}|[lL]{1,2}[uU]?|f|F)?/) ||
            stream.match(/^0b[01]+('?[01]+)*([uU]?[lL]{0,2}|[lL]{1,2}[uU]?)?/) ||
            stream.match(/^[0-9]+('?[0-9]+)*\.[0-9]+('?[0-9]+)*([eE][+-]?[0-9]+)?([fFlL])?/) ||
            stream.match(/^[0-9]+('?[0-9]+)*([eE][+-]?[0-9]+)([fFlL])?/) ||
            stream.match(/^[0-9]+('?[0-9]+)*([uU]?[lL]{0,2}|[lL]{1,2}[uU]?|f|F)?/)) {
          return "number";
        }

        // Operators & Punctuation
        if (stream.match(/^::/) || stream.match(/^->/) || stream.match(/^<<=/) || stream.match(/^>>=/) ||
            stream.match(/^<=/) || stream.match(/^>=/) || stream.match(/^==/) || stream.match(/^!=/) ||
            stream.match(/^&&/) || stream.match(/^\|\|/) || stream.match(/^\+\+/) || stream.match(/^--/) ||
            stream.match(/^<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=/) ||
            stream.match(/^[=+\-*\/%<>!&|^~?:]/)) {
          return "operator";
        }

        // Brackets & Parentheses
        if (/[\[\]{}()]/.test(ch)) {
          stream.next();
          return "bracket";
        }

        // Identifiers (Keywords, Types, Builtins, Functions, Variables)
        if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
          var word = stream.current();

          if (cKeywords[word]) return "keyword";
          if (cTypes[word]) return "variable-2";
          if (cBuiltins[word]) return "builtin";

          // Common convention: types ending in _t or starting with Capital letter
          if (word.endsWith("_t") || /^[A-Z][a-zA-Z0-9_]*$/.test(word)) {
            return "variable-2";
          }

          // Function call check (followed by '(')
          if (stream.peek() === "(") {
            return "def";
          }

          return "variable";
        }

        // Fallthrough
        stream.next();
        return null;
      },

      lineComment: "//",
      blockCommentStart: "/*",
      blockCommentEnd: "*/"
    };
  });

  CodeMirror.defineMIME("text/x-csrc", "clike");
  CodeMirror.defineMIME("text/x-c++src", "clike");
  CodeMirror.defineMIME("text/x-chdr", "clike");
  CodeMirror.defineMIME("text/x-c++hdr", "clike");
  CodeMirror.defineMIME("text/x-c", "clike");
  CodeMirror.defineMIME("text/x-c++", "clike");
});
