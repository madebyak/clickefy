/**
 * BytePlus ModelArk private asset library — the "Assets API".
 *
 * Seedance 2.0 / 2.5 refuse any reference image or clip that shows a
 * human face. The way round it, for AI-generated people, is this library:
 * the file is registered as an asset (`CreateAsset`), ModelArk reviews it
 * (`GetAsset` → `Active` | `Failed`), and the generation request then
 * names `asset://<id>` instead of the file's URL. Proven end to end on the
 * client's account on 2026-10-17.
 *
 * Wire shape (Ark OpenAPI, not the inference API):
 *
 *   POST https://ark.ap-southeast-1.byteplusapi.com/?Action=<A>&Version=2024-01-01
 *   Content-Type: application/json
 *   X-Date, X-Content-Sha256, Authorization: HMAC-SHA256 Credential=…
 *
 * Signing is the SigV4-style scheme BytePlus documents for every OpenAPI
 * ("Calculating a signature"): canonical request → string to sign →
 * HMAC chain secret → date → region → service → "request". Web Crypto
 * only, so the same module runs on the Trigger.dev worker (Node) and the
 * Cloudflare Worker.
 *
 * Errors come back as `ResponseMetadata.Error.{Code,Message}` with a 4xx:
 * `SubscriptionRequired` (tier too low), `MissingParameter.*`,
 * `InvalidParameter.*`, `NotFound.*`. Rate limits on the free Entry tier:
 * 50 assets + 50 groups in total, CreateAsset 3 per minute.
 *
 * Docs: https://docs.byteplus.com/en/docs/modelark/private-virtual-avatar-library-guide-preview
 */

export interface ArkAssetsEnv {
  accessKey: string;
  secretKey: string;
  /** Resource project the assets live in; must match the inference key's project. */
  projectName?: string;
  /** Defaults to Singapore, the only region Seedance is served from. */
  region?: string;
}

const VERSION = '2024-01-01';
const SERVICE = 'ark';
const DEFAULT_REGION = 'ap-southeast-1';
const DEFAULT_PROJECT = 'default';
const TIMEOUT_MS = 30_000;

export type ArkGroupType = 'AIGC' | 'LivenessFace';
export type ArkAssetType = 'Image' | 'Video' | 'Audio';
export type ArkAssetStatus = 'Processing' | 'Active' | 'Failed';

export interface ArkAsset {
  Id: string;
  Name?: string;
  AssetType: ArkAssetType;
  Status: ArkAssetStatus;
  GroupId: string;
  /** Signed TOS URL of the stored copy; short-lived. */
  URL?: string;
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
  /** Last time a generation task referenced the asset (absent before 2026-07-24). */
  LastInferenceTime?: string;
  Moderation?: { Strategy?: string };
  /** Why preprocessing failed, when BytePlus says. */
  FailReason?: string;
  Message?: string;
}

