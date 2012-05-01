# vasync: utilities for observable asynchronous control flow

This module provides facilities for asynchronous control flow.  There are many
modules that do this already (notably async.js).  This one's claim to fame is
aided debuggability: each of the contained functions return a "status" object
with the following fields:

    operations          array corresponding to the input functions, with

            func            input function

            status          "pending", "ok", or "fail"

            err             returned "err" value, if any

            result          returned "result" value, if any

    successes		"result" field for each of "operations" where
    			"status" == "ok"

    ndone               number of input operations that have completed

    nerrors             number of input operations that have failed

You can use this from a debugger (or your own monitoring code) to understand
the state of an ongoing asynchronous operation.  For example, you could see how
far into a pipeline some particular operation is.


## parallel(args, callback): invoke N functions in parallel and merge the results

This function takes a list of input functions (specified by the "funcs" property
of "args") and runs them all.  These input functions are expected to be
asynchronous: they get a "callback" argument and should invoke it as
callback(err, result).  The error and result will be saved and made available to
the original caller when all of these functions complete.

All errors are combined into a single "err" parameter to the final callback (see
below).  You can also observe the progress of the operation as it goes by
examining the object returned synchronously by this function.

Example usage:

    status = mod_vasync.parallel({
        'funcs': [
             function f1 (callback) { mod_fs.stat('/tmp', callback); },
             function f2 (callback) { mod_fs.stat('/noexist', callback); },
             function f3 (callback) { mod_fs.stat('/var', callback); }
        ]
    }, function (err, results) {
            console.log('error: %s', err.message);
            console.log('results: %s', mod_util.inspect(results, null, 3));
    });

    console.log('status: %s', mod_sys.inspect(status, null, 3));

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

    error: first of 1 error: ENOENT, no such file or directory '/noexist'

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
           status: 'ok',
           err: null,
           result: 
            { dev: 140247096,
              ino: 879368309,
              mode: 17407,
              nlink: 9,
              uid: 0,
              gid: 3,
              rdev: 0,
              size: 754,
              blksize: 4096,
              blocks: 8,
              atime: Thu, 12 Apr 2012 23:18:57 GMT,
              mtime: Tue, 17 Apr 2012 23:56:34 GMT,
              ctime: Tue, 17 Apr 2012 23:56:34 GMT } },
         { func: [Function: f2],
           status: 'fail',
           err: { [Error: ENOENT, no such file or directory '/noexist'] errno: 34, code: 'ENOENT', path: '/noexist' },
           result: undefined },
         { func: [Function: f3],
           status: 'ok',
           err: null,
           result: 
            { dev: 23658528,
              ino: 5,
              mode: 16877,
              nlink: 27,
              uid: 0,
              gid: 0,
              rdev: -1,
              size: 27,
              blksize: 2560,
              blocks: 3,
              atime: Fri, 09 Sep 2011 14:28:55 GMT,
              mtime: Wed, 04 Apr 2012 17:51:20 GMT,
              ctime: Wed, 04 Apr 2012 17:51:20 GMT } } ],
      successes: 
       [ { dev: 234881026,
           ino: 24965,
           mode: 17407,
           nlink: 8,
           uid: 0,
           gid: 0,
           rdev: 0,
           size: 272,
           blksize: 4096,
           blocks: 0,
           atime: Tue, 01 May 2012 16:02:24 GMT,
           mtime: Tue, 01 May 2012 19:10:35 GMT,
           ctime: Tue, 01 May 2012 19:10:35 GMT },
         { dev: 234881026,
           ino: 216,
           mode: 16877,
           nlink: 26,
           uid: 0,
           gid: 0,
           rdev: 0,
           size: 884,
           blksize: 4096,
           blocks: 0,
           atime: Tue, 01 May 2012 16:02:24 GMT,
           mtime: Fri, 14 Aug 2009 21:23:03 GMT,
           ctime: Thu, 28 Oct 2010 21:51:39 GMT } ],
      ndone: 3,
      nerrors: 1 }

You can use this if you want to handle all of the errors individually or to get
at all of the individual return values.


## forEachParallel(args, callback): invoke the same function on N inputs in parallel

This function is exactly like `parallel`, except that the input is specified as
a *single* function ("func") and a list of inputs ("inputs").  The function is
invoked on each input in parallel.

This example is exactly equivalent to the one above:

    mod_vasync.forEachParallel({
        'func': mod_fs.stat,
        'inputs': [ '/var', '/nonexistent', '/tmp' ]
    }, function (err, results) {
        console.log('error: %s', err.message);
        console.log('results: %s', mod_util.inspect(results, null, 3));
    });


## pipeline(args, callback): invoke N functions in series (and stop on failure)

The arguments for this function are:

* funcs: input functions, to be invoked in series
* arg: arbitrary argument that will be passed to each function

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

(Note that the second and third stages are now "waiting", rather than "pending"
in the `parallel` case.)  The error reported is:

    error: ENOENT, no such file or directory '/noexist'

and the complete result is:

    results: { operations: 
       [ { func: [Function: f1],
           status: 'ok',
           err: null,
           result: 
            { dev: 140247096,
              ino: 879368309,
              mode: 17407,
              nlink: 9,
              uid: 0,
              gid: 3,
              rdev: 0,
              size: 754,
              blksize: 4096,
              blocks: 8,
              atime: Thu, 12 Apr 2012 23:18:57 GMT,
              mtime: Tue, 17 Apr 2012 23:56:34 GMT,
              ctime: Tue, 17 Apr 2012 23:56:34 GMT } },
         { func: [Function: f2],
           status: 'fail',
           err: { [Error: ENOENT, no such file or directory '/noexist'] errno: 34, code: 'ENOENT', path: '/noexist' },
           result: undefined },
         { func: [Function: f3], status: 'waiting' } ],
      successes: 
       [ { dev: 234881026,
           ino: 24965,
           mode: 17407,
           nlink: 8,
           uid: 0,
           gid: 0,
           rdev: 0,
           size: 272,
           blksize: 4096,
           blocks: 0,
           atime: Tue, 01 May 2012 16:02:24 GMT,
           mtime: Tue, 01 May 2012 19:10:35 GMT,
           ctime: Tue, 01 May 2012 19:10:35 GMT } ],
      ndone: 2,
      nerrors: 1 }
