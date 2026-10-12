# Investigation Report

Inspected src/average.js and src/average.test.js. The average function incorrectly computes the result by adding numbers.length to the sum instead of dividing the sum by numbers.length. This explains all three failing tests: for [10,20,30] it returns 63 instead of 20, for [100] it returns 101 instead of 100, and for [-10,0,10] it returns 3 instead of 0. The root cause is isolated to src/average.js and it is the only relevant file.
