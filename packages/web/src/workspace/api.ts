export const sizeLabel = (bytes?: number) => bytes === undefined ? 'Size not reported' : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const tokensLabel = (n?: number) => n === undefined ? undefined : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;

export function exportText(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
