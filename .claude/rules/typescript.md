---
description: TypeScript and React code style conventions
---

# TypeScript & React

- TypeScript strict mode; explicit return types on all functions and components
- `async/await` over `.then()`; descriptive variable names
- Object params (not positional); params alphabetical
- Each function and React component in its own file when possible
- Server components by default; `'use client'` only when strictly needed
- Linting: Biome — do NOT install or reference ESLint

## JSDoc

JSDoc block above every function/component — no `@param`/`@returns` tags; TypeScript is the source of truth. Document each param inline in the type.

```typescript
/**
 * Does X for reason Y
 */
const myFunc = ({
  bar,
  foo,
}: {
  /** What bar represents */
  bar: number;
  /** What foo represents */
  foo?: string;
}): void => {};
```
