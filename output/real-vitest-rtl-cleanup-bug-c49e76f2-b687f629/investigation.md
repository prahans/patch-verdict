# Investigation Report

# Investigation Report: DarkMode Test Failure

## What Was Inspected
1. **DarkMode test file** (`src/components/DarkMode.test.tsx`) - Contains 3 tests:
   - "displays current dark mode > light"
   - "displays current dark mode > dark" 
   - "toggles dark mode"

2. **Test utilities** (`src/utils/test-utils.tsx`) - The `renderWithContext` helper renders components wrapped in `DarkModeContextProvider`

3. **DarkMode component** (`src/components/DarkMode.tsx`) - A simple component showing light/dark status with a toggle button

4. **DarkModeContext** (`src/context/DarkModeContext.tsx`) - React context provider for dark mode state

## Observed Failure
The test "displays current dark mode > dark" failed with:
```
expected <div></div> to be null
```
at line `expect(screen.queryByText(/light/)).toBeNull();`

This means the text "light" was still present in the DOM when it shouldn't have been after rendering the dark mode version.

## Root Cause Analysis
The issue is that **DOM elements from previous tests are not being cleaned up**. When the "light" test runs first, it renders content containing the text "light", but when the "dark" test runs immediately after, the "light" text persists in the DOM instead of being removed.

The root cause is that the tests are not calling `cleanup()` after each test. While the test file imports `cleanup` from `@testing-library/react`, it never actually calls it. 

The `renderWithContext` function uses `render()` from React Testing Library, which by default does not automatically clean up the DOM between renders. Without explicit cleanup, DOM nodes from previous renders remain mounted, causing DOM pollution between tests.

## Evidence Supporting Root Cause
1. The test imports `cleanup` but never uses it
2. The failing test expects `screen.queryByText(/light/)` to be null, but it's finding the text from the previous test's render
3. The error shows `<div></div>` - this suggests the container element itself remains but contains stale content

The issue affects the test structure where multiple tests in the same `describe` block run sequentially without DOM cleanup between them, causing the rendered DOM from previous tests to remain mounted and interfere with subsequent tests.
