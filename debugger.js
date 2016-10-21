'use strict'; /* globals process, __dirname, __filename, require, module, Buffer */
const { resolve, } = require('path');

if (!('electron' in process.versions)) { // started as node.js program, launch electron app
	const cwd = process.cwd();

	// try to get the closest `package.json`
	const readJSON = (read => path => { return JSON.parse(read(path, 'utf8')); })(require('fs').readFileSync);
	const { json, } = findPackageJson(cwd);

	let args = [ ], i = 2;
	while (i < process.argv.length && process.argv[i].startsWith('--')) {
		args.push(process.argv[i++]);
	}
	const detach = !args.includes('--blocking');
	const hidden = args.includes('--hidden');
	const bin = (args.find(_=>_.startsWith('--bin=')) || '').slice('--bin='.length);

	let progName, subProg, progArgs, entryFile;
	if (bin) {
		[ progName, subProg, ] = bin.split(':');
		// resolve progName and read it's package.json
		let json, path = resolveFrom(cwd, progName);
		({ json, path, } = findPackageJson(path));
		// read the .bin entry
		entryFile = typeof json.bin === 'object' ? json.bin[subProg || progName] : json.bin;
		if (!entryFile) { throw new Error(`Could not resolve --bin=${ bin }`); }
		entryFile = resolve(path, entryFile);
		progArgs = [ progName, ...process.argv.slice(args.length + 2), ];
	} else {
		if ((progName = process.argv[args.length + 2])) {
			entryFile = require.resolve(cwd +'/'+ progName);
			progArgs = [ entryFile, ...process.argv.slice(args.length + 3), ];
		} else {
			entryFile = cwd;
		}
	}

	const electron = require('child_process').spawn(
		require(require('global-modules') +'/electron'), // path to the globally installed electron binary
		[
			__dirname, // the 'app', reads the "main" key from the `package.json` of this project which points back to this file
			entryFile, // resolved path to the entry .js file
			JSON.stringify(progArgs), // forward other args
			JSON.stringify({ // other options
				title: typeof json.title === 'string' ? json.title : typeof json.name === 'string' ? json.name : null,
				progName, hidden,
			}),
		], {
			cwd: cwd,
			env: process.env,
			detached: true,
			stdio: detach ? 'ignore' : [ 'ignore', 'pipe', 'pipe', ],
		}
	);

	if (detach) { electron.unref(); return; }

	electron.on('error', error => console.error(error));
	electron.stdout.pipe(process.stdout);
	electron.stderr.pipe(process.stderr);

} else { // started as electron app
	// process.argv[1] === __dirname
	const entry = process.argv[2];
	const args = process.argv[3];
	const options = JSON.parse(process.argv[4]);

	const Electron = require('electron');
	const { app: App, BrowserWindow, } = Electron;
	let win = null;

	new Promise(ready => App.isReady() ? ready() : App.once('ready', ready)).then(() => {
		const { width, height, } = Electron.screen.getPrimaryDisplay().workAreaSize;

		win = new BrowserWindow({
			width: Math.min(width, height * 1.25) << 0,
			height: Math.min(height, width) << 0,
			title: [ options.progName, options.title, 'Debugger', ].filter(_=>_&&_!=='.').join(' - '),
			autoHideMenuBar: true,
			show: !options.hidden,
		});
		win.webContents.once('devtools-closed', () => win && win.close());
		win.once('closed', () => win = null);
		win.openDevTools({ detach: !!options.hidden, });
		win.webContents.once('devtools-opened', () => win.loadURL(`data:text/html;base64,`+ new Buffer(`
			<body style="background:#222"><script>'use strict';
				(${ bootstrap })(${ JSON.stringify(entry) }, ${ args })
			</script></body>
		`).toString('base64')));

		// install dark devTools theme
		require('electron-devtools-installer').default('bomhdjeadceaggdgfoefmpeafkjhegbo');
	})
	.catch(error => {
		console.error(error.stack);
		win && win.close();
		process.exit(-1);
	});
}

