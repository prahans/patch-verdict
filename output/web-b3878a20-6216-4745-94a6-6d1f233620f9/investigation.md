# Investigation Report

Investigated src/average.js and src/average.test.js. The average function incorrectly computes `sum + numbers.length` instead of `sum / numbers.length`. This single-line bug explains all three failing tests: it returns 63 instead of 20 for [10,20,30], 101 instead of 100 for [100], and 3 instead of 0 for [-10,0,10]. The fix is to change the operator from '+' to '/' in the return statement.
