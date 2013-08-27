# vasync: utilities for observable asynchronous control flow

This module provides facilities for asynchronous control flow.  There are many
modules that do this already (notably async.js).  This one's claim to fame is
aided debuggability.


## Observability is important

Working with Node's asynchronous, callback-based model is much easier with a
handful of simple control-flow abstractions, like:

* pipelines (which invoke a list of asynchronous callbacks sequentially)
* parallel pipelines (which invoke a list of asynchronous callbacks in parallel
  and invoke a top-level callback when the last one completes).
* queues
* barriers

But these structures also introduce new types of programming errors: failing to
invoke the callback can cause the program to hang, and inadvertently invoking it
twice can cause all kinds of mayhem that's very difficult to debug.

The facilities in this module keep track of what's going on so that you can
figure out what happened when your program goes wrong.  They generally return an
object describing details of the current state.  If your program goes wrong, you
have several ways of getting at this state:

* On illumos-based systems, use MDB to [find the status object](http://dtrace.org/blogs/bmc/2012/05/05/debugging-node-js-memory-leaks/)
  and then [print it out](http://dtrace.org/blogs/dap/2012/01/13/playing-with-nodev8-postmortem-debugging/).
* Provide an HTTP API (or AMQP, or whatever) that returns these pending status
  objects as JSON (see [kang](https://github.com/davepacheco/kang)).
* Incorporate a REPL into your program and print out the status object.
* Use the Node debugger to print out the status object.

## Facilities

This module implements the following utilities:

* `parallel(args, callback)`: invoke N functions in parallel (and merge the
  results)
* `forEachParallel(args, callback)`: invoke the same function on N inputs in parallel
* `pipeline(args, callback)`: invoke N functions in series (and stop on failure)
* `forEachPipeline(args, callback)`: invoke the same function on N inputs in series (and stop on failure)
* `barrier([args])`: coordinate multiple concurrent operations
* `queuev(args)`: fixed-size worker queue

### parallel(args, callback): invoke N functions in parallel and merge the results

This function takes a list of input functions (specified by the "funcs" property
of "args") and runs them all.  These input functions are expected to be
asynchronous: they get a "callback" argument and should invoke it as
`callback(err, result)`.  The error and result will be saved and made available
to the original caller when all of these functions complete.

This function returns the same "result" object it passes to the callback, and
you can use the fields in this object to debug or observe progress:

* `operations`: array corresponding to the input functions, with
    * `func`: input function,
    * `status`: "pending", "ok", or "fail",
    * `err`: returned "err" value, if any, and
    * `result`: returned "result" value, if any
* `successes`: "result" field for each of "operations" where
  "status" == "ok" (in no particular order)
* `ndone`: number of input operations that have completed
* `nerrors`: number of input operations that have failed

This status object lets you see in a debugger exactly which functions have
completed, what they returned, and which ones are outstanding.

All errors are combined into a single "err" parameter to the final callback (see
below).

Example usage:

    console.log(mod_vasync.parallel({
        'funcs': [
            function f1 (callback) { mod_dns.resolve('joyent.com', callback); },
            function f2 (callback) { mod_dns.resolve('github.com', callback); },
            function f3 (callback) { mod_dns.resolve('asdfaqsdfj.com', callback); }
        ]
    }, function (err, results) {
            console.log('error: %s', err.message);
            console.log('results: %s', mod_util.inspect(results, null, 3));
    }));

In the first tick, this outputs:

    status: { operations: 
       [ { func: [Function: f1], status: 'pending' },
         { func: [Function: f2], status: 'pending' },
         { func: [Function: f3], status: 'pending' } ],
      successes: [],
      ndone: 0,
      nerrors: 0 }

showing that there are three operations pending and none has yet been started.
When the program finishes, it outputs this error:

    error: first of 1 error: queryA ENOTFOUND

which encapsulates all of the intermediate failures.  This model allows you to
write the final callback like you normally would:

    if (err)
            return (callback(err));

and still propagate useful information to callers that don't deal with multiple
errors (i.e. most callers).

The example also prints out the detailed final status, including all of the
errors and return values:

    results: { operations: 
       [ { func: [Function: f1],
           funcname: 'f1',
           status: 'ok',
           err: null,
           result: [ '165.225.132.33' ] },
         { func: [Function: f2],
           funcname: 'f2',
           status: 'ok',
           err: null,
           result: [ '207.97.227.239' ] },
         { func: [Function: f3],
           funcname: 'f3',
           status: 'fail',
           err: { [Error: queryA ENOTFOUND] code: 'ENOTFOUND',
              errno: 'ENOTFOUND', syscall: 'queryA' },
           result: undefined } ],
      successes: [ [ '165.225.132.33' ], [ '207.97.227.239' ] ],
      ndone: 3,
      nerrors: 1 }

You can use this if you want to handle all of the errors individually or to get
at all of the individual return values.

Note that "successes" is provided as a convenience and the order of items in
that array may not correspond to the order of the inputs.  To consume output in
an ordered manner, you should iterate over "operations" and pick out the result
from each item.


### forEachParallel(args, callback): invoke the same function on N inputs in parallel

This function is exactly like `parallel`, except that the input is specified as
a *single* function ("func") and a list of inputs ("inputs").  The function is
invoked on each input in parallel.

This example is exactly equivalent to the one above:

    console.log(mod_vasync.forEachParallel({
        'func': mod_dns.resolve,
        'inputs': [ 'joyent.com', 'github.com', 'asdfaqsdfj.com' ]
    }, function (err, results) {
        console.log('error: %s', err.message);
        console.log('results: %s', mod_util.inspect(results, null, 3));
    }));


### pipeline(args, callback): invoke N functions in series (and stop on failure)

The named arguments (that go inside `args`) are:

* `funcs`: input functions, to be invoked in series
* `arg`: arbitrary argument that will be passed to each function

The functions are invoked in order as `func(arg, callback)`, where "arg" is the
user-supplied argument from "args" and "callback" should be invoked in the usual
way.  If any function emits an error, the whole pipeline stops.

The return value and the arguments to the final callback are exactly the same as
for `parallel`.  The error object for the final callback is just the error
returned by whatever pipeline function failed (if any).

This example is similar to the one above, except that it runs the steps in
sequence and stops early because `pipeline` stops on the first error:

    console.log(mod_vasync.pipeline({
        'funcs': [
            function f1 (_, callback) { mod_fs.stat('/tmp', callback); },
            function f2 (_, callback) { mod_fs.stat('/noexist', callback); },
            function f3 (_, callback) { mod_fs.stat('/var', callback); }
        ]
    }, function (err, results) {
            console.log('error: %s', err.message);
            console.log('results: %s', mod_util.inspect(results, null, 3));
    }));

As a result, the status after the first tick looks like this:

    { operations: 
       [ { func: [Function: f1], status: 'pending' },
         { func: [Function: f2], status: 'waiting' },
         { func: [Function: f3], status: 'waiting' } ],
      successes: [],
      ndone: 0,
      nerrors: 0 }

Note that the second and third stages are now "waiting", rather than "pending"
in the `parallel` case.  The error and complete result look just like the
parallel case.


### forEachPipeline(args, callback): invoke the same function on N inputs in series (and stop on failure)

This function is exactly like `pipeline`, except that the input is specified as
a *single* function ("func") and a list of inputs ("inputs").  The function is
invoked on each input in series.

This example is exactly equivalent to the one above:

    console.log(mod_vasync.forEachPipeline({
        'func': mod_dns.resolve,
        'inputs': [ 'joyent.com', 'github.com', 'asdfaqsdfj.com' ]
    }, function (err, results) {
        console.log('error: %s', err.message);
        console.log('results: %s', mod_util.inspect(results, null, 3));
    }));


### barrier([args]): coordinate multiple concurrent operations

Returns a new barrier object.  Like `parallel`, barriers are useful for
coordinating several concurrent operations, but instead of specifying a list of
functions to invoke, you just say how many (and optionally which ones) are
outstanding, and this object emits `'drain'` when they've all completed.  This
is syntactically lighter-weight, and more flexible.

* Methods:

    * start(name): Indicates that the named operation began.  The name must not
      match an operation which is already ongoing.
    * done(name): Indicates that the named operation ended.


* Read-only public properties (for debugging):

    * pending: Set of pending operations.  Keys are names passed to "start", and
      values are timestamps when the operation began.
    * recent: Array of recent completed operations.  Each element is an object
      with a "name", "start", and "done" field.  By default, 10 operations are
      remembered.


* Options:

    * nrecent: number of recent operations to remember (for debugging)

Example: printing sizes of files in a directory

    var mod_fs = require('fs');
    var mod_path = require('path');
    var mod_vasync = require('../lib/vasync');

    var barrier = mod_vasync.barrier();

    barrier.on('drain', function () {
    	console.log('all files checked');
    });

    barrier.start('readdir');

    mod_fs.readdir(__dirname, function (err, files) {
    	barrier.done('readdir');

    	if (err)
    		throw (err);

    	files.forEach(function (file) {
    		barrier.start('stat ' + file);

    		var path = mod_path.join(__dirname, file);

    		mod_fs.stat(path, function (err2, stat) {
    			barrier.done('stat ' + file);
    			console.log('%s: %d bytes', file, stat['size']);
    		});
    	});
    });

This emits:

    barrier-readdir.js: 602 bytes
    foreach-parallel.js: 358 bytes
    barrier-basic.js: 552 bytes
    nofail.js: 384 bytes
    pipeline.js: 490 bytes
    parallel.js: 481 bytes
    queue-serializer.js: 441 bytes
    queue-stat.js: 529 bytes
    all files checked


### queue(worker, concurrency): fixed-size worker queue
### queuev(args)

This function returns an object that allows up to a fixed number of tasks to be
dispatched at any given time.  The interface is compatible with that provided
by the "async" Node library, except that the returned object's fields represent
a public interface you can use to introspect what's going on.

* Arguments

    * worker: a function invoked as `worker(task, callback)`, where `task` is a
      task dispatched to this queue and `callback` should be invoked when the
      task completes.
    * concurrency: a positive integer indicating the maximum number of tasks
      that may be dispatched at any time.  With concurrency = 1, the queue
      serializes all operations.


* Methods

    * push(task, [callback]): add a task (or array of tasks) to the queue, with
      an optional callback to be invoked when each task completes.  If a list of
      tasks are added, the callback is invoked for each one.
    * length(): for compatibility with node-async.


* Read-only public properties (for debugging):

    * concurrency: for compatibility with node-async
    * worker: worker function, as passed into "queue"/"queuev"
    * worker\_name: worker function's "name" field
    * npending: the number of tasks currently being processed
    * pending: an object (*not* an array) describing the tasks currently being
      processed
    * queued: array of tasks currently queued for processing


* Hooks (for compatibility with node-async):

    * saturated
    * empty
    * drain

If the tasks are themselves simple objects, then the entire queue may be
serialized (as via JSON.stringify) for debugging and monitoring tools.  Using
the above fields, you can see what this queue is doing (worker\_name), which
tasks are queued, which tasks are being processed, and so on.

### Example 1: Stat several files

Here's an example demonstrating the queue:

    var mod_fs = require('fs');
    var mod_vasync = require('../lib/vasync');

    var queue;

    function doneOne()
    {
    	console.log('task completed; queue state:\n%s\n',
    	    JSON.stringify(queue, null, 4));
    }

    queue = mod_vasync.queue(mod_fs.stat, 2);

    console.log('initial queue state:\n%s\n', JSON.stringify(queue, null, 4));

    queue.push('/tmp/file1', doneOne);
    queue.push('/tmp/file2', doneOne);
    queue.push('/tmp/file3', doneOne);
    queue.push('/tmp/file4', doneOne);

    console.log('all tasks dispatched:\n%s\n', JSON.stringify(queue, null, 4));

The initial queue state looks like this:

    initial queue state: 
    {
        "nextid": 0,
        "worker_name": "anon",
        "npending": 0,
        "pending": {},
        "queued": [],
        "concurrency": 2
    }

After four tasks have been pushed, we see that two of them have been dispatched
and the remaining two are queued up:

    all tasks pushed:
    {
        "nextid": 4,
        "worker_name": "anon",
        "npending": 2,
        "pending": {
            "1": {
                "id": 1,
                "task": "/tmp/file1"
            },
            "2": {
                "id": 2,
                "task": "/tmp/file2"
            }
        },
        "queued": [
            {
                "id": 3,
                "task": "/tmp/file3"
            },
            {
                "id": 4,
                "task": "/tmp/file4"
            }
        ],
        "concurrency": 2
    }

As they complete, we see tasks moving from "queued" to "pending", and completed
tasks disappear:

    task completed; queue state:
    {
        "nextid": 4,
        "worker_name": "anon",
        "npending": 1,
        "pending": {
            "3": {
                "id": 3,
                "task": "/tmp/file3"
            }
        },
        "queued": [
            {
                "id": 4,
                "task": "/tmp/file4"
            }
        ],
        "concurrency": 2
    }

When all tasks have completed, the queue state looks like it started:

    task completed; queue state:
    {
        "nextid": 4,
        "worker_name": "anon",
        "npending": 0,
        "pending": {},
        "queued": [],
        "concurrency": 2
    }


### Example 2: A simple serializer

You can use a queue with concurrency 1 and where the tasks are themselves
functions to ensure that an arbitrary asynchronous function never runs
concurrently with another one, no matter what each one does.  Since the tasks
are the actual functions to be invoked, the worker function just invokes each
one:

    var mod_vasync = require('../lib/vasync');

    var queue = mod_vasync.queue(
        function (task, callback) { task(callback); }, 1);

    queue.push(function (callback) {
    	console.log('first task begins');
    	setTimeout(function () {
    		console.log('first task ends');
    		callback();
    	}, 500);
    });

    queue.push(function (callback) {
    	console.log('second task begins');
    	process.nextTick(function () {
    		console.log('second task ends');
    		callback();
    	});
    });

This example outputs:

    $ node examples/queue-serializer.js 
    first task begins
    first task ends
    second task begins
    second task ends