export interface ArkAssetGroup {
  Id: string;
  Name: string;
  Description?: string;
  GroupType: ArkGroupType;
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

export class ArkApiError extends Error {
  constructor(
    readonly action: string,
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(`${action} → ${status} ${code}: ${message}`);
    this.name = 'ArkApiError';
  }
}

/** The free tier allows three uploads a minute; this is how it says no. */
export function isArkRateLimited(err: unknown): boolean {
  if (!(err instanceof ArkApiError)) return false;
  return err.status === 429 || /RateLimit|Throttl|TooMany|Quota|QPM|Flow/i.test(err.code);
}

/** The tier does not include the Assets API (Basic) or the quota is used up. */
export function isArkSubscriptionError(err: unknown): boolean {
  return err instanceof ArkApiError && /Subscription|Capacity|Exceed/i.test(err.code);
}

const enc = new TextEncoder();

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return hex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const raw = new Uint8Array(key instanceof Uint8Array ? key : new Uint8Array(key));
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `20261017T125825Z` — the X-Date format, and its first eight characters are the credential date. */
function xDateNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * One signed call. The body is JSON; only Action and Version travel in the
 * query string. Returns `Result` (an empty object for the delete calls).
 */
export async function arkCall<T>(env: ArkAssetsEnv, action: string, body: Record<string, unknown>): Promise<T> {
  const region = env.region ?? DEFAULT_REGION;
  const host = `ark.${region}.byteplusapi.com`;
  const payload = JSON.stringify({ ProjectName: env.projectName ?? DEFAULT_PROJECT, ...body });
  const xDate = xDateNow();
  const date = xDate.slice(0, 8);
  const query = `Action=${action}&Version=${VERSION}`;
  const payloadHash = await sha256Hex(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    host,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  };
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((h) => `${h}:${headers[h]}`).join('\n') + '\n';
  const canonical = ['POST', '/', query, canonicalHeaders, signedNames.join(';'), payloadHash].join('\n');
  const scope = `${date}/${region}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, scope, await sha256Hex(canonical)].join('\n');
  const kDate = await hmac(enc.encode(env.secretKey), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, 'request');
  const signature = hex(await hmac(kSigning, stringToSign));
  const authorization = `HMAC-SHA256 Credential=${env.accessKey}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;

  // `host` is set by fetch itself; sending it explicitly is refused by
  // some runtimes. It is still part of the signature above.
  const { host: _host, ...sendHeaders } = headers;
  const res = await fetch(`https://${host}/?${query}`, {
    method: 'POST',
    headers: { ...sendHeaders, authorization },
    body: payload,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: {
    ResponseMetadata?: { RequestId?: string; Error?: { Code?: string; Message?: string } };
    Result?: T;
  } = {};
  try {
    json = JSON.parse(text);
  } catch {
    throw new ArkApiError(action, res.status, 'InvalidResponse', text.slice(0, 200));
  }
  const err = json.ResponseMetadata?.Error;
  if (!res.ok || err) {
    throw new ArkApiError(
      action,
      res.status,
      err?.Code ?? `HTTP_${res.status}`,
      err?.Message ?? text.slice(0, 200),
      json.ResponseMetadata?.RequestId,
    );
  }
  return (json.Result ?? {}) as T;
}

export const arkAssets = {
  createAssetGroup(env: ArkAssetsEnv, args: { name: string; description?: string; groupType?: ArkGroupType }) {
    return arkCall<{ Id: string }>(env, 'CreateAssetGroup', {
      Name: args.name,
      Description: args.description ?? '',
      GroupType: args.groupType ?? 'AIGC',
    });
  },
  /** Asynchronous: poll `getAsset` until the status leaves `Processing`. */
  createAsset(env: ArkAssetsEnv, args: { groupId: string; url: string; assetType: ArkAssetType; name?: string }) {
    return arkCall<{ Id: string }>(env, 'CreateAsset', {
      GroupId: args.groupId,
      URL: args.url,
      AssetType: args.assetType,
      ...(args.name ? { Name: args.name } : {}),
    });
  },
  getAsset(env: ArkAssetsEnv, id: string) {
    return arkCall<ArkAsset>(env, 'GetAsset', { Id: id });
  },
  listAssets(
    env: ArkAssetsEnv,
    args: { groupType?: ArkGroupType; groupIds?: string[]; statuses?: ArkAssetStatus[]; maxResults?: number; nextToken?: string } = {},
  ) {
    return arkCall<{ Items?: ArkAsset[]; NextToken?: string }>(env, 'ListAssets', {
      Filter: {
        GroupType: args.groupType ?? 'AIGC',
        ...(args.groupIds ? { GroupIds: args.groupIds } : {}),
        ...(args.statuses ? { Statuses: args.statuses } : {}),
      },
      MaxResults: args.maxResults ?? 100,
      ...(args.nextToken ? { NextToken: args.nextToken } : {}),
      SortBy: 'CreateTime',
      SortOrder: 'Asc',
    });
  },
  listAssetGroups(env: ArkAssetsEnv, args: { groupType?: ArkGroupType; name?: string; maxResults?: number } = {}) {
    return arkCall<{ Items?: ArkAssetGroup[]; NextToken?: string }>(env, 'ListAssetGroups', {
      Filter: { GroupType: args.groupType ?? 'AIGC', ...(args.name ? { Name: args.name } : {}) },
      MaxResults: args.maxResults ?? 100,
    });
  },
  deleteAsset(env: ArkAssetsEnv, id: string) {
    return arkCall<Record<string, never>>(env, 'DeleteAsset', { Id: id });
  },
  deleteAssetGroup(env: ArkAssetsEnv, id: string) {
    return arkCall<{ Id?: string }>(env, 'DeleteAssetGroup', { Id: id });
  },
};

/** `asset://asset-20261017205819-rtjpd` — what the generation request carries. */
export function arkAssetUri(assetId: string): string {
  return `asset://${assetId}`;
}

export function isArkAssetUri(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('asset://');
}

/** Map our media kind to the library's asset type. */
export function arkAssetTypeFor(kind: 'image' | 'video' | 'audio'): ArkAssetType {
  return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Image';
}
