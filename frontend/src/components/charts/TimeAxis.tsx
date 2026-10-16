export function TimeAxis({ seconds }: { seconds: number }) {
  return (
    <div aria-hidden className="num mt-1 flex justify-between text-[11px] text-ink-faint">
      <span>−{seconds} s</span>
      <span>−{seconds / 2} s</span>
      <span>now</span>
    </div>
  );
}
