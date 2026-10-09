# Investigation Report

Investigated the average function bug. The implementation in src/average.js incorrectly computes the average by returning sum + numbers.length instead of sum / numbers.length. This is a straightforward arithmetic error that explains all three failing tests: [10,20,30] returns 63 (60+3) instead of 20, [100] returns 101 (100+1) instead of 100, and [-10,0,10] returns 3 (0+3) instead of 0. The empty-array case passes because it returns early with 0, bypassing the buggy line. Inspection of src/average.js confirms the root cause is the single buggy return statement.
