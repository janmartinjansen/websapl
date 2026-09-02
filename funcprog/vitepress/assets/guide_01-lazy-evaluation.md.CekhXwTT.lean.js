import{_ as l,C as r,o as c,c as s,a3 as o,E as i,j as e,a as t}from"./chunks/framework.ByIHJIQ1.js";const y=JSON.parse('{"title":"1. Strict vs. Lazy Evaluation","description":"","frontmatter":{},"headers":[],"relativePath":"guide/01-lazy-evaluation.md","filePath":"guide/01-lazy-evaluation.md"}'),u={name:"guide/01-lazy-evaluation.md"};function d(p,a,h,f,m,_){const n=r("SaplPlayground");return c(),s("div",null,[a[0]||(a[0]=o("",8)),i(n,{title:"Strict Factorial Example (01_fac.cfp)",lang:"Sapl",initialCode:`fac !n = case n of 0 -> 1; _ -> n * fac (n - 1)

main = fac 10`,expectedResult:"3628800"}),a[1]||(a[1]=o("",5)),i(n,{title:"Lazy Factorial with Lambda Lifting (02_facl.cfp)",lang:"Sapl",initialCode:`facl n = case n of 0 -> 1; _ -> n * facl (n - 1)

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
