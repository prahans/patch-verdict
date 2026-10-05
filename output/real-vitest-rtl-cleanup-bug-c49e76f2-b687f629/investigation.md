# Investigation Report

Inspected DarkMode tests and surrounding code. Tests in DarkMode.test.tsx do not call cleanup() after rendering components, so DOM elements from prior tests remain mounted. The renderWithContext helper uses @testing-library/react's render without cleanup, and vitest.setup.ts does not configure automatic cleanup. As a result, subsequent tests observe stale DOM state, causing false positives or failures when querying for elements with screen.getByText or screen.queryByText. The root cause is missing DOM cleanup between tests.
