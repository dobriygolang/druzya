// Caret — small chevron used inside pills (model, persona) to hint
// at a dropdown. When the parent dropdown is open, pass `open` to
// rotate 180° with a matched-ease transition so the user gets
// unambiguous affordance feedback.

interface Props {
  /** True while the associated dropdown is open — rotates chevron up. */
  open?: boolean;
  size?: number;
  /** Optional colour override; default inherits from text. */
  color?: string;
}

export function Caret({ open, size = 8, color }: Props) {
  return (
    <svg
      width={size}
      height={(size * 5) / 8}
      viewBox="0 0 8 5"
      fill="none"
      style={{
        opacity: 0.55,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform var(--d9-dur-hover) var(--d9-ease)',
        color,
      }}
    >
      <path
        d="M1 1L4 4L7 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
