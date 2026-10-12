import { useEffect, useState } from 'react';

const EXTENSIONS = ['jpg', 'png', 'webp', 'jpeg'];
/** Remembers which extension worked for a picture so later questions do not probe again. */
const found = new Map<string, number>();

/**
 * A Tech Faces picture. `src` has no extension (e.g. /faces/03); the first of .jpg/.png/.webp/.jpeg that exists is shown.
 * If the host has not added the photo yet, a silhouette is shown instead so the round still plays.
 */
export function FaceImage({ src, alt = 'A mystery tech personality', className = '' }: { src: string; alt?: string; className?: string }) {
  const [i, setI] = useState(found.get(src) ?? 0);
  useEffect(() => setI(found.get(src) ?? 0), [src]);

  if (i >= EXTENSIONS.length) return <Silhouette className={className} />;
  return (
    <img
      key={`${src}.${EXTENSIONS[i]}`}
      src={`${src}.${EXTENSIONS[i]}`}
      alt={alt}
      draggable={false}
      onLoad={() => found.set(src, i)}
      onError={() => setI((n) => n + 1)}
      style={{ objectPosition: '50% 20%' }}
      className={`object-cover ${className}`}
    />
  );
}

function Silhouette({ className }: { className: string }) {
  return (
    <div role="img" aria-label="Photo not added yet" className={`flex flex-col items-center justify-center gap-1 bg-gradient-to-b from-panel2 to-ink text-muted ${className}`}>
      <svg viewBox="0 0 100 100" className="h-[58%] w-[58%]" aria-hidden="true">
        <circle cx="50" cy="36" r="17" fill="currentColor" opacity=".55" />
        <path d="M16 92c2-24 16-34 34-34s32 10 34 34z" fill="currentColor" opacity=".45" />
        <text x="50" y="45" textAnchor="middle" fontSize="22" fontWeight="900" fill="#070b1a">?</text>
      </svg>
      <span className="text-[0.65rem] font-semibold uppercase tracking-widest opacity-70">photo not added</span>
    </div>
  );
}
