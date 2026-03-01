# React Best Practices

Use this skill when building, reviewing, or refactoring React components and applications.

## Component Design

- Prefer function components with hooks over class components.
- Keep components small and focused — one responsibility per component.
- Extract custom hooks when stateful logic is shared across components.
- Co-locate related files: component, styles, tests, and types together.

## State Management

- Use `useState` for local UI state, `useReducer` for complex state transitions.
- Lift state only as high as necessary — avoid prop drilling by using context or composition.
- Prefer server state libraries (React Query, SWR) over manual `useEffect` + `useState` for API data.
- Never mutate state directly — always return new references.

## Performance

- Memoize expensive computations with `useMemo`; memoize callbacks with `useCallback` only when passed to memoized children.
- Avoid premature optimization — profile before adding `React.memo`, `useMemo`, or `useCallback`.
- Use lazy loading (`React.lazy` + `Suspense`) for route-level code splitting.
- Keep component tree depth shallow to reduce re-render cascades.

## Hooks

- Follow the Rules of Hooks: only call at the top level, only call from React functions.
- Custom hooks should start with `use` and encapsulate a single concern.
- Clean up side effects: return a cleanup function from `useEffect`.
- Specify exhaustive dependency arrays — avoid disabling the lint rule.

## Patterns to Follow

- Use composition over inheritance — render props and children patterns.
- Prefer controlled components for forms; use `defaultValue` only for truly uncontrolled inputs.
- Handle loading, error, and empty states explicitly in every data-fetching component.
- Use `key` props correctly: stable, unique identifiers — never array indices for dynamic lists.

## Anti-Patterns to Avoid

- Don't use `useEffect` for derived state — compute it during render instead.
- Don't store props in state unless you need to track a snapshot at a point in time.
- Don't create components inside render functions — define them at module scope.
- Don't use `forceUpdate` or direct DOM manipulation to work around React's model.
- Don't wrap every component in `React.memo` — only memoize when profiling shows it helps.

## Testing

- Test behavior, not implementation: assert what the user sees and does.
- Use React Testing Library — query by role, label, or text, not by class or test ID.
- Test user interactions with `userEvent` rather than `fireEvent`.
- Mock external dependencies (API calls, timers) but not the component itself.

## TypeScript

- Type props explicitly with `interface` — prefer named interfaces over inline types.
- Use `React.FC` sparingly; prefer explicit return types on functions.
- Use discriminated unions for component variants instead of boolean prop soup.
- Type event handlers with React's built-in event types (`React.ChangeEvent<HTMLInputElement>`).
