import React from 'react';
import { LandingHeader } from './LandingHeader.tsx';
import { LandingHero } from './LandingHero.tsx';
import { LandingHeroIllustration } from './LandingHeroIllustration.tsx';
import { LandingHowItWorks } from './LandingHowItWorks.tsx';
import { LandingFeatures } from './LandingFeatures.tsx';
import { LandingCta } from './LandingCta.tsx';
import { LandingFooter } from './LandingFooter.tsx';

export interface LandingViewProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  onGetStarted,
  onSignIn,
}) => {
  return (
    <div
      tabIndex={-1}
      className="min-h-screen w-full flex flex-col bg-gradient-to-br from-[var(--canvas-from)] to-[var(--canvas-to)] text-[var(--ink)] outline-none"
    >
      <LandingHeader onGetStarted={onGetStarted} onSignIn={onSignIn} />

      <main id="main-content" className="flex-1 flex flex-col items-center">
        <LandingHero
          onGetStarted={onGetStarted}
          illustration={<LandingHeroIllustration />}
        />
        <LandingHowItWorks />
        <LandingFeatures />
        <LandingCta
          onGetStarted={onGetStarted}
        />
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingView;