// this is loaded inside the content process
function bootstrap(entry, args) { try {
	const Path = require('path');
	const Module = module.constructor;

	// stop process.exit() from ending the process, navigate instead
	process.reallyExit = function reallyExit(code) {
		window.location.href = `data:text/html;base64,`+ btoa(`
			<body style="background:#${ code ? '690c0c' : '1a690c' };color:white;font-family:sans-serif;"><script>'use strict'; (`+ ((code, back) => {
				window.restart = () => window.location.href = back;
				console.info('Process was exited with code', code, 'call restart() to start again');
				/* jshint evil: true */
				document.write('<h3>Process was exited with code '+ code +'<br></h3>');
				document.write('<h2><a style="color:#9c95fb" href="'+ back +'">RESTART</a></h2>');
			}) +`)(${ +code }, "${ window.location.href }")<\/script>
		`);
	};

	// replace the electron args with those meant for node
	// and set __filename and __dirname for the console
	if (args) {
		process.argv.splice(1, Infinity, ...args);
		window.__filename = entry;
		window.__dirname = Path.resolve(entry, '..');
	} else {
		window.__dirname = entry;
		window.__filename = entry + Path.sep +'.';
		process.argv.splice(1, Infinity);
	}

	if (!args) { // no args ==> nothing to require(), just set the correct environment
		const module = new Module;
		module.filename = __filename; module.loaded = true;
		let paths = module.paths = [ ], parent = entry, path = entry; do {
			paths.push(Path.resolve(path = parent, 'node_modules'));
		} while ((parent = Path.resolve(path, '..')) && parent !== path);
		console.info('running in', __dirname);
		return setMainModule(module);
	}

	// set entry as the main module
	const ext = Path.extname(__filename) || '.js';
	const loader = Module._extensions[ext];
	Module._extensions[ext] = function(module, filename) {
		Module._extensions[ext] = loader;
		setMainModule(module);
		return loader(...arguments);
	};

	// load the main module
	Promise.resolve().then(() => {
		console.info(`exports = await require('${ entry }');`);
		return (window.exports = require(entry));
	}).then(exports => {
		console.info('exports resolved to:', exports);
		window.exports = exports;
	})
	.catch(error => {
		console.error('exports rejected with:', error);
		process.exitCode && console.info('the exitCode is set to', process.exitCode);
	});

	function setMainModule(module) {
		window.require = module.require.bind(module);
		require.main = module;
		require.resolve = function resolve(request) { return Module._resolveFilename(request, module); };
		require.extensions = Module._extensions;
		require.cache = Module._cache;

		window.module = process.mainModule = module;
		module.id = '.'; module.parent = null;
	}
} catch (error) {
	console.error('Uncaught', error);
} }

function findPackageJson(start) {
	const readJSON = (read => path => { return JSON.parse(read(path, 'utf8')); })(require('fs').readFileSync);
	return (function find(path) { try {
		return { path, json: readJSON(path +'/package.json'), };
	} catch (_) {
		const parent = resolve(path, '..');
		if (parent && parent !== path) { return find(parent); }
		return { };
	} })(start) || { };
}

// attempts to locally resolve `request`from the given `path` the same way node.js does, and tries the global modules if that fails
function resolveFrom(path, request) {
	const _module = { filename: path +'/index.js', id: path +'/index.js', };
	const paths = _module.paths = [ resolve(path, 'node_modules'), ];
	let parent = path;
	while ((parent = resolve(path, '..')) && parent !== path) {
		paths.push(resolve(path = parent, 'node_modules'));
	}
	try {
		return module.constructor._resolveFilename(request, _module);
	} catch (error) { try {
		return require.resolve(require('global-modules') +'/'+ request);
	} catch (_) { throw error; } } // throw the original error
}
