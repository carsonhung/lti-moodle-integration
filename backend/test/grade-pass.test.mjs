import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { submitAgsScore } from '../dist/grades/ags.js';
import { replaceResult } from '../dist/legacy/outcomes.js';

const platform = {
  issuer: 'https://moodle.example',
  clientId: 'client-1',
  deploymentId: 'deployment-1',
  contextId: 'course-1',
};

test('AGS submits a fully graded score through the provider facade', async () => {
  let captured;
  const provider = {
    Grade: {
      async submitScore(idtoken, lineItem, score) {
        captured = { idtoken, lineItem, score };
      },
    },
  };
  const result = await submitAgsScore({
    provider,
    platform,
    userExternalId: 'student-1',
    link: {
      protocol: '1.3',
      lineItem: 'https://moodle.example/lineitems/1',
      scopes: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'],
    },
    scoreGiven: 8,
    scoreMaximum: 10,
    comment: 'Completed',
  });

  assert.equal(result.success, true);
  assert.equal(captured.lineItem, 'https://moodle.example/lineitems/1');
  assert.equal(captured.idtoken.deploymentId, 'deployment-1');
  assert.deepEqual(
    {
      userId: captured.score.userId,
      scoreGiven: captured.score.scoreGiven,
      scoreMaximum: captured.score.scoreMaximum,
      activityProgress: captured.score.activityProgress,
      gradingProgress: captured.score.gradingProgress,
      comment: captured.score.comment,
    },
    {
      userId: 'student-1',
      scoreGiven: 8,
      scoreMaximum: 10,
      activityProgress: 'Completed',
      gradingProgress: 'FullyGraded',
      comment: 'Completed',
    }
  );
});

test('AGS fails cleanly when the launch has no line item', async () => {
  const result = await submitAgsScore({
    provider: { Grade: { submitScore: async () => undefined } },
    platform,
    userExternalId: 'student-1',
    link: { protocol: '1.3' },
    scoreGiven: 8,
    scoreMaximum: 10,
  });

  assert.equal(result.success, false);
  assert.match(result.message, /line item/i);
});

test('LTI 1.1 Basic Outcomes posts a normalized replacement result', async () => {
  let requestBody = '';
  let authorization = '';
  const server = createServer((req, res) => {
    authorization = String(req.headers.authorization ?? '');
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      requestBody += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0"?>
        <imsx_POXEnvelopeResponse>
          <imsx_POXHeader><imsx_POXResponseHeaderInfo>
            <imsx_statusInfo><imsx_codeMajor>success</imsx_codeMajor></imsx_statusInfo>
          </imsx_POXResponseHeaderInfo></imsx_POXHeader>
        </imsx_POXEnvelopeResponse>`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const result = await replaceResult(
      {
        serviceUrl: `http://127.0.0.1:${address.port}/outcomes`,
        sourcedId: 'opaque-student-result',
        consumerKey: 'consumer-key',
        consumerSecret: 'consumer-secret',
      },
      0.8,
      { nowSeconds: 1_700_000_000, nonce: 'fixed-nonce' }
    );

    assert.equal(result.success, true);
    assert.match(requestBody, /<textString>0\.8<\/textString>/);
    assert.match(authorization, /^OAuth /);
    assert.match(authorization, /oauth_body_hash=/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
