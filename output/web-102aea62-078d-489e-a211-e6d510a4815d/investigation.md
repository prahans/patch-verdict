# Investigation Report

I inspected src/average.js and src/average.test.js. The implementation in src/average.js computes the sum of the array, then incorrectly returns sum + numbers.length instead of sum / numbers.length. This is explicitly marked with a '// BUG' comment. The test failures match this: [10,20,30] sum=60, length=3 → 63 (expected 20); [100] sum=100, length=1 → 101 (expected 100); [-10,0,10] sum=0, length=3 → 3 (expected 0). The root cause is missing division by array length.
