interface ResonaAppmarkProps {
  className?: string;
  size?: number;
}

export function ResonaAppmark({ className, size = 36 }: ResonaAppmarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 240 240"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="resona-bg" x1="0" y1="0" x2="240" y2="240">
          <stop offset="0%" stopColor="#0E7C86" />
          <stop offset="45%" stopColor="#0B3A44" />
          <stop offset="100%" stopColor="#04171C" />
        </linearGradient>
        <linearGradient id="resona-leaf" x1="0.2" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#9AF0C8" />
          <stop offset="55%" stopColor="#5FD3A0" />
          <stop offset="100%" stopColor="#2A9D62" />
        </linearGradient>
        <linearGradient id="resona-wave" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BFEFD6" />
          <stop offset="100%" stopColor="#57C6D6" />
        </linearGradient>
      </defs>
      <rect width="240" height="240" rx="54" fill="url(#resona-bg)" />
      <rect
        x="8"
        y="8"
        width="224"
        height="224"
        rx="48"
        fill="none"
        stroke="rgba(127,230,182,0.22)"
        strokeWidth="2"
      />
      <g transform="translate(120 118)">
        <path
          d="M0,-52 C28,-34 34,8 0,46 C-34,8 -28,-34 0,-52 Z"
          fill="url(#resona-leaf)"
          stroke="#062018"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M0,-38 C8,-28 10,-8 0,8 C-10,-8 -8,-28 0,-38 Z"
          fill="rgba(255,255,255,0.12)"
        />
        <g stroke="url(#resona-wave)" strokeWidth="3.2" strokeLinecap="round">
          <line x1="-22" y1="14" x2="-22" y2="2" opacity="0.85" />
          <line x1="-14" y1="18" x2="-14" y2="-4" opacity="0.95" />
          <line x1="-6" y1="22" x2="-6" y2="-10" />
          <line x1="2" y1="24" x2="2" y2="-14" />
          <line x1="10" y1="22" x2="10" y2="-10" />
          <line x1="18" y1="18" x2="18" y2="-4" opacity="0.95" />
          <line x1="26" y1="14" x2="26" y2="2" opacity="0.85" />
        </g>
      </g>
    </svg>
  );
}
