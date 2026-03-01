# Frontend Design

Use this skill when implementing UI designs, building design systems, or making visual and layout decisions in frontend code.

## Layout

- Use CSS Grid for two-dimensional layouts; Flexbox for one-dimensional alignment.
- Design mobile-first — start with the smallest viewport and layer on complexity.
- Use relative units (`rem`, `em`, `%`, `vw`/`vh`) over fixed `px` for responsive behavior.
- Establish a spacing scale (4px/8px base) and use it consistently — avoid magic numbers.

## Typography

- Limit typefaces to 2–3 per project; use font weight and size for hierarchy, not more fonts.
- Set a modular type scale (e.g., 1.25 ratio) for consistent heading/body relationships.
- Ensure body text is 16px minimum; line-height of 1.5–1.75 for readability.
- Use `rem` for font sizes so the layout respects user browser settings.

## Color

- Define a palette with semantic tokens: `--color-primary`, `--color-surface`, `--color-error`, etc.
- Ensure WCAG AA contrast minimums: 4.5:1 for normal text, 3:1 for large text.
- Support light and dark modes from the start — use CSS custom properties for theming.
- Avoid pure black on pure white; slightly warm or cool neutrals reduce eye strain.

## Component Styling

- Prefer CSS Modules, Tailwind CSS, or CSS-in-JS with co-located styles — avoid global CSS.
- Follow BEM or utility-class conventions consistently within a project.
- Keep specificity low — avoid `!important` and deeply nested selectors.
- Use design tokens (variables) for all shared values: colors, spacing, radii, shadows.

## Responsive Design

- Use container queries where supported for component-level responsiveness.
- Breakpoints should follow content needs, not device names.
- Test at every width, not just preset breakpoints — fluid layouts should never break.
- Images must be responsive: use `srcset`, `sizes`, and modern formats (WebP, AVIF).

## Accessibility

- Every interactive element must be keyboard-navigable and have a visible focus indicator.
- Use semantic HTML elements (`button`, `nav`, `main`, `dialog`) before adding ARIA roles.
- Provide `alt` text for informational images; use empty `alt=""` for decorative ones.
- Ensure touch targets are at least 44×44px on mobile.
- Test with a screen reader (VoiceOver, NVDA) — don't rely on visual inspection alone.

## Motion and Animation

- Respect `prefers-reduced-motion` — disable or simplify animations for users who request it.
- Keep transitions under 300ms for micro-interactions; 500ms max for page transitions.
- Use CSS transitions and animations over JavaScript where possible for better performance.
- Animate `transform` and `opacity` — avoid animating `width`, `height`, or `top`/`left`.

## Design System Integration

- Consume tokens and components from the design system — don't duplicate or override.
- If a component doesn't exist, propose it to the design system rather than building a one-off.
- Keep naming consistent between design tools (Figma) and code (`Button`, `Card`, `Badge`).
- Document component variants, states (hover, active, disabled, error), and slot/composition APIs.

## Anti-Patterns to Avoid

- Don't use pixel-perfect matching as the goal — responsive behavior and accessibility matter more.
- Don't override framework component styles with global CSS or `!important`.
- Don't rely on color alone to convey information (error states, status indicators).
- Don't ship without testing on real devices — emulators miss touch behavior and font rendering.
- Don't add z-index arbitrarily — maintain a documented z-index scale.
