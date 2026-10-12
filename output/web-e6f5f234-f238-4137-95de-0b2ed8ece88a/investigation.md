# Investigation Report

Investigated the average function implementation. The bug is in src/average.js: it returns sum + numbers.length instead of sum / numbers.length. This explains all three failing tests: the results are inflated by adding instead of dividing by the count. The empty array case passes only because 0 + 0 = 0, but the division operation is missing entirely.
