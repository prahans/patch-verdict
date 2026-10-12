# Investigation Report

The 'average' function in src/average.js incorrectly computes the result by adding the array length to the sum (sum + numbers.length) instead of dividing the sum by the length (sum / numbers.length). This explains all three failing tests: for [10,20,30] it returns 63 instead of 20, for [100] it returns 101 instead of 100, and for [-10,0,10] it returns 3 instead of 0.
