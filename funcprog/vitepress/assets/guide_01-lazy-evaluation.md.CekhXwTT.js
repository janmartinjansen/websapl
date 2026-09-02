import{_ as l,C as r,o as c,c as s,a3 as o,E as i,j as e,a as t}from"./chunks/framework.ByIHJIQ1.js";const y=JSON.parse('{"title":"1. Strict vs. Lazy Evaluation","description":"","frontmatter":{},"headers":[],"relativePath":"guide/01-lazy-evaluation.md","filePath":"guide/01-lazy-evaluation.md"}'),u={name:"guide/01-lazy-evaluation.md"};function d(p,a,h,f,m,_){const n=r("SaplPlayground");return c(),s("div",null,[a[0]||(a[0]=o('<h1 id="_1-strict-vs-lazy-evaluation" tabindex="-1">1. Strict vs. Lazy Evaluation <a class="header-anchor" href="#_1-strict-vs-lazy-evaluation" aria-label="Permalink to &quot;1. Strict vs. Lazy Evaluation&quot;">​</a></h1><blockquote><p><strong>Paper Reference</strong>: Section 3 &amp; Figures 2, 4, 6 &amp; 7 in the IFL paper (<em>&quot;A Portable VM-based implementation Platform for non-strict Functional Programming Languages&quot;</em>).</p></blockquote><p>In functional programming, the evaluation strategy dictates <strong>when</strong> function arguments are evaluated:</p><ol><li><strong>Strict (Call-by-Value)</strong>: Arguments are evaluated to a value <em>before</em> entering the function body.</li><li><strong>Non-Strict / Lazy (Call-by-Need)</strong>: Arguments are passed unevaluated as a <strong>Thunk</strong> (a graph suspension) and evaluated only when their actual value is required by a strict primitive or pattern match.</li></ol><hr><h2 id="strict-factorial-fac" tabindex="-1">Strict Factorial (<code>fac</code>) <a class="header-anchor" href="#strict-factorial-fac" aria-label="Permalink to &quot;Strict Factorial (`fac`)&quot;">​</a></h2><p>In strict Sapl, the exclamation mark (<code>!n</code>) specifies that the argument <code>n</code> is evaluated eagerly upon function invocation.</p><p>Try editing and running the code below:</p>',8)),i(n,{title:"Strict Factorial Example (01_fac.cfp)",lang:"Sapl",initialCode:`fac !n = case n of 0 -> 1; _ -> n * fac (n - 1)

main = fac 10`,expectedResult:"3628800"}),a[1]||(a[1]=o('<h3 id="bytecode-insight" tabindex="-1">Bytecode Insight <a class="header-anchor" href="#bytecode-insight" aria-label="Permalink to &quot;Bytecode Insight&quot;">​</a></h3><p>Notice how the strict compiler does not allocate any heap thunks for recursive calls because <code>n</code> is already evaluated on the stack.</p><hr><h2 id="lazy-factorial-with-thunk-suspension-facl" tabindex="-1">Lazy Factorial with Thunk Suspension (<code>facl</code>) <a class="header-anchor" href="#lazy-factorial-with-thunk-suspension-facl" aria-label="Permalink to &quot;Lazy Factorial with Thunk Suspension (`facl`)&quot;">​</a></h2><p>When <code>facl</code> is written lazily without strictness annotations, the recursive multiplication <code>n * facl (n - 1)</code> must be suspended into a closure (thunk):</p>',5)),i(n,{title:"Lazy Factorial with Lambda Lifting (02_facl.cfp)",lang:"Sapl",initialCode:`facl n = case n of 0 -> 1; _ -> n * facl (n - 1)

main = facl 10`,initialBytecode:`// Lambda-lifted helper: facl_1 (a * b)
facl_1:
    PUSH 0
    EVAL
    PUSH 1
    EVAL
    MUL
    RET

facl:
    EVAL
    CASE 0 -> L_zero, _ -> L_rec
L_zero:
    PUSH_INT 1
    RET
L_rec:
    ALLOC facl_1, 2
    RET

main:
    ALLOC facl, 10
    EVAL
    PRINT
    HALT`,expectedResult:"3628800"}),a[2]||(a[2]=e("div",{class:"note custom-block github-alert"},[e("p",{class:"custom-block-title"},"NOTE"),e("p",null,[t("Observe the "),e("strong",null,"Heap Nodes Created"),t(" metric above. In lazy mode, each iteration allocates a heap suspension node ("),e("code",null,"ALLOC facl_1, 2"),t(").")])],-1))])}const v=l(u,[["render",d]]);export{y as __pageData,v as default};
