# Investigation Report

Inspected src/average.js and src/average.test.js. The implementation incorrectly computes sum + numbers.length instead of sum / numbers.length. This explains all observed failures: [10,20,30] yields 63 (60+3) instead of 20; [100] yields 101 (100+1) instead of 100; [-10,0,10] yields 3 (0+3) instead of 0. The empty-array behavior is correct (returns 0 as expected). The root cause is a typo where addition is used instead of division. The only file that needs to be modified is src/average.js, replacing the buggy line with the correct arithmetic.
