/** The Nerdplexity mark, shown wherever the Free Router (Nerdplexity's own router) appears. */
export function RouterMark({ size = 16 }: { size?: number }) {
  return <img className="np-router-mark" src="/brand/nerdplexity-mark.svg" alt="" aria-hidden width={size} height={size} />;
}
