import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  renderApiReference,
  renderConfigReference,
  renderCommandIndex,
} from '../../scripts/lib/docs-references.mjs';

const contract = {
  info: { version: 'test' },
  paths: {
    '/widgets/{id}': {
      summary: 'Not an HTTP method',
      parameters: [{ $ref: '#/components/parameters/id' }],
      post: {
        tags: ['Widgets'],
        operationId: 'saveWidget',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 0, maximum: 10 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Widget' },
            },
          },
        },
        responses: {
          200: { $ref: '#/components/responses/saved' },
          429: {
            description: 'Wait | retry <later>',
            headers: { 'Retry-After': { schema: { type: 'integer' } } },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      id: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    },
    responses: {
      saved: {
        description: 'Saved',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Widget' },
          },
        },
      },
    },
    schemas: {
      Widget: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            description: 'A | B <tag> {{unsafe}}',
          },
          enabled: { type: 'boolean', default: false },
          variants: {
            type: 'array',
            items: {
              oneOf: [
                { $ref: '#/components/schemas/Widget' },
                { type: 'null' },
              ],
            },
          },
          details: {
            allOf: [
              { type: 'object', properties: { count: { type: 'integer' } } },
              {
                type: 'object',
                additionalProperties: { type: ['string', 'null'] },
              },
            ],
          },
        },
      },
    },
  },
};

test('API reference resolves inherited parameters, bodies, responses and cyclic schema links', () => {
  const rendered = renderApiReference(contract, 'en', {
    downloadHref: '../../openapi.json',
  });
  assert.match(rendered, /## Widgets/);
  assert.match(rendered, /POST.*widgets\/&#123;id&#125;/);
  assert.match(rendered, /<code>id<\/code>.*path.*yes/);
  assert.match(rendered, /<code>limit<\/code>.*default=0.*maximum=10/);
  assert.match(
    rendered,
    /Request body.*\n[\s\S]*application\/json.*#schema-Widget/,
  );
  assert.match(rendered, /Saved/);
  assert.match(rendered, /Retry-After/);
  assert.match(rendered, /name.*minLength=1/);
  assert.match(rendered, /default=false/);
  assert.match(rendered, /oneOf/);
  assert.match(rendered, /allOf/);
  assert.match(rendered, /additionalProperties/);
  assert.match(rendered, /&#124;/);
  assert.match(rendered, /&lt;tag&gt;/);
  assert.match(rendered, /&#123;&#123;unsafe/);
  assert.match(rendered, /\(\.\.\/\.\.\/openapi\.json\)/);
  assert.doesNotMatch(rendered, /SUMMARY.*Not an HTTP/);
});

test('missing local OpenAPI references stop publication', () => {
  const broken = structuredClone(contract);
  broken.components.schemas.Widget.properties.name = {
    $ref: '#/components/schemas/Missing',
  };
  assert.throws(() => renderApiReference(broken, 'zh'), /Missing.*reference/);
});

test('generated settings preserve falsy defaults, hide secret defaults and check example keys', () => {
  const fields = [
    {
      name: 'LIMIT',
      default: 0,
      secret: false,
      description: 'A | B',
      descriptionZh: 'A | B',
    },
    {
      name: 'PASSWORD',
      default: 'do-not-publish',
      secret: true,
      description: 'secret',
      descriptionZh: 'secret',
    },
  ];
  const rendered = renderConfigReference(
    fields,
    'LIMIT=0\nPASSWORD=\n',
    'en',
    (path) => `https://example.test/${path}`,
  );
  assert.match(rendered, /LIMIT.*0/);
  assert.match(rendered, /A &#124; B/);
  assert.doesNotMatch(rendered, /do-not-publish/);
  assert.throws(
    () => renderConfigReference(fields, 'LIMIT=0\n', 'zh', String),
    /missing PASSWORD/,
  );
});

test('command index includes current task runner definitions and structured parameters', () => {
  const rendered = renderCommandIndex(
    {
      recipes: {
        migrate: {
          name: 'migrate',
          parameters: [],
          dependencies: [],
          body: [['node scripts/migrate.mjs']],
        },
        'production-restore': {
          name: 'production-restore',
          parameters: [
            { name: 'ARCHIVE', default: null },
            { name: 'ENV_FILE', default: '.env.production' },
          ],
          dependencies: [],
          body: [],
        },
      },
    },
    { 'docs:check': 'node scripts/check-docs.mjs' },
    'en',
    (path) => `https://example.test/${path}`,
  );
  assert.match(rendered, /just migrate/);
  assert.match(rendered, /ARCHIVE/);
  assert.match(rendered, /ENV_FILE/);
  assert.match(rendered, /pnpm docs:check/);
  assert.match(rendered, /scripts\/migrate.mjs/);
});
