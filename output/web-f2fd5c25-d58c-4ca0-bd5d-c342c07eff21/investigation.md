# Investigation Report

Investigated the average function failure. The implementation in src/average.js incorrectly computes sum + numbers.length instead of sum / numbers.length. This explains all three failing tests: for [10,20,30] it returns 63 instead of 20, for [100] it returns 101 instead of 100, and for [-10,0,10] it returns 3 instead of 0. The only file requiring modification is src/average.js, where the arithmetic operation must be changed from addition to division.
