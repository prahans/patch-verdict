# Investigation Report

The average function in src/average.js incorrectly uses addition instead of division. The return statement 'return sum + numbers.length;' adds the array length instead of dividing the sum by the length. This explains all failing tests: [10,20,30] returns 63 instead of 20, [100] returns 101 instead of 100, and [-10,0,10] returns 3 instead of 0. The empty array case passes because the early return bypasses the buggy line.
