# Investigation Report

## Investigation Report: DarkMode Tests Failing Due to DOM State Pollution

### What Was Inspected
1. **DarkMode test file** (`src/components/DarkMode.test.tsx`) - Contains 3 tests across 2 describe blocks
2. **Test utilities** (`src/utils/test-utils.tsx`) - Renders components wrapped in `DarkModeContextProvider`
3. **DarkMode component** (`src/components/DarkMode.tsx`) - Displays light/dark state with toggle button
4. **DarkModeContext** (`src/context/DarkModeContext.tsx`) - React context provider for dark mode state
5. **Vitest setup** (`vitest.setup.ts`) - Basic testing environment configuration

### Evidence of the Issue
The **missing `cleanup` call** in `vitest.setup.ts` is the root cause. The test file imports `cleanup` from `@testing-library/react` but:
- It's never called in the test setup file
- Tests do not manually call `cleanup` after each test
- No global test hooks (`afterEach`, `afterAll`) are configured to clean up the DOM

Testing-library's `cleanup` function is essential for removing mounted components from the DOM after each test to ensure test isolation. Without it, DOM elements (like the "Toggle" button text or light/dark messages) from previous tests remain mounted, causing:
- False positives in `querySelector` calls (`screen.queryByText()` may find stale elements)
- State pollution between tests (Context providers retain state)
- Unexpected behavior in subsequent tests

### Root Cause
The `vitest.setup.ts` file is missing the automatic DOM cleanup configuration. The standard pattern for Testing Library with Vitest requires either:
1. Calling `cleanup` after each test, or
2. Configuring Vitest to automatically clean up between tests

### Required Fix
Add automatic cleanup to `vitest.setup.ts`:

```typescript
import "@testing-library/jest-dom";
import { afterAll } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

Or configure it via Vitest's DOM environment settings.

The reported failure (DarkMode tests failing due to previous test suite DOM remaining mounted) is confirmed as the actual issue—DOM cleanup is not being performed between tests.
