# Investigation Report

The average() function in src/average.js incorrectly computes the average by adding numbers.length to the sum instead of dividing the sum by numbers.length. This is evident from the implementation line `return sum + numbers.length;`. The test failures consistently show results equal to (sum + length) rather than (sum / length): [10,20,30] → sum=60, length=3, result=63 (expected 20); [100] → sum=100, length=1, result=101 (expected 100); [-10,0,10] → sum=0, length=3, result=3 (expected 0). The fix is to change the arithmetic operator from '+' to '/'.
