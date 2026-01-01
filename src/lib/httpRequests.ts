import fetch from 'cross-fetch';
import { appendQuery } from './url.js';
import { interpolateDeep, interpolateString } from './interpolation.js';

export type OAuthClientCredentialsAuth = {
  id: string;
  kind: 'oauth_client_credentials';
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scopes?: string[];
  cacheTtlSeconds?: number;
  apply?: { type: 'bearer'; header?: string };
};

const oauthCache: Map<string, { accessToken: string; expiresAt: number }> = new Map();

export async function resolveAuthHeaderFromBlock(auth: any, rootVars: any, log?: (e:any)=>void): Promise<string | undefined> {
  if (!auth || typeof auth !== 'object') return undefined;
  const kind = String((auth as any).kind || '').toLowerCase();

  if (kind === 'oauth_client_credentials') {
    const cfg: OAuthClientCredentialsAuth = {
      id: String(auth.id || ''),
      kind: 'oauth_client_credentials',
      clientId: interpolateString(String(auth.clientId || ''), rootVars),
      clientSecret: interpolateString(String(auth.clientSecret || ''), rootVars),
      tokenUrl: interpolateString(String(auth.tokenUrl || ''), rootVars),
      scopes: Array.isArray(auth.scopes) ? auth.scopes.map((s:any)=> String(s)) : undefined,
      cacheTtlSeconds: typeof auth.cacheTtlSeconds === 'number' ? auth.cacheTtlSeconds : 300,
      apply: auth.apply && typeof auth.apply === 'object' ? { type: 'bearer', header: String((auth.apply.header || 'authorization')) } : { type: 'bearer', header: 'authorization' },
    };

    if (!cfg.clientId || !cfg.clientSecret || !cfg.tokenUrl) return undefined;

    const cacheKey = `${cfg.tokenUrl}::${cfg.clientId}::${(cfg.scopes||[]).join(' ')}`;
    const nowTs = Date.now();
    const cached = oauthCache.get(cacheKey);
    if (cached && cached.expiresAt > nowTs + 5000) {
      return `Bearer ${cached.accessToken}`;
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
    if (cfg.scopes && cfg.scopes.length) body.set('scope', cfg.scopes.join(' '));

    try {
      const resp = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const json = await resp.json().catch(()=> ({} as any));
      const accessToken = String(json.access_token || '');
      if (!accessToken) {
        log?.({ t: new Date().toISOString(), type: 'auth_error', strategy: 'oauth_client_credentials', details: { status: resp.status, body: json } });
        return undefined;
      }
      const expiresIn = Number(json.expires_in || cfg.cacheTtlSeconds || 300);
      oauthCache.set(cacheKey, { accessToken, expiresAt: nowTs + expiresIn * 1000 });
      return `Bearer ${accessToken}`;
    } catch (e:any) {
      log?.({ t: new Date().toISOString(), type: 'auth_error', strategy: 'oauth_client_credentials', details: { error: e?.message || 'token_fetch_failed' } });
      return undefined;
    }
  }

  if (auth.headers && typeof auth.headers === 'object') {
    const headers = interpolateDeep(auth.headers, rootVars) || {};
    const val = (headers as any).authorization || (headers as any).Authorization;
    return typeof val === 'string' ? val : undefined;
  }

  return undefined;
}

export async function executeRequest(orgId: any, requestId: string, input: any, authHeader?: string, log?: (entry: any)=>void, fileRequests?: Record<string, any>, authBlocks?: Record<string, any>): Promise<{ kind: 'text'|'data'; payload: any; status: number; contentType: string }> {
  const { repo } = await import('../db/repo.js');
  const { RequestModel } = await import('../models/Request.js');

  const r = fileRequests && fileRequests[requestId]
    ? fileRequests[requestId]
    : (repo.isPg() ? await repo.getRequest(String(orgId), String(requestId)) : await (RequestModel as any).findOne({ orgId, id: requestId }).lean());
  if (!r) throw new Error(`request_not_found: ${requestId}`);
  const t = (r as any).transport || {};
  const http = t.http || {};
  const method = String(http.method || 'GET').toUpperCase();
  const url = http.full_url || ((http.base_url || '') + (http.path || ''));
  if (!url) throw new Error('request_url_missing');
  let finalUrl = url;
  const tpl = (s: string) => String(s).replace(/\{([^}]+)\}/g, (_, k) => (input && (input as any)[k] !== undefined) ? String((input as any)[k]) : `{${k}}`);
  finalUrl = tpl(finalUrl);
  let headers: Record<string,string> = {};

  if (http.headers && typeof http.headers === 'object') {
    for (const [k,v] of Object.entries(http.headers)) headers[String(k)] = tpl(String(v));
  }

  let finalAuthHeader = authHeader;
  const authRef = (r as any).authRef || (t as any).authRef;
  if (authRef && authBlocks && authBlocks[authRef]) {
    const block = authBlocks[authRef];
    const rootVars = { env: process.env, input };
    const hdr = await resolveAuthHeaderFromBlock(block, rootVars, log);
    if (hdr) finalAuthHeader = hdr;
  }

  if (finalAuthHeader && !headers['Authorization'] && !headers['authorization']) headers['Authorization'] = finalAuthHeader;

  let body: any = undefined;
  let reqUrl = finalUrl;

  if (method === 'GET') {
    reqUrl = appendQuery(finalUrl, input);
  } else {
    headers['content-type'] = headers['content-type'] || 'application/json';
    const rawBody = (http as any).body !== undefined ? (http as any).body : (input ?? {});
    // Apply both {key} template replacement (for request body templates) and ${expr} interpolation
    const tplBody = (val: any): any => {
      if (val == null) return val;
      if (typeof val === 'string') {
        // First apply {key} replacement from input
        let result = val.replace(/\{([^}]+)\}/g, (_, k) => {
          const v = input && (input as any)[k];
          return v !== undefined ? String(v) : `{${k}}`;
        });
        return result;
      }
      if (Array.isArray(val)) return val.map(v => tplBody(v));
      if (typeof val === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(val)) out[k] = tplBody(v);
        return out;
      }
      return val;
    };
    const templatedBody = tplBody(rawBody);
    // Then apply ${expr} interpolation for more complex expressions
    const resolvedBody = interpolateDeep(templatedBody, { input, ...input });
    body = headers['content-type'].includes('application/json') ? JSON.stringify(resolvedBody) : resolvedBody;
  }
  log?.({ t: new Date().toISOString(), type: 'request_exec', requestId, method, url: reqUrl });
  const resp = await fetch(reqUrl, { method, headers, body });
  const ct = resp.headers.get('content-type') || '';
  let payload: any = undefined;
  if (ct.includes('application/json') || ct.endsWith('+json')) payload = await resp.json().catch(()=> ({}));
  else payload = await resp.text().catch(()=> '');
  log?.({ t: new Date().toISOString(), type: 'request_result', requestId, status: resp.status, contentType: ct });
  return { kind: (typeof payload === 'string' ? 'text' : 'data'), payload, status: (resp as any).status, contentType: ct };
}
