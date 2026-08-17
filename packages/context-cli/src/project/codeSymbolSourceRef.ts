export interface LocalCodeSymbolSourceRef {
  sourceIndex: number;
  file: string;
  symbol: string;
  kind: string;
  digest: string;
}

const LOCAL_SYMBOL_SOURCE_REF = /^src-(\d+)#symbol:(.+):([^:@]+):([^:@]+)@([a-f0-9]+)$/iu;

export function parseLocalCodeSymbolSourceRef(value: string): LocalCodeSymbolSourceRef | undefined {
  const match = LOCAL_SYMBOL_SOURCE_REF.exec(value);
  if (match === null) return undefined;
  const sourceIndex = Number(match[1]);
  const file = match[2];
  const symbol = match[3];
  const kind = match[4];
  const digest = match[5];
  return Number.isInteger(sourceIndex) &&
      file !== undefined &&
      symbol !== undefined &&
      kind !== undefined &&
      digest !== undefined
    ? { sourceIndex, file, symbol, kind, digest }
    : undefined;
}

export function renderLocalCodeSymbolSourceRef(input: {
  sourceIndex: number;
  file: string;
  symbol: string;
  kind: string;
  digest: string;
}): string {
  return `src-${input.sourceIndex}#symbol:${input.file}:${input.symbol}:${input.kind}@${input.digest}`;
}
