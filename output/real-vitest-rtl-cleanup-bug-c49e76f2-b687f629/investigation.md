# Investigation Report

# Investigation Report: DarkMode Tests Failing Due to DOM State Contamination

## What Was Inspected

1. **DarkMode test file** (`src/components/DarkMode.test.tsx`) - Contains 3 tests across 2 describe blocks
2. **DarkMode component** (`src/components/DarkMode.tsx`) - Renders current mode and toggle button
3. **DarkMode context** (`src/context/DarkModeContext.tsx`) - React context for dark mode state management
4. **Test utilities** (`src/utils/test-utils.tsx`) - Provides `renderWithContext` helper
5. **Vitest setup** (`vitest.setup.ts`) - Contains React ACT environment configuration

## Evidence Collected

### Test Structure Issues
The test file has a critical structural problem:

- There's a `describe("displays current dark mode", ...)` block with 2 tests
- Followed by a standalone `test("toggles dark mode", ...)` test
- All tests use `renderWithContext()` which wraps components in `DarkModeContextProvider`
- **No cleanup is performed between tests** - the `cleanup` function from `@testing-library/react` is imported but never called

### DOM State Contamination Mechanism

When React components render, they can leave behind:
- DOM elements (buttons, divs, text nodes)
- React component instances with their own state
- Event listeners attached to the DOM

Without calling `cleanup()` after each test, these elements remain mounted in the test DOM, causing:
- Duplicate element IDs when tests rerender
- Memory leaks between tests
- Conflicting state from previous renders
- Queries like `getByText()` and `queryByText()` potentially matching stale elements from previous tests

### Root Cause

The **primary root cause** is that the tests never call `cleanup()` to remove the mounted components from the DOM between tests. While `@testing-library/react`'s `render()` function returns a `cleanup` function, it's not being invoked in the test suite.

The `cleanup` import suggests awareness of the need, but it's unused. Each test should end with `cleanup()` or use `render`'s return value to call cleanup, ensuring a fresh DOM for subsequent tests.

## Reproduction Evidence

The test structure shows:
1. First two tests mock the context differently and expect different text content
3. Third test renders without explicit mocking (using default state)
4. Without cleanup, the third test's DOM would contain remnants of previous renders

This explains why DarkMode tests fail - they're not truly isolated and the DOM accumulates state from previous test runs.

## Likely Root Cause

**Missing `cleanup()` calls between tests** - Each test that uses `renderWithContext()` should ensure the DOM is cleaned up after completion. The tests import `cleanup` but never invoke it, allowing DOM elements from previous tests to remain mounted and interfere with subsequent test execution.

The test file appears to be written with the intention to use cleanup (as evidenced by the import), but the implementation is incomplete.
