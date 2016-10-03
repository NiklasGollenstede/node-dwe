'use strict'; /* globals process, __dirname, __filename, require, Buffer */

if (!('electron' in process.versions)) { // started as node.js program, launch electron app
	const { resolve, } = require('path');
	const cwd = process.cwd();

	// try to get the closest `package.json`
	const readJSON = (read => path => { return JSON.parse(read(path, 'utf8')); })(require('fs').readFileSync);
	const json = (function find(path) { try {
		return readJSON(path +'/package.json');
	} catch (_) {
		const parent = resolve(path, '..');
		if (parent && parent !== path) { return find(parent); }
		return { };
	} })(cwd);

	let entry = require.resolve(cwd +'/'+ (process.argv[2] || ''));
	if (entry === __filename) { entry = require.resolve(cwd +'/index.js'); }

	const electron = require('child_process').spawn(
		require(require('global-modules') +'/electron'), // path to the globally installed electron binary
		[
			__dirname, // the 'app', reads the "main" key from the `package.json` of this project
			entry, // resolved path to the entry .js file
			JSON.stringify(process.argv.slice(3)), // forward other args
			JSON.stringify({ // other options
				title: typeof json.title === 'string' ? json.title : typeof json.name === 'string' ? json.name : null,
				// hidden: true,
			}),
		],
		{ cwd: cwd, env: process.env, detached: true, }
	);

	electron.on('error', error => console.error(error));
	electron.stdout.pipe(process.stdout);
	electron.stderr.pipe(process.stderr);

} else { // started as electron app
	// __dirname = process.argv[1];
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
			title: (options.title ? options.title + ' - ' : '') + 'Debugger',
			autoHideMenuBar: true,
			show: !options.hidden,
		});
		win.webContents.once('devtools-closed', () => win && win.close());
		win.once('closed', () => win = null);
		win.openDevTools({ detach: !!options.hidden, });
		win.webContents.once('devtools-opened', () => win.loadURL(`data:text/html;base64,`+ new Buffer(`
			<body style="background:#222"><script>
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

	// replace the electron args with those ment for node
	process.argv.splice(1, Infinity, entry, ...args);

	// set __filename and __dirname for the console
	window.__filename = entry;
	window.__dirname = Path.resolve(entry, '..');

	// set entry as the main module
	const ext = Path.extname(__filename) || '.js';
	const loader = require.main.constructor._extensions[ext];
	require.main.constructor._extensions[ext] = function(module, filename) {
		window.require = module.require.bind(module);
		require.main = process.mainModule = module;
		module.id = '.'; module.parent = null;
		require.main.constructor._extensions[ext] = loader;
		return loader(...arguments);
	};

	// stop process.exit() from ending the process, navigate instead
	process.reallyExit = function reallyExit(code) {
		window.location.href = `data:text/html;base64,`+ btoa(`
			<body style="background:#690c0c;color:white;font-family:sans-serif;"><script>
				const message = 'Process was exited with code ${ +code }';
				console.log(message); document.write('<h3>'+ message +'<br></h3>');
				document.write('<h2><a style="color:#9c95fb" href="javascript:history.back();">RESTART</a></h2>');
			<\/script>
		`);
	};

	// load the main module
	Promise.resolve().then(() => {
		console.info(`exports = await require('${ entry }');`);
		return (window.exports = require(entry));
	}).then(exports => {
		console.info('exports resolved to', exports);
		window.exports = exports;
	})
	.catch(error => console.error(error));
} catch (error) {
	console.error('Uncaught', error);
} }
