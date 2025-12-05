export const appendQuery = (url: string, input: any): string => {
  const isAbs = /^https?:\/\//i.test(url);
  const base = isAbs ? undefined : (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`);
  const U = new URL(url, base);
  const add = (k: string, v: any) => { if (v === undefined || v === null) return; U.searchParams.set(k, String(v)); };
  if (input && typeof input === 'object') {
    for (const [k,v] of Object.entries(input)) add(k, v as any);
  }
  return U.toString();
};
