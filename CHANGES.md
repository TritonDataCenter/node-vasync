# Changelog

## Not yet released

None yet.

## v2.0.0

**Breaking Changes:**

* The `waterfall` function's terminating callback no longer receives a
  status-object as its second argument. This is the behavior of `node-async`
  and we wish to match it as closely as possible. If you used the second
  argument of waterfall's terminating callback (instead of waterfall's return
  value) to extract job-statuses, this will break you. More specifically, this
  is only true if you called `waterfall` on an empty array of function.

**Other Changes:**

* #32 Would like a tryEach function.

## v1 and earlier

Major version 1 and earlier did not have their changes logged in a changelog.
