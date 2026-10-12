# Investigation Report

Inspected src/average.js and src/average.test.js. The implementation correctly computes the sum using reduce, but returns sum + numbers.length instead of sum / numbers.length. This explains all three failures: for [10,20,30] sum=60, 60+3=63; for [100] sum=100, 100+1=101; for [-10,0,10] sum=0, 0+3=3. The test files confirm the expected behavior. The bug is clearly in the division logic.
