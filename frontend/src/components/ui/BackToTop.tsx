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
      className="fixed bottom-5 left-5 z-30 grid h-11 w-11 place-items-center rounded-full border border-brand-300 bg-[#fffdf8] text-brand-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-50 motion-reduce:transform-none"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <ArrowUp size={19} />
    </button>
  );
}
