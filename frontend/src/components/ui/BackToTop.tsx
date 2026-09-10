import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 480);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      className="fixed bottom-24 left-4 z-30 flex min-h-11 items-center gap-2 rounded-full border border-brand-300 bg-[#fffdf8] px-4 font-semibold text-brand-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-50 motion-reduce:transform-none md:bottom-5 md:left-5"
      onClick={() => window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      })}
    >
      <ArrowUp size={19} />
      <span>Back to top</span>
    </button>
  );
}
