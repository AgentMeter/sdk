---
description: Testing conventions — Vitest, MSW v2, React Testing Library
---

# Testing

- Write tests for new code
- Use `vi.fn()`, `vi.spyOn()`, `vi.mock()` — **never** `jest.fn()` or `jest.spyOn()`
- Vitest is the test runner; do not import from `jest`
- MSW v2 for API mocking in `apps/web`
- Test factories available: `createMockRun`, `createMockTokens`, `createMockOrg`, `createMockRepo`
