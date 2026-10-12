# Investigation Report

Inspected src/average.js and found that the function computes the sum correctly using reduce, but then incorrectly returns sum + numbers.length instead of sum / numbers.length. This explains all three failing tests: [10,20,30] yields 63 instead of 20, [100] yields 101 instead of 100, and [-10,0,10] yields 3 instead of 0. The targeted test run confirmed the same failure pattern. The root cause is the use of addition instead of division in the return statement.
