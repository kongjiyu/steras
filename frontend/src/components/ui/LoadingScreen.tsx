export default function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
        <p className="mt-4 text-sm text-slate-600">Loading STERAS…</p>
      </div>
    </div>
  );
}
