'use strict'; /* globals process, __dirname, __filename, require, module, Buffer */
const { resolve, join, } = require('path');
const globalPath = require('global-modules');
const readFile = require('fs').readFileSync;
const options = JSON.parse(process.argv[2]);
const content = {
	globalPath,
	args: options.args.slice(),
	pause: !!options.pause,
	pipe: options.pipe,
};

try {
	const cwd = content.cwd = options.cwd;
	const paths = getPaths(cwd);
	const isWindows = process.platform === 'win32';

	// try to get the closest `package.json`
	const json = findOnPaths(paths, path => JSON.parse(readFile(join(path, 'package.json' ), 'utf8'))).value || { };
	options.title = typeof json.title === 'string' ? json.title : typeof json.name === 'string' ? json.name : null;

	// set content.entry
	if (options.bin) {
		const ext = isWindows ? '.cmd' : '';
		let { path, value: file, } = findOnPaths(paths, (path, isLast) => readFile(join(path, isLast ? '.' : 'node_modules/.bin', options.bin + ext), 'utf8'));
		if (isWindows) {
			const path2 = file && ((/node\.exe"[\s]+"%~dp0\\([^"]+)/).exec(file) || [ ])[1];
			if (!path2) { throw new Error(`Could not find binary "${ options.bin }" from "${ cwd }"`); }
			path = join(path, path === join(globalPath, '..') ? '.' : 'node_modules/.bin', path2);
		} else {
			if (!path) {
				path = require('which').sync(options.bin);
			}
		}
		content.entry = path;
		content.args.unshift(options.bin);
	} else {
		if (options.args.length) {
			content.entry = require.resolve(resolve(cwd, options.args[0]));
			content.args.splice(0, 1, content.entry);
		} else {
			content.entry = null;
		}
	}
} catch (error) {
	if (error instanceof Error) {
		content.exception = { name: error.name, message: error.message, stack: error.stack, };
	} else {
		throw error;
	}
}

{
	const Electron = require('electron'), IPCStream = require('electron-ipc-stream');
	const { app: App, BrowserWindow, ipcMain: IPC, } = Electron;
	(options['exec-args'] || options.execArgs) && App.commandLine.appendSwitch('js-flags', (options['exec-args'] || options.execArgs || [ ]).map(_=>_.replace(/^-?-?/, '--')).join(' '));
	let win = null;

	new Promise(ready => App.isReady() ? ready() : App.once('ready', ready)).then(() => {
		const { width, height, } = Electron.screen.getPrimaryDisplay().workAreaSize;

		win = new BrowserWindow({
			webPreferences: { nodeIntegration: true, },
			width: Math.min(width, height * 1.25) << 0,
			height: Math.min(height, width) << 0,
			title: [ options.bin || options.args[0], options.title, 'Debugger', ].filter(_=>_&&_!=='.').join(' - '),
			autoHideMenuBar: true,
			show: !options.hidden,
		});

		(/o|c/).test(options.pipe) && new IPCStream('stdout', win).pipe(process.stdout);
		(/e|c/).test(options.pipe) && new IPCStream('stderr', win).pipe(process.stderr);
		(/i/)  .test(options.pipe) && IPC.once('stdin', () => {
			require('fs').createReadStream(null, { fd: 3, }).pipe(new IPCStream('stdin', win));
		});

		let exitCode = 0; IPC.on('exit-code', (_, code) => (exitCode = code));
		win.webContents.once('devtools-closed', () => win && win.close());
		win.once('closed', () => process.exit(exitCode));

		win.openDevTools({ detach: !!options.hidden, });
		win.webContents.once('devtools-opened', () => win.loadURL(`data:text/html;base64,`+ new Buffer(`
			<body style="background:#222"><script>'use strict';
				(${ bootstrap })(${ JSON.stringify(content) })
			</script></body>
		`).toString('base64')));
	})
	.catch(error => {
		console.error(error.stack);
		win && win.close();
		process.exit(-1);
	});
}

// this is loaded inside the content process
function bootstrap({ entry, args, cwd, pause, globalPath, exception, pipe, }) { try {
	global.ELECTRON_DISABLE_SECURITY_WARNINGS = true;
	const Path = require('path'), IPC = require('electron').ipcRenderer;
	const Module = module.constructor, { console, } = global;

	if (exception) {
		// log previous error
		console.error(Object.assign(new (global[exception.name] || Error)(exception.message), exception));
		if (!cwd) { return; } entry = null; args = args || [ ];
	}

	// stop process.exit() from ending the process, navigate instead
	process.reallyExit = function reallyExit(code) {
		IPC.send('exit-code', code);
		const window = global, { document, } = window;
		// TODO: this is broken in recent versions of electron
		window.location.href = `data:text/html;base64,`+ window.btoa(`
			<body style="background:#${ code ? '690c0c' : '1a690c' };color:white;font-family:sans-serif;"><script>'use strict'; (`+ ((code, back) => {
				window.restart = () => (window.location.href = back);
				console.info('Process was exited with code', code, 'call restart() to start again');
				document.write('<h3>Process was exited with code '+ code +'<br></h3>');
				document.write('<h2><a style="color:#9c95fb" href="'+ back +'">RESTART</a></h2>');
			}) +`)(${ +code }, "${ window.location.href }")<\/script>
		`);
	};
	IPC.send('exit-code', 0);

	if (pipe) { // forward stdio
		const IPCStream = require('electron-ipc-stream');
		const stdout = new IPCStream('stdout');
		const stderr = new IPCStream('stderr');
		const stdin  = new IPCStream('stdin');
		// TODO: should expose a stream that is only writable or readable, not duplex
		(/o/).test(pipe) && Object.defineProperty(process, 'stdout', { get() { return stdout; }, });
		(/e/).test(pipe) && Object.defineProperty(process, 'stderr', { get() { return stderr; }, });
		(/i/).test(pipe) && Object.defineProperty(process, 'stdin',  { get() { return stdin; }, });
		(/i/).test(pipe) && IPC.send('stdin');
		if ((/c/).test(pipe)) {
			const console = new (require('console').Console)(stdout, stderr);
			Object.defineProperty(global, 'console', { get() { return console; }, });
		}
	}

	// replace the electron args with those meant for node
	process.argv.splice(1, Infinity, ...args);
	// and set __filename and __dirname for the console
	if (entry) {
		global.__filename = entry;
		global.__dirname = Path.resolve(entry, '..');
	} else {
		global.__dirname = cwd;
		global.__filename = cwd + Path.sep +'.';
		process.argv.splice(1, Infinity);
	}

	// clear all electron modules from cache
	Object.keys(require.cache).forEach(key => delete require.cache[key]);

	if (!entry) { // no entry ==> nothing to require(), just set the correct environment
		const module = new Module;
		module.filename = __filename; module.loaded = true;
		const paths = module.paths = [ ]; let parent = cwd, path = cwd; do {
			paths.push(Path.resolve(path = parent, 'node_modules'));
		} while ((parent = Path.resolve(path, '..')) && parent !== path);
		console.info('running in', __dirname);
		return void setMainModule(module);
	}

	// set entry as the main module
	const ext = Path.extname(__filename) || '.js';
	const loader = Module._extensions[ext];
	Module._extensions[ext] = function(module) {
		Module._extensions[ext] = loader;
		setMainModule(module);
		let wrap = pause && Module.wrap; // inject debugger; statement
		wrap && (Module.wrap = code => {
			Module.wrap = wrap; wrap = null;
			return '(function (exports, require, module, __filename, __dirname, process, global) { debugger; '+ code +'\n});';
		});
		const result = loader(...arguments);
		wrap && (Module.wrap = wrap); // just in case
		return result;
	};

	// load the main module
	new Promise(wake => setTimeout(wake, 20)).then(() => {
		delete global.ELECTRON_DISABLE_SECURITY_WARNINGS;
		console.info(`running with args: `, ...args.map(_=>`"${_}"`));
		console.info(`exports = await require('${ entry }');`);
		return (global.exports = require(entry));
	}).then(exports => {
		console.info('exports resolved to:', exports);
		global.exports = exports;
	})
	.catch(error => {
		console.error('exports rejected with:', error);
		process.exitCode && console.info('the exitCode is set to', process.exitCode);
	});

	function setMainModule(module) {
		global.require = module.require.bind(module);
		require.main = module;
		require.resolve = function resolve(request) { return Module._resolveFilename(request, module); };
		require.extensions = Module._extensions;
		require.cache = Module._cache;
		require.global = module => require(Path.join(globalPath, module));

		global.module = process.mainModule = module;
		module.id = '.'; module.parent = null;
	}
} catch (error) {
	console.error('Uncaught', error);
} }

function getPaths(path) {
	const paths = [ path, ];
	let parent = path;
	while ((parent = resolve(path, '..')) && parent !== path) {
		paths.push(path = parent);
	}
	paths.push(resolve(globalPath, '..'));
	return paths;
}

function findOnPaths(paths, find) {
	const last = paths[paths.length - 1];
	for (const path of paths) {
		let value; try { value = find(path, path === last); } catch (_) { }
		if (value != null) { return { value, path, }; }
	}
	return { };
}
