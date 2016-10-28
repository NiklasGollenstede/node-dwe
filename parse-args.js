'use strict'; /* globals require, module, process, */

function Bool(bool) {
	switch (bool) {
		case false: case 'false': case '0': case 0: case '!1': case '':                    return false;
		case true:  case 'true':  case '1': case 1: case '!0': case null: case undefined:  return true;
		default: throw `invalid bool "${ bool }"`;
	}
}
function isBoolString(string) {
	return (/^(?:|true|false|1|0|!1|!0)$/).test(string);
}

const optionList = [
	{ name: 'help',      alias: 'h', _type: Bool,    typeLabel: 'bool',                            description: 'Display this message and exit.', },
	{ name: 'bin',       alias: 'b', _type: String,  typeLabel: 'string',                          description: 'Name of a local or global bin module to call.', },
	{ name: 'detach',    alias: 'd', _type: Bool,    typeLabel: 'bool',       defaultValue: true,  description: 'Detach from the electron process.', },
	{ name: 'pause',     alias: 'p', _type: Bool,    typeLabel: 'bool',                            description: 'Break on the first line of the entry script.', },
	{ name: 'hidden',                _type: Bool,    typeLabel: 'bool',                            description: 'Hide the electron main window and only show the debugger.', },
];
const optionsObject = optionList.reduce((obj, opt) => ((obj[opt.name] = obj[opt.alias] = opt), obj), { });

function getProcessOptions() {
	const args = process.argv.slice(2);
	const options = parseArgs(args);
	if (typeof options === 'string') {
		showInfo(options);
		process.exit(1);
	} else if (options.help) {
		showInfo();
		process.exit(0);
	}
	return options;
}

function parseArgs(args) {
	let splitAt = args.length === 0 ? 0 : args.indexOf('--');
	if (splitAt >= 0) {
		args.splice(splitAt, 1); // remove '--'
	} else {
		for (let i = 0; i < args.length; splitAt = ++i) {
			if (args[i][0] !== '-') { splitAt = i; break; } // first not-option
			if (args[i][1] === '-') { // "full" option ...
				const name = args[i].slice(2);
				if (name.includes('=')) { continue; }
				const option = optionList.find(_=>_.name === name);
				if (!option) { return (`Invaid option "${ args[i] }`); } // invalid option
				if (option._type === Bool && !isBoolString(args[i + 1])) { continue; } // bool option and next arg is not a bool
				if (++i >= args.length) { return (`Missing value for option "${ args[i] }`); } // missing value
				// consume this and the next arg as key and value of the option
			} else { // aliased option
				const alias = args[i].slice(-1);
				const option = optionList.find(_=>_.alias === alias);
				if (!option) { return (`Invaid option "${ args[i] }`); } // invalid option
				if (option._type === Bool && !isBoolString(args[i + 1])) { continue; } // bool option and next arg is not a bool
				if (++i >= args.length) { return (`Missing value for option "${ args[i] }`); } // missing value
				// consume this and the next arg as key and value of the option
			}
		}
	}
	const progArgs = args.splice(splitAt, Infinity);

	const options = require('command-line-args')(optionList, args); // TODO: catch (...)
	for (let key of Object.keys(options)) {
		if (!optionsObject[key]._type) { continue; }
		try {
			// console.log('mapping', key, 'from', options[key], 'to', optionsObject[key]._type(options[key]));
			options[key] = optionsObject[key]._type(options[key]);
		} catch (string) { return `Invalid value for option ${ key }: ${ string.message || string }`; }
	}
	options.args = progArgs;
	return options;
}

function showInfo(errorMessage) {
	const _package = require('./package.json');

	console.log(require('command-line-usage')([
		errorMessage
		? {
			header: 'error',
			content: errorMessage,
		}
		: {
			header: _package.title,
			content: `
				Executes a node.js process in electron instead of node.js to attach the chromium debugger directly to that process.
			`.trim(),
		},
		{
			header: 'Usage',
			content: `
				$ node-dwe [--options] [--] [args]
				Where options are any number of the options below and args are set as the argv of the the debuggee.
				'--' can be used to clearly mark the beginning of args. If it is not present, args will start with the first word that is not recognised as an option (or value thereof).
				Unless the --bin option is set, the first arg will be resolved and required as the main module.
			`.split(/\s*?[\n\r]\s*/),
		},
		{
			header: 'Examples',
			content: (
			   `  Start the local 'server.js' with args --argv2 -f oo:
				  $ node-dwe server.js --argv2 -f oo

				  Search for a local or global '_mocha' bin and run it with 'test/unit':
				  $ node-dwe --bin _mocha test/unit

				  Start the local file '--bad-name.js' and break on it's first line:
				  $ node-dwe -b -- --bad-name`
			).split(/$\r?\n?\r?^\t*/m).join('\n'),
			raw: true,
		},
		{
			header: 'Options',
			optionList,
		}
	]));
}

module.exports = { getProcessOptions, parseArgs, showInfo, };
