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

JSDoc block above every function/component — no `@param`/`@returns` tags; TypeScript is the source of truth. Document each param inline in the type. Also do the same for `interface` and `type` declarations.

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

/**
 * Represents an animal of the feline species
 */
interface Cat {
  /** The color of the fur **/
  color: string;

  /** The weight in pounds **/
  weight: number;
}

/**
 * Represents an animal within our system
 */
type Animal = {
  /** The id of the animal in our system **/
  id: string;

  /** The type of animal **/
  type: Cat | Dog;
};
```
