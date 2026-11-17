implementation module make

import StdEnv

import qualified Data.Map
import Data.Maybe
import qualified Data.Set
import System._Unsafe
import Text

:: Module =
	{ abc :: !String
	, bc  :: !String
	}

:: CompileState env =
	{ fmtime    :: !FileSystemModule String env -> (?Int, env)
	, fabc_deps :: !FileSystemModule String env -> (?[String], env)
	, sync      :: !FileSystemModule SyncDirection (env -> env) env -> env
	, compile   :: ![String] env -> (Bool, env)
	, bcgen     :: ![String] env -> (Bool, env)
	, bclink    :: ![String] env -> (Bool, env)
	, bcprelink :: ![String] env -> (Bool, env)
	, feedback  :: !Bool String env -> env
	, finish    :: !(?String) env -> env
	, paths     :: ![String]
	, paths_s   :: !String
	, main      :: !String
	, modules   :: !'Data.Map'.Map String Module
	}

make ::
	!(FileSystemModule String .env -> (?Int, .env))
	!(FileSystemModule String .env -> (?[String], .env))
	!(FileSystemModule SyncDirection (.env -> .env) .env -> .env)
	!([String] .env -> (Bool, .env))
	!([String] .env -> (Bool, .env))
	!([String] .env -> (Bool, .env))
	!([String] .env -> (Bool, .env))
	!(Bool String .env -> .env)
	!((?String) .env -> .env)
	![String]
	!String
	!.env -> .env
make fmtime fabc_deps sync compile bcgen bclink bcprelink feedback finish paths main env
	// TODO: this should be possible without unsafeCoerce!
	= unsafeCoerce (do_compile
		{ fmtime    = unsafeCoerce fmtime
		, fabc_deps = unsafeCoerce fabc_deps
		, sync      = unsafeCoerce sync
		, compile   = unsafeCoerce compile
		, bcgen     = unsafeCoerce bcgen
		, bclink    = unsafeCoerce bclink
		, bcprelink = unsafeCoerce bcprelink
		, feedback  = unsafeCoerce feedback
		, finish    = unsafeCoerce finish
		, paths     = paths
		, paths_s   = join ":" paths
		, main      = main
		, modules   = 'Data.Map'.newMap
		}
		('Data.Set'.singleton main)
		(unsafeCoerce env))

do_compile st=:{fmtime,fabc_deps,sync,compile,feedback,finish,paths,paths_s} queue env
	| 'Data.Set'.null queue
		# (mbAbc,env) = find_file (fmtime Compiler) paths (system_file "_system") "abc" env
		| isNone mbAbc
			# env = feedback False "Could not find _system.abc." env
			= sync Compiler Store (finish ?None) env
		# abc = fromJust mbAbc
		# st & modules = 'Data.Map'.put "_system" {abc=abc, bc=abc % (0,size abc-4) +++ "bc"} st.modules
		= sync Compiler Store (do_bcgen st) env
	# (mod,queue) = 'Data.Set'.deleteFindMin queue
	# (ok,abc,deps,env) = mb_compile mod env
	| not ok
		= sync Compiler Store (finish ?None) env
	# st & modules = 'Data.Map'.put mod {abc=abc, bc=abc % (0,size abc-4) +++ "bc"} st.modules
	# deps = filter (\m -> not ('Data.Map'.member m st.modules)) deps
	# queue = foldr 'Data.Set'.insert queue deps
	= do_compile st queue env
