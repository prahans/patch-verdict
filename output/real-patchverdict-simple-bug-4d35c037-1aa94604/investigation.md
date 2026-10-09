# Investigation Report

Inspected src/average.js and src/average.test.js. The average function incorrectly returns sum + numbers.length instead of sum / numbers.length. This explains all three failing tests: for [10,20,30] it returns 60+3=63 (expected 20), for [100] it returns 100+1=101 (expected 100), and for [-10,0,10] it returns 0+3=3 (expected 0). The empty array case passes only because it returns early with 0. The root cause is the arithmetic operator + used instead of / for division.
