import React from 'react';

export interface LandingLogoProps {
  className?: string;
}

/**
 * CodeCollab official brand mark:
 * Two collaborative figures interlocking as code brackets with white '<' and '>' markers.
 */
export const LandingLogo: React.FC<LandingLogoProps> = ({ className = 'w-7 h-7' }) => {
  return (
    <svg
      viewBox="0 0 100 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left collaborator head */}
      <circle cx="28" cy="18" r="8.5" fill="currentColor" />

      {/* Right collaborator head */}
      <circle cx="68" cy="24" r="8.5" fill="currentColor" opacity="0.8" />

      {/* Left collaborator rounded bracket diamond */}
      <rect
        x="12"
        y="30"
        width="38"
        height="38"
        rx="10"
        transform="rotate(-20 31 49)"
        fill="currentColor"
      />

      {/* Interlocking right collaborator rounded bracket diamond */}
      <rect
        x="48"
        y="32"
        width="38"
        height="38"
        rx="10"
        transform="rotate(-20 67 51)"
        fill="currentColor"
        opacity="0.82"
      />

      {/* Center interlock separation contour */}
      <path
        d="M 43 38 C 47 43 53 50 58 56"
        stroke="var(--canvas-from, #c4c4c6)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.5"
      />

      {/* Left white code bracket '<' */}
      <path
        d="M 35 41 L 27 47 L 35 53"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Right white code bracket '>' */}
      <path
        d="M 63 45 L 71 51 L 63 57"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
