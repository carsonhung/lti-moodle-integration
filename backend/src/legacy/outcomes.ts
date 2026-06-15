/**
 * LTI 1.1 Basic Outcomes — POX (Plain Old XML) grade passback client.
 *
 * Implements `replaceResult` / `readResult` / `deleteResult` against the
 * `lis_outcome_service_url` captured at launch. Each call is an OAuth 1.0a
 * `Authorization`-header-signed POST with `oauth_body_hash` over the raw XML
 * body (no body params in the signature base). Scores are normalized floats in
 * the range 0.0–1.0.
 *
 * Uses the global `fetch` (Node 18+) so the package needs no HTTP dependency.
 */

import crypto from 'crypto';
import { computeBodyHash, signOAuth1 } from './oauth1';
import { logInfo, logWarn } from '../logger';

const POX_NS = 'http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0';

function xmlEscape(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildEnvelope(messageId: string, bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<imsx_POXEnvelopeRequest xmlns="${POX_NS}">
  <imsx_POXHeader>
    <imsx_POXRequestHeaderInfo>
      <imsx_version>V1.0</imsx_version>
      <imsx_messageIdentifier>${xmlEscape(messageId)}</imsx_messageIdentifier>
    </imsx_POXRequestHeaderInfo>
  </imsx_POXHeader>
  <imsx_POXBody>${bodyXml}</imsx_POXBody>
</imsx_POXEnvelopeRequest>`;
}

function sourcedGuid(sourcedId: string): string {
  return `<sourcedGUID><sourcedId>${xmlEscape(sourcedId)}</sourcedId></sourcedGUID>`;
}

export interface OutcomeServiceCredentials {
  serviceUrl: string;
  sourcedId: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface OutcomeResult {
  success: boolean;
  /** `imsx_codeMajor` from the response (e.g. 'success' | 'failure'). */
  codeMajor?: string;
  /** Score read back (readResult only), normalized 0.0–1.0. */
  score?: number;
  /** `imsx_description` or transport error message. */
  message?: string;
  /** HTTP status of the POX POST. */
  status?: number;
}

interface OutcomeSignOverrides {
  nowSeconds?: number;
  nonce?: string;
}

async function postPox(
  creds: OutcomeServiceCredentials,
  xml: string,
  overrides?: OutcomeSignOverrides
): Promise<{ status: number; body: string }> {
  const bodyHash = computeBodyHash(xml);
  const { authorizationHeader } = signOAuth1({
    method: 'POST',
    url: creds.serviceUrl,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    bodyHash,
    nowSeconds: overrides?.nowSeconds,
    nonce: overrides?.nonce,
  });

  const res = await fetch(creds.serviceUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      Authorization: authorizationHeader,
    },
    body: xml,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

function parseResponse(body: string): { codeMajor?: string; description?: string } {
  const codeMajor = /<imsx_codeMajor>\s*([^<]+?)\s*<\/imsx_codeMajor>/i.exec(body)?.[1];
  const description = /<imsx_description>\s*([^<]*?)\s*<\/imsx_description>/i.exec(body)?.[1];
  return { codeMajor: codeMajor?.trim(), description: description?.trim() };
}

/**
 * Build the signed XML for a `replaceResult`. Exposed (alongside the network
 * calls) so tests can assert the envelope + signature without a live endpoint.
 */
export function buildReplaceResultXml(sourcedId: string, score: number): string {
  const normalized = Math.max(0, Math.min(1, score));
  const body = `<replaceResultRequest>
      <resultRecord>
        ${sourcedGuid(sourcedId)}
        <result>
          <resultScore>
            <language>en</language>
            <textString>${xmlEscape(String(normalized))}</textString>
          </resultScore>
        </result>
      </resultRecord>
    </replaceResultRequest>`;
  return buildEnvelope(crypto.randomUUID(), body);
}

/** Push a normalized 0.0–1.0 score to the LMS gradebook. */
export async function replaceResult(
  creds: OutcomeServiceCredentials,
  score: number,
  overrides?: OutcomeSignOverrides
): Promise<OutcomeResult> {
  try {
    const xml = buildReplaceResultXml(creds.sourcedId, score);
    const { status, body } = await postPox(creds, xml, overrides);
    const { codeMajor, description } = parseResponse(body);
    const success = status >= 200 && status < 300 && codeMajor?.toLowerCase() === 'success';
    if (success) {
      logInfo('[LTI 1.1] replaceResult ok', { status, sourcedId: creds.sourcedId, score });
    } else {
      logWarn('[LTI 1.1] replaceResult failed', { status, codeMajor, description });
    }
    return { success, codeMajor, message: description, status };
  } catch (e: any) {
    logWarn('[LTI 1.1] replaceResult error', { message: e?.message });
    return { success: false, message: e?.message };
  }
}

/** Read the current score (normalized 0.0–1.0) from the LMS, if any. */
export async function readResult(
  creds: OutcomeServiceCredentials,
  overrides?: OutcomeSignOverrides
): Promise<OutcomeResult> {
  try {
    const body = `<readResultRequest>
      <resultRecord>
        ${sourcedGuid(creds.sourcedId)}
      </resultRecord>
    </readResultRequest>`;
    const xml = buildEnvelope(crypto.randomUUID(), body);
    const { status, body: respBody } = await postPox(creds, xml, overrides);
    const { codeMajor, description } = parseResponse(respBody);
    const scoreStr = /<textString>\s*([^<]*?)\s*<\/textString>/i.exec(respBody)?.[1];
    const score = scoreStr !== undefined && scoreStr !== '' ? Number(scoreStr) : undefined;
    const success = status >= 200 && status < 300 && codeMajor?.toLowerCase() === 'success';
    return {
      success,
      codeMajor,
      score: Number.isFinite(score) ? score : undefined,
      message: description,
      status,
    };
  } catch (e: any) {
    logWarn('[LTI 1.1] readResult error', { message: e?.message });
    return { success: false, message: e?.message };
  }
}

/** Delete the stored result for this sourcedId. */
export async function deleteResult(
  creds: OutcomeServiceCredentials,
  overrides?: OutcomeSignOverrides
): Promise<OutcomeResult> {
  try {
    const body = `<deleteResultRequest>
      <resultRecord>
        ${sourcedGuid(creds.sourcedId)}
      </resultRecord>
    </deleteResultRequest>`;
    const xml = buildEnvelope(crypto.randomUUID(), body);
    const { status, body: respBody } = await postPox(creds, xml, overrides);
    const { codeMajor, description } = parseResponse(respBody);
    const success = status >= 200 && status < 300 && codeMajor?.toLowerCase() === 'success';
    return { success, codeMajor, message: description, status };
  } catch (e: any) {
    logWarn('[LTI 1.1] deleteResult error', { message: e?.message });
    return { success: false, message: e?.message };
  }
}
