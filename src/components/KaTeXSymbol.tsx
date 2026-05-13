"use client";

import { memo, useMemo } from "react";
import katex from "katex";

type KaTeXSymbolProps = {
  tex: string;
  className?: string;
  style?: React.CSSProperties;
};

const KaTeXSymbol = memo(function KaTeXSymbol({ tex, className, style }: KaTeXSymbolProps) {
  const html = useMemo(
    () => katex.renderToString(tex, { throwOnError: false, displayMode: false }),
    [tex],
  );

  return (
    <span
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export default KaTeXSymbol;
