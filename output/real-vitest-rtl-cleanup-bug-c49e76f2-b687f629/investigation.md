# Investigation Report

# Investigation Report: DarkMode Tests Failing Due to DOM State Pollution

## What Was Inspected

I examined the following files:

1. **Test file** (`src/components/DarkMode.test.tsx`) - Contains DarkMode tests
2. **Test utilities** (`src/utils/test-utils.tsx`) - Custom render function
3. **Context provider** (`src/context/DarkModeContext.tsx`) - DarkModeContext implementation
4. **Component** (`src/components/DarkMode.tsx`) - The actual DarkMode component
5. **Vitest setup** (`vitest.setup.ts`) - Test configuration

## Issue Analysis

### Observed Evidence

The DarkMode test suite has three issues that indicate DOM state is persisting between tests:

1. **No cleanup mechanism in test setup** - `vitest.setup.ts` has no `beforeEach` or `afterEach` cleanup calls
2. **Custom `renderWithContext` doesn't include cleanup** - The `renderWithContext` function in `test-utils.tsx` only renders with the provider but doesn't handle cleanup
3. **Missing cleanup calls in tests** - The DarkMode test file only calls `cleanup` in the first test description block (line 4), but this only calls `render`'s cleanup, not the context cleanup

### Root Cause

The tests are failing because React DOM elements from previous tests remain mounted. The testing library's `cleanup` function is called, but it appears to be called inconsistently:

- In the first test (`"light"`), `cleanup` is imported but not called after the test
- The second test (`"dark"`) and the standalone test don't call cleanup at all
- The `renderWithContext` function doesn't return the cleanup function from `render`, making manual cleanup necessary

The actual issue is that the tests are not properly cleaning up the DOM between tests. When React tests run without proper cleanup, the DOM from previous tests can persist and interfere with subsequent tests, especially when testing UI that depends on context providers.

### Supporting Evidence

1. **Missing cleanup calls** - Only `cleanup` is imported but not used consistently
2. **Context provider persistence** - The `DarkModeContextProvider` maintains state across tests if the DOM isn't properly cleaned
3. **Test file structure** - The test file uses `vi.mock()` which should reset between tests, but DOM manipulation state isn't being cleaned

## Likely Root Cause

The DarkMode tests fail because:

1. The tests import `cleanup` from `@testing-library/react` but don't consistently call it after each test
2. The `renderWithContext` helper doesn't automatically return or enforce cleanup
3. When tests run, the DOM from previous tests remains mounted, causing:
   - Duplicate element ID conflicts
   - State pollution in the DarkModeContext
   - Incorrect query results from `screen.getByText` and `screen.queryByText`

Without proper cleanup between tests, the `DarkModeContext` state from one test can affect subsequent tests, causing the DOM queries to find elements that shouldn't be there or miss elements that should be present.