where
	mb_compile mod env
		# (compilation_needed,abc,deps,env) = needs_compile mod env
		| not compilation_needed
			= (True, abc, deps, env)
		# env = feedback True (concat ["Compiling ",mod,"..."]) env
		# (ok,env) = compile ["/cocl","-dynamics","-P",paths_s,mod] env
		| not ok
			# env = feedback False "Compilation failed." env
			= (False, abc, [], env)
		# (mbAbc,env) = find_file (fmtime Compiler) paths (system_file mod) "abc" env
		| isNone mbAbc
			# env = feedback False (concat ["Could not find ",mod,".abc."]) env
			= (False, abc, [], env)
		# abc = fromJust mbAbc
		# (mbDeps,env) = fabc_deps Compiler abc env
		| isNone mbDeps
			# env = feedback False "Failed to get ABC dependencies." env
			= (False, abc, [], env)
			= (True, abc, fromJust mbDeps, env)

	needs_compile mod env
		# (mbAbc,env) = find_file (fmtime Compiler) paths (system_file mod) "abc" env
		| isNone mbAbc
			= (True, "", [], env)
		# abc = fromJust mbAbc
		# (abc_mtime,env) = fmtime Compiler abc env
		# (mbDeps,env) = fabc_deps Compiler abc env
		# mod_path = module_to_path mod
		# (mbDcl,env) = find_file (fmtime Compiler) paths mod_path "dcl" env
		| isNone abc_mtime || fromJust abc_mtime==0 || isNone mbDeps
			= (True, abc, [], env)
			# deps = [(mod_path, "icl"):[(module_to_path d, "dcl") \\ d <- fromJust mbDeps]]
			# deps = if (isJust mbDcl) [(mod_path, "dcl"):deps] deps
			# (needed,env) = check (fromJust abc_mtime) deps env
			= (needed, abc, fromJust mbDeps, env)
	where
		check _ [] env
			= (False, env)
		check abc_mtime [(f,ext):fs] env
			# (mbF,env) = find_file (fmtime Compiler) paths f ext env
			| isNone mbF
				= (True, env)
			# (mtime,env) = fmtime Compiler (fromJust mbF) env
			| isNone mtime || fromJust mtime>=abc_mtime
				= (True, env)
				= check abc_mtime fs env

do_bcgen st=:{sync,feedback} env
	= sync BCGen Retrieve (do_bcgen` st ('Data.Map'.toList st.modules)) env
do_bcgen` st=:{sync} [] env
	= sync BCGen Store (do_bclink st) env
do_bcgen` st=:{fmtime,sync,bcgen,feedback,finish,paths,main} [(name,mod):queue] env
	# (needed,env) = needs_bcgen mod env
	| not needed
		= do_bcgen` st queue env
	# env = feedback True (concat ["Generating bytecode for ",name,"..."]) env
	# (ok,env) = bcgen ["/bcgen",mod.abc,"-o",mod.bc] env
	| not ok
		# env = feedback False "Bytecode generation failed." env
		= sync BCGen Store (finish ?None) env
		= do_bcgen` st queue env
where
	needs_bcgen mod env
		# (abc_mtime,env) = fmtime BCGen mod.abc env
		# (bc_mtime,env) = fmtime BCGen mod.bc env
		# needed = isNone abc_mtime || isNone bc_mtime || fromJust abc_mtime>=fromJust bc_mtime
		= (needed, env)

do_bclink st=:{sync} env
	= sync BCLink Retrieve (do_bclink` st) env
do_bclink` st=:{sync,bclink,feedback,finish,main,modules} env
	# env = feedback True "Linking bytecode..." env
	# (ok,env) = bclink
		(["/bclink":bc_with_main_first ++ ["-o",main+++".bc"]])
		env
	| not ok
		# env = feedback False "Bytecode linking failed." env
		= sync BCLink Store (finish ?None) env
		= sync BCLink Store (do_bcprelink st) env
where
	bc_with_main_first =
		[ (fromJust ('Data.Map'.get main modules)).bc
		: [bc \\ (m,{bc}) <- 'Data.Map'.toList modules | m <> main]
		]

do_bcprelink st=:{sync} env
	= sync BCPrelink Retrieve (do_bcprelink` st) env
do_bcprelink` st=:{sync,bcprelink,feedback,finish,main} env
	# env = feedback True "Prelinking bytecode..." env
	# (ok,env) = bcprelink ["/bcprelink", main+++".bc", "-o", main+++".pbc"] env
	| not ok
		# env = feedback False "Bytecode prelinking failed." env
		= sync BCPrelink Store (finish ?None) env
		# env = feedback True "Finished building." env
		= sync BCPrelink Store (finish (?Just (main+++".bc"))) env

find_file :: !(String .env -> (?a, .env)) ![String] !String !String !.env -> (?String, .env)
find_file fstat [] _ _ env
	= (?None, env)
find_file fstat [p:ps] name ext env
	# p = concat5 p "/" name "." ext
	# (res,env) = fstat p env
	| isJust res
		= (?Just p, env)
		= find_file fstat ps name ext env

system_file :: !String -> String
system_file mod = join "/" (init parts ++ ["Clean System Files", last parts])
where
	parts = split "." mod

module_to_path :: !String -> String
module_to_path mod = {if (c=='.') '/' c \\ c <-: mod}
