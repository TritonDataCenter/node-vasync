var mod_dns = require('dns');
var mod_util = require('util');
var mod_vasync = require('../lib/vasync');

console.log(mod_vasync.pipeline({
    'trackTime': true,
    'funcs': [
	function f1(_, callback) { mod_dns.lookup('joyent.com', callback); },
	function f2(_, callback) { mod_dns.lookup('github.com', callback); },
	function f3(_, callback) { mod_dns.lookup('asdfaqsd.com', callback); }
    ]
}, function (err, results) {
	console.log('error: %s', err.message);
	console.log('results: %s', mod_util.inspect(results, null, 4));
}));
