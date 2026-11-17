module sandbox

import StdEnv

import Data.Func
import Data.Maybe
import System._Unsafe
import qualified Text
from Text import class Text, instance Text String
import Text.HTML

import ABC.Interpreter.JavaScript

import make

Start = wrapInitFunction start

sandbox :== jsGlobal "sandbox"
c_compiler :== jsGlobal "c_compiler"
clean_compiler :== jsGlobal "clean_compiler"
c_bcgen :== jsGlobal "c_bcgen"
c_bclink :== jsGlobal "c_bclink"
c_bcprelink :== jsGlobal "c_bcprelink"

start :: !JSVal !*JSWorld -> *JSWorld
start me w
	# (cb,w) = jsWrapFun (compile me) me w
	# w = (sandbox .# "compile" .= cb) w
	= w
where
	compile me {[0]=paths,[1]=main,[2]=callback} w
		# (paths,w) = jsValToList` paths (fromJS "") w
		# main = fromJS "" main
		= make
			fmtime fread_abc_deps
			sync
			do_compile
			(call_main c_bcgen) (call_main c_bclink) (call_main c_bcprelink)
			feedback finish
			paths main
			w
	where
		fmtime mod path w
			# (mtime,w) = (to_backend mod .# "FS" .# "fmtime" .$? path) (0, w)
			# mtime = if (mtime==0) ?None (?Just mtime)
			= (mtime, w)

		fread_abc_deps mod path w
			# (deps,w) = (jsGlobal "read_abc_dependencies" .$ path) w
			= jsValToList deps jsValToString w

		sync mod dir after w
			# (cb,w) = jsWrapFun (\_ w -> after w) me w
			= (to_backend mod .# "FS" .# "syncfs" .$! (dir=:Retrieve, cb)) w

		to_backend Compiler  = c_compiler
		to_backend BCGen     = c_bcgen
		to_backend BCLink    = c_bclink
		to_backend BCPrelink = c_bcprelink

		do_compile args w
			# (_,args,argv,w) = copy_argv args c_compiler w
			# (res_or_err,w) = (clean_compiler .# "compile" .$ ()) w
			# w = free_args_and_argv args argv c_compiler w
			# res = jsValToInt res_or_err
			| isJust res
				= (fromJust res==0, w)
				# (err,w) = (res_or_err .# "toString" .$? ()) ("Compiler crashed.", w)
				= (False, feedback False err w)

		call_main backend args w
			# (argc,args,argv,w) = copy_argv args backend w
			# (res,w) = (backend .# "clean_call_main" .$? (argc, argv)) (-1, w)
			= (res == 0, free_args_and_argv args argv backend w)

		feedback ok s w
			= (sandbox .# if ok "stdout" "stderr" .$! (s +++ "\n")) w

		finish path w
			= (callback .$! isJust path) w

copy_argv :: ![String] !JSVal !*JSWorld -> *(!Int, !Int, !Int, !*JSWorld)
copy_argv args backend w
	# argc = length args
	# args_s = flatten [[toInt c \\ c <-: a] ++ [0] \\ a <- args]
	# sz = sum [size a \\ a <- args] + argc
	# (args_ptr,w) = (backend .# "_malloc" .$ sz) w
	# args_ptr = fromJust (jsValToInt args_ptr)
	# w = (backend .# "HEAPU8" .# "set" .$! (args_s, args_ptr)) w
	# (argv,_) = mapSt (\a p -> (p, p+size a+1)) args args_ptr
	# (argv_ptr,w) = (backend .# "_malloc" .$ (4*argc)) w
	# argv_ptr = fromJust (jsValToInt argv_ptr)
	# w = (backend .# "HEAPU32" .# "set" .$! (argv, argv_ptr>>2)) w
	# w = (backend .# "clean_argc" .= argc) w
	# w = (backend .# "clean_argv" .= argv_ptr) w
	= (argc, args_ptr, argv_ptr, w)

free_args_and_argv :: !Int !Int !JSVal !*JSWorld -> *JSWorld
free_args_and_argv args argv backend w
	# w = (backend .# "_free" .$! args) w
	# w = (backend .# "_free" .$! argv) w
	= w
