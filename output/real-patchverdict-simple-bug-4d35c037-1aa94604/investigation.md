# Investigation Report

Inspected src/average.js and src/average.test.js. The implementation incorrectly returns sum + numbers.length instead of sum / numbers.length, causing all non-empty-array tests to fail. The empty-array case passes because it relies on the correct early return. The root cause is an arithmetic error: addition instead of division. The only file requiring modification is src/average.js, where the return expression must be changed from sum + numbers.length to sum / numbers.length.
