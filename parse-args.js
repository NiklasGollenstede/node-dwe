'use strict'; /* globals require, module, process, */

function Bool(bool) {
	return !(bool === false || bool === 'false' || bool === '' || bool === '0' || bool === 0);
}

const optionList = [
	{ name: 'help',      alias: 'h', _type: Bool,                         description: 'Display this message and exit.', },
	{ name: 'bin',       alias: 'b', _type: String,                       description: '', },
	{ name: 'detach',    alias: 'd', _type: Bool,    defaultValue: true,  description: '', },
	{ name: 'hidden',                _type: Bool,    defaultValue: false, description: '', },
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
				if (option._type === Bool && !(/^true$|^false$|^0$/).test(args[i + 1])) { continue; } // bool option and next arg is not a bool
				if (++i >= args.length) { return (`Missing value for option "${ args[i] }`); } // missing value
				// consume this and the next arg as key and value of the option
			} else { // aliased option
				const alias = args[i].slice(-1);
				const option = optionList.find(_=>_.alias === alias);
				if (!option) { return (`Invaid option "${ args[i] }`); } // invalid option
				if (option._type === Bool && !(/^true$|^false$|^0$/).test(args[i + 1])) { continue; } // bool option and next arg is not a bool
				if (++i >= args.length) { return (`Missing value for option "${ args[i] }`); } // missing value
				// consume this and the next arg as key and value of the option
			}
		}
	}
	const progArgs = args.splice(splitAt, Infinity);

	const options = require('command-line-args')(optionList, args); // TODO: catch (...)
	Object.keys(options).forEach(key => optionsObject[key]._type && (options[key] = optionsObject[key]._type(options[key])));
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
			content: 'TODO',
		},
		{
			header: 'Options',
			optionList,
		}
	]));
}

module.exports = { getProcessOptions, parseArgs, showInfo, };
