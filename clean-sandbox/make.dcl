definition module make

:: FileSystemModule = Compiler | BCGen | BCLink | BCPrelink
:: SyncDirection = Retrieve | Store

/**
 * Build a Clean project.
 *
 * @param Function to get the modification time of a file.
 * @param Function to read the dependencies from an ABC file.
 * @param Synchronization function for the file system. The third argument must
 *   be executed once synchronization has finished.
 * @param Compiler function.
 * @param Bytecode generator function.
 * @param Bytecode linker function.
 * @param Bytecode prelinker function.
 * @param Feedback function. The boolean indicates whether stdout (True) or
 *   stderr (False) is targeted.
 * @param Result function. Called when everything is done with the resulting
 *   prelinked bytecode file path in case of success.
 * @param The include paths.
 * @param The main module to make.
 */
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
