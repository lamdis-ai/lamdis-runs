export const getAtPath = (obj: any, path: string): any => {
  if (!path) return undefined;
  let p = String(path).trim();
  if (p.startsWith('$.')) p = p.slice(2);
  if (p.startsWith('$')) p = p.slice(1);
  if (!p) return obj;
  const parts: (string|number)[] = [];
  let cur = '';
  for (let i=0;i<p.length;i++) {
    const ch = p[i];
    if (ch === '.') { if (cur) { parts.push(cur); cur=''; } continue; }
    if (ch === '[') {
      if (cur) { parts.push(cur); cur=''; }
      let j = i+1; let idxStr='';
      while (j < p.length && p[j] !== ']') { idxStr += p[j]; j++; }
      i = j;
      const idx = Number(idxStr);
      if (!Number.isNaN(idx)) parts.push(idx);
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  let val = obj;
  for (const key of parts) {
    if (val == null) return undefined;
    if (typeof key === 'number') {
      if (!Array.isArray(val)) return undefined;
      val = val[key];
    } else {
      val = (val as any)[key];
    }
  }
  return val;
};

export const interpolateString = (s: any, root: any): any => {
  if (s == null) return s;
  if (typeof s !== 'string') return s;
  return s.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    try {
      const p = String(expr || '').trim();
      const v = getAtPath(root, p);
      return v == null ? '' : String(v);
    } catch { return ''; }
  });
};

export const interpolateDeep = (val: any, root: any): any => {
  if (val == null) return val;
  if (typeof val === 'string') return interpolateString(val, root);
  if (Array.isArray(val)) return val.map(v => interpolateDeep(v, root));
  if (typeof val === 'object') {
    const out: any = Array.isArray(val) ? [] : {};
    for (const [k,v] of Object.entries(val)) out[k] = interpolateDeep(v, root);
    return out;
  }
  return val;
};
