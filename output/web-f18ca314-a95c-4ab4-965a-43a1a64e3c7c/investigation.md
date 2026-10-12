# Investigation Report

Investigated src/average.js and src/average.test.js. The implementation incorrectly computes the average by adding the sum and length (sum + numbers.length) instead of dividing (sum / numbers.length). All three failing tests confirm this arithmetic error: for [10,20,30] sum=60, length=3, result=63 (wrong) instead of 20 (correct); for [100] sum=100, length=1, result=101 (wrong) instead of 100; for [-10,0,10] sum=0, length=3, result=3 (wrong) instead of 0. The root cause is the buggy line using addition instead of division. The fix is clearly in src/average.js.
