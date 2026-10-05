# Investigation Report

## Investigation Report: DarkMode Tests Failing Due to DOM State Persistence

### What Was Inspected

1. **DarkMode Component** (`src/components/DarkMode.tsx`): A React component that displays current dark mode state and provides a toggle button.

2. **DarkMode Context** (`src/context/DarkModeContext.tsx`): React context that manages dark mode state with a provider component.

3. **Test Utilities** (`src/utils/test-utils.tsx`): Contains `renderWithContext` helper that wraps components with `DarkModeContextProvider`.

4. **DarkMode Tests** (`src/components/DarkMode.test.tsx`): Contains 3 tests:
   - Test for "light" mode display
   - Test for "dark" mode display  
   - Test for toggle functionality

5. **Test Setup** (`vitest.setup.ts`): Configures React ACT environment but does not include test cleanup setup.

### Evidence of the Issue

The test file imports `cleanup` from `@testing-library/react` but **never calls `cleanup()`** after tests. According to React Testing Library documentation, `cleanup()` is required to unmount rendered components and prevent DOM state from persisting between tests.

The test file structure shows:

- Test 1: renders with mocked context → expects "light" text
- Test 2: renders with mocked context → expects "dark" text  
- Test 3: renders without mocked context → expects toggle functionality

When tests run in sequence, components from previous tests remain mounted because `cleanup()` is not called. This causes DOM state pollution where:
- Event listeners from previous tests may still be active
- Context state may leak between tests
- DOM queries (`screen.getByText`, `screen.queryByText`) may match elements from previous tests instead of the current test's component

Additionally, the mock for `useDarkModeContext` in the first two tests uses `mockReturnValueOnce`, but if tests don't clean up properly, these mocks may persist and affect subsequent tests.

### Root Cause

**Missing test cleanup**: The test file imports `cleanup` but never invokes it after each test. In React Testing Library, `cleanup()` must be called (typically via `afterEach(cleanup)` or manually after each test) to unmount React trees and clear the DOM between tests.

Without cleanup:
- Previous test DOM nodes remain in the document
- Mock implementations may leak between tests
- Context provider state may persist
- Subsequent tests find unexpected elements in the DOM

This explains why tests fail "because rendered DOM from previous test suites remains mounted" - the test environment is not being reset between individual tests.
