import { useState } from 'react';
import { Music } from 'lucide-react';

const LOGO_SRC = '/assets/aistudio/6e54ed49-2b79-49f5-83d2-7db00fdbbc02_bce06b15.png';

interface BrandLogoProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export function BrandLogo({ size = 'sm', className = '' }: BrandLogoProps) {
  const [imgError, setImgError] = useState(false);

  const dims = size === 'lg' ? 'w-20 h-20' : 'w-11 h-11';

  if (imgError) {
    return (
      <span
        aria-label="Anson Practice Piano"
        className={`inline-flex items-center justify-center rounded-full bg-slate-900 text-emerald-400 shrink-0 ${dims} ${className}`}
      >
        <Music className={size === 'lg' ? 'w-9 h-9' : 'w-5 h-5'} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={`inline-block rounded-full overflow-hidden bg-[#222629] ring-1 ring-slate-200/80 shrink-0 ${dims} ${className}`}
    >
      <img
        src={LOGO_SRC}
        alt="Anson Practice Piano"
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className="w-full h-full object-cover scale-[1.16]"
      />
    </span>
  );
}
