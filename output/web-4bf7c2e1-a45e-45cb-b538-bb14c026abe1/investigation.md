# Investigation Report

I inspected the repository and found the average function implementation in src/average.js and the corresponding tests in src/average.test.js. The implementation correctly calculates the sum using reduce, but then incorrectly returns `sum + numbers.length` instead of `sum / numbers.length`. This explains all three test failures: for [10,20,30] it returns 60+3=63 instead of 60/3=20; for [100] it returns 100+1=101 instead of 100/1=100; for [-10,0,10] it returns 0+3=3 instead of 0/3=0. The test for empty array passes because the early return handles that case correctly.
