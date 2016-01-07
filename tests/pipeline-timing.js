/*
 * tests/pipeline-timing.js: tests pipeline behavior with trackTime enabled.
 */

var mod_jsprim = require('jsprim');
var mod_tap = require('tap');
var mod_vasync = require('..');

mod_tap.test('pipeline with timing', function (test) {
	var p;

	p = mod_vasync.pipeline({
	    'trackTime': true,
	    'funcs': [
		function f1(_, callback) {
			/*
			 * We have no way of checking the state upon entry to
			 * the first function because the pipeline object itself
			 * is not available to us here.
			 */
			setTimeout(callback, 300);
		},

		function f2(_, callback) {
			test.ok(Array.isArray(p.hrtimeStarted));
			test.ok(p.hrtimeElapsed === null);
			test.ok(Array.isArray(p.operations[0].hrtimeStarted));
			test.ok(Array.isArray(p.operations[0].hrtimeElapsed));
			test.ok(Array.isArray(p.operations[1].hrtimeStarted));
			test.ok(p.operations[1].hrtimeElapsed === null);
			test.ok(p.operations[2].hrtimeStarted === null);
			test.ok(p.operations[2].hrtimeElapsed === null);
			setTimeout(callback, 800);
		},

		function f3(_, callback) {
			test.ok(Array.isArray(p.hrtimeStarted));
			test.ok(p.hrtimeElapsed === null);
			test.ok(Array.isArray(p.operations[0].hrtimeStarted));
			test.ok(Array.isArray(p.operations[0].hrtimeElapsed));
			test.ok(Array.isArray(p.operations[1].hrtimeStarted));
			test.ok(Array.isArray(p.operations[1].hrtimeElapsed));
			test.ok(Array.isArray(p.operations[2].hrtimeStarted));
			test.ok(p.operations[2].hrtimeElapsed === null);
			setTimeout(callback, 100);
		}
	    ]
	}, function (err) {
		test.ok(Array.isArray(p.hrtimeStarted));
		test.ok(Array.isArray(p.hrtimeElapsed));
		test.ok(Array.isArray(p.operations[0].hrtimeStarted));
		test.ok(Array.isArray(p.operations[0].hrtimeElapsed));
		test.ok(Array.isArray(p.operations[1].hrtimeStarted));
		test.ok(Array.isArray(p.operations[1].hrtimeElapsed));
		test.ok(Array.isArray(p.operations[2].hrtimeStarted));
		test.ok(Array.isArray(p.operations[2].hrtimeElapsed));

		/*
		 * Check basic math: first check that the time elapsed by the
		 * operations is not greater than the total pipeline time.
		 */
		var t, t1, t2;
		t = mod_jsprim.deepCopy(p.operations[0].hrtimeElapsed);
		mod_jsprim.hrtimeAccum(t, p.operations[1].hrtimeElapsed);
		mod_jsprim.hrtimeAccum(t, p.operations[2].hrtimeElapsed);
		t1 = mod_jsprim.hrtimeNanosec(t);
		t2 = mod_jsprim.hrtimeNanosec(p.hrtimeElapsed);
		test.ok(t2 >= t1);

		/*
		 * Check that the total pipeline time is within 20% of sum of
		 * operation times.
		 */
		test.ok(t2 - t1 <= t2 / 5);

		/*
		 * Check that the gaps between operations are not very large.
		 */
		t = mod_jsprim.hrtimeDiff(
		    p.operations[0].hrtimeStarted, p.hrtimeStarted);
		test.ok(mod_jsprim.hrtimeNanosec(t) < 1000000000);

		t1 = mod_jsprim.hrtimeAdd(p.operations[0].hrtimeStarted,
		    p.operations[0].hrtimeElapsed);
		t = mod_jsprim.hrtimeDiff(p.operations[1].hrtimeStarted, t1);
		test.ok(mod_jsprim.hrtimeNanosec(t) < 1000000000);

		t1 = mod_jsprim.hrtimeAdd(p.operations[1].hrtimeStarted,
		    p.operations[1].hrtimeElapsed);
		t = mod_jsprim.hrtimeDiff(p.operations[2].hrtimeStarted, t1);
		test.ok(mod_jsprim.hrtimeNanosec(t) < 1000000000);

		test.end();
	});

	test.ok(Array.isArray(p.hrtimeStarted));
	test.ok(p.hrtimeElapsed === null);
	/*
	 * It's not necessarily defined whether we've started the first
	 * operation yet, but we've not completed it, and we must not have
	 * started the others.
	 */
	test.ok(p.operations[0].hrtimeElapsed === null);
	test.ok(p.operations[1].hrtimeStarted === null);
	test.ok(p.operations[1].hrtimeElapsed === null);
	test.ok(p.operations[2].hrtimeStarted === null);
	test.ok(p.operations[2].hrtimeElapsed === null);
});
