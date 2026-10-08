# Investigation Report

Investigated the average function failure. Inspected src/average.js and found the bug: the implementation incorrectly returns `sum + numbers.length` instead of `sum / numbers.length`. This explains all observed failures: the function adds the array length instead of dividing by it. The empty-array case works correctly (returns 0), but all non-empty cases produce wrong results. The authoritative baseline test output confirms the same pattern (63 vs 20, 101 vs 100, 3 vs 0). The correct fix is to change the return statement to divide the sum by the array length.
