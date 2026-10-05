# Investigation Report

I'll provide my investigation report now based on the evidence collected.

## Investigation Report: DarkMode Tests Failing Due to DOM State Leakage

### What Was Inspected

1. **DarkMode test file** (`src/components/DarkMode.test.tsx`) - Contains 3 tests:
   - A test for "light" state
   - A test for "dark" state  
   - A test for toggling dark mode

2. **Test utilities** (`src/utils/test-utils.tsx`) - Shows tests are rendered with `DarkModeContextProvider`

3. **DarkMode component** (`src/components/DarkMode.tsx`) - Renders text showing current mode and a toggle button

4. **DarkModeContext** (`src/context/DarkModeContext.tsx`) - Uses React's `useState` for state management

5. **Vitest setup** (`vitest.setup.ts`) - Only configures React ACT environment

### Issue Analysis

The problem is clear: **the DarkMode tests are not using the `cleanup` function from `@testing-library/react`**. While the test file imports `cleanup`, it's never actually called.

In React Testing Library, when components are rendered without cleanup, DOM elements from previous tests remain mounted. This causes:

1. **State leakage**: The `DarkModeContextProvider` maintains its state across tests
2. **DOM contamination**: Previous test's DOM elements persist
3. **Test interference**: Tests can see elements from other tests (e.g., `queryByText` returning unexpected elements)

### Root Cause

The tests lack proper cleanup between test cases. The `cleanup` function should be called after each test to unmount rendered components and clear the DOM.

### Evidence

- The test file imports `cleanup` but never calls it
- Each test renders `<DarkMode />` with `renderWithContext` which wraps in a provider
- The provider maintains internal state via `useState` - without cleanup, this state persists
- Without cleanup, DOM queries like `screen.getByText()` and `screen.queryByText()` may find elements from previous tests

### Why This Causes Failures

In the "light" test, if a previous test rendered "dark" content that wasn't cleaned up, `screen.queryByText(/dark/)` might find that leftover element instead of null, causing the assertion to fail.

---

**Recommendation**: Add `cleanup()` calls (either manually after each test or via `afterEach(cleanup)`) to ensure each test runs with a clean DOM.
