type IconProps = {
  className?: string;
};

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false
} as const;

export function SearchIcon({ className = 'tool-icon-svg' }: IconProps) {
  return (
    <svg className={className} {...iconProps}>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function GuestbookIcon({ className = 'tool-icon-svg' }: IconProps) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M5 4.75h10.5a3.5 3.5 0 0 1 3.5 3.5v11H8.5A3.5 3.5 0 0 1 5 15.75z" />
      <path d="M8 8h7" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

export function SettingsIcon({ className = 'tool-icon-svg' }: IconProps) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 12h3" />
      <path d="M11 12h9" />
      <circle cx="9" cy="12" r="2" />
      <path d="M4 17h11" />
      <path d="M19 17h1" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}
