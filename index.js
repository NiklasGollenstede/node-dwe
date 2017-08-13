'use strict'; /* globals module, process, require, __dirname, */

module.exports = function start(options, stdio) {

	const electron = require('child_process').spawn(
		require(require('global-modules') +'/electron'), // path to the globally installed electron binary
		[
			__dirname, // the 'app', reads the "main" key from the `package.json` of this project, which points './debugger.js'
			JSON.stringify(options),
		], {
			cwd: process.cwd(),
			env: process.env,
			detached: options.detach,
			stdio: stdio || (options.detach ? 'ignore' : 'pipe'),
		}
	);

	return electron;
};
