const METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

const TEXTS = {
  zh: {
    title: 'HTTP API',
    intro: '从 Rust OpenAPI 自动生成；参数、请求、响应和模型以当前合同为准。',
    version: 'API 版本',
    method: '方法',
    path: '路径',
    responses: '响应',
    parameters: '参数',
    name: '名称',
    location: '位置',
    required: '必需',
    type: '类型 / 模型',
    limits: '约束 / 默认值',
    description: '说明',
    request: '请求体',
    media: '媒体类型',
    status: '状态',
    headers: '响应头',
    schemas: '模型',
    properties: '字段',
    none: '无',
    yes: '是',
    no: '否',
    optional: '可选',
    download: '下载 OpenAPI JSON',
    untagged: '其他',
    security: '安全要求',
    config: '服务端配置',
    configIntro:
      '从 Rust Settings/FIELDS 自动生成。秘密字段不展示默认值；部署时由受保护配置提供。',
    variable: '变量',
    default: '默认值',
    secret: '秘密',
    hidden: '受保护配置',
    source: '来源',
    configMore:
      '开发、客户端和文档发布变量有独立来源，见 [变量来源分类](configuration-sources.md)。',
    command: '命令',
    arguments: '参数',
    implementation: '实现 / 前置命令',
    commandIntro:
      '以下索引从当前 justfile 和 package.json 生成；在仓库根目录执行。',
    commandGroups: [
      '开发与数据库',
      '测试与合同',
      '文档',
      '生产与恢复',
      '性能报告',
      '客户端',
      '其他',
    ],
  },
  en: {
    title: 'HTTP API',
    intro:
      'Generated from Rust OpenAPI. Parameters, requests, responses and models follow the current contract.',
    version: 'API version',
    method: 'Method',
    path: 'Path',
    responses: 'Responses',
    parameters: 'Parameters',
    name: 'Name',
    location: 'Location',
    required: 'Required',
    type: 'Type / model',
    limits: 'Constraints / defaults',
    description: 'Description',
    request: 'Request body',
    media: 'Media type',
    status: 'Status',
    headers: 'Response headers',
    schemas: 'Schemas',
    properties: 'Properties',
    none: 'None',
    yes: 'yes',
    no: 'no',
    optional: 'optional',
    download: 'Download OpenAPI JSON',
    untagged: 'Other',
    security: 'Security requirements',
    config: 'Server configuration',
    configIntro:
      'Generated from Rust Settings/FIELDS. Secret defaults are hidden and supplied through protected deployment configuration.',
    variable: 'Variable',
    default: 'Default',
    secret: 'Secret',
    hidden: 'protected configuration',
    source: 'Source',
    configMore:
      'Development, client and documentation variables have separate sources; see [Variable sources](configuration-sources.md).',
    command: 'Command',
    arguments: 'Arguments',
    implementation: 'Implementation / prerequisites',
    commandIntro:
      'Generated from the current justfile and package.json. Run these commands at the repository root.',
    commandGroups: [
      'Development and database',
      'Tests and contracts',
      'Documentation',
      'Production and recovery',
      'Performance reports',
      'Clients',
      'Other',
    ],
  },
};

export const markdownCell = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
    .replaceAll('`', '&#96;')
    .replaceAll('\n', '<br>');
const code = (value) => `<code>${markdownCell(value)}</code>`;
const anchor = (kind, value) =>
  `${kind}-${encodeURIComponent(value).replaceAll('%', '-')}`;
const table = (headings, rows) =>
  `\n| ${headings.join(' | ')} |\n| ${headings.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.join(' | ')} |`).join('\n')}\n`;

function resolvePointer(contract, reference) {
  if (!reference.startsWith('#/')) return null;
  let value = contract;
  for (const part of reference.slice(2).split('/'))
    value =
      value?.[
        decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~')
      ];
  if (value === undefined)
    throw new Error(`Missing OpenAPI reference: ${reference}`);
  return value;
}

function dereference(contract, value) {
  const seen = new Set();
  while (value?.$ref?.startsWith('#/')) {
    if (seen.has(value.$ref))
      throw new Error(`Cyclic non-schema OpenAPI reference: ${value.$ref}`);
    seen.add(value.$ref);
    value = resolvePointer(contract, value.$ref);
  }
  return value ?? {};
}

function schemaType(contract, schema) {
  if (schema === true) return code('any');
  if (schema === false) return code('never');
  if (!schema) return code('any');
  const parts = [];
  if (schema.$ref) {
    resolvePointer(contract, schema.$ref);
    if (schema.$ref.startsWith('#/components/schemas/')) {
      const name = decodeURIComponent(
        schema.$ref.slice('#/components/schemas/'.length).split('/')[0],
      )
        .replaceAll('~1', '/')
        .replaceAll('~0', '~');
      parts.push(`[${code(name)}](#${anchor('schema', name)})`);
    } else if (!schema.$ref.startsWith('#/')) {
      parts.push(`[${code(schema.$ref)}](${schema.$ref})`);
    } else parts.push(code(schema.$ref));
  }
  for (const composition of ['allOf', 'oneOf', 'anyOf'])
    if (schema[composition])
      parts.push(
        `${code(composition)}(${schema[composition].map((part) => schemaType(contract, part)).join(', ')})`,
      );
  if (schema.type === 'array' || schema.items)
    parts.push(`${code('array')}(${schemaType(contract, schema.items)})`);
  else if (schema.type)
    parts.push(
      code(Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type),
    );
  else if (schema.properties || schema.additionalProperties !== undefined)
    parts.push(code('object'));
  if (schema.format) parts.push(code(schema.format));
  if (schema.nullable) parts.push(code('nullable'));
  return parts.join(' · ') || code('any');
}

function schemaLimits(schema = {}) {
  if (typeof schema === 'boolean') return '';
  return [
    'default',
    'enum',
    'const',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minProperties',
    'maxProperties',
    'readOnly',
    'writeOnly',
    'deprecated',
  ]
    .filter((key) => Object.hasOwn(schema, key))
    .map((key) => code(`${key}=${JSON.stringify(schema[key])}`))
    .join('; ');
}

function schemaRows(
  contract,
  schema,
  texts,
  name = '(value)',
  required = false,
) {
  const rows = [
    [
      code(name),
      required ? texts.yes : texts.no,
      schemaType(contract, schema),
      schemaLimits(schema),
      markdownCell(schema?.description),
    ],
  ];
  if (!schema || typeof schema === 'boolean') return rows;
  for (const [property, child] of Object.entries(schema.properties ?? {}))
    rows.push(
      ...schemaRows(
        contract,
        child,
        texts,
        name === '(value)' ? property : `${name}.${property}`,
        schema.required?.includes(property),
      ),
    );
  for (const composition of ['allOf', 'oneOf', 'anyOf'])
    for (const [index, child] of (schema[composition] ?? []).entries())
      rows.push(
        ...schemaRows(
          contract,
          child,
          texts,
          `${name}.${composition}[${index}]`,
        ),
      );
  if (schema.items)
    rows.push(...schemaRows(contract, schema.items, texts, `${name}[]`));
  if (schema.additionalProperties !== undefined)
    rows.push(
      ...schemaRows(
        contract,
        schema.additionalProperties,
        texts,
        `${name}.additionalProperties`,
      ),
    );
  if (schema.not)
    rows.push(...schemaRows(contract, schema.not, texts, `${name}.not`));
  return rows;
}

export function renderApiReference(
  contract,
  locale,
  { downloadHref = '../../openapi.json', sourceLink = (path) => path } = {},
) {
  const texts = TEXTS[locale];
  const groups = new Map();
  const operationIds = new Set();
  for (const [path, item] of Object.entries(contract.paths ?? {}))
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.has(method)) continue;
      const id = anchor(
        'operation',
        operation.operationId ?? `${method}-${path}`,
      );
      if (operationIds.has(id))
        throw new Error(`Duplicate OpenAPI operation anchor: ${id}`);
      operationIds.add(id);
      const tag = operation.tags?.[0] ?? texts.untagged;
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push({ path, method, operation, item, id });
    }
  let rendered = `# ${texts.title}\n\n${texts.intro} ${texts.version}: ${code(contract.info.version)}.\n\n[${texts.download}](${downloadHref}) · [OpenAPI source](${sourceLink('apps/api/src/lib.rs')})\n\n\`/api/openapi.json\`\n`;
  for (const [tag, operations] of groups) {
    rendered += `\n## ${markdownCell(tag)}\n`;
    rendered += table(
      [texts.method, texts.path, 'operationId', texts.responses],
      operations.map(({ path, method, operation, id }) => [
        code(method.toUpperCase()),
        code(path),
        `[${code(operation.operationId ?? '—')}](#${id})`,
        Object.keys(operation.responses ?? {}).join(', '),
      ]),
    );
    for (const { path, method, operation, item, id } of operations) {
      rendered += `\n### ${method.toUpperCase()} ${code(path)} {#${id}}\n\n${code(operation.operationId ?? '')}\n\n${markdownCell(operation.summary)}\n\n${markdownCell(operation.description)}\n`;
      const security = operation.security ?? contract.security;
      if (security?.length)
        rendered += `\n${texts.security}: ${security.map((requirement) => code(JSON.stringify(requirement))).join(' / ')}\n`;
      const parameters = new Map();
      for (const raw of [
        ...(item.parameters ?? []),
        ...(operation.parameters ?? []),
      ]) {
        const parameter = dereference(contract, raw);
        parameters.set(`${parameter.in}:${parameter.name}`, parameter);
      }
      rendered += `\n#### ${texts.parameters}\n`;
      rendered += parameters.size
        ? table(
            [
              texts.name,
              texts.location,
              texts.required,
              texts.type,
              texts.limits,
              texts.description,
            ],
            [...parameters.values()].map((parameter) => [
              code(parameter.name),
              markdownCell(parameter.in),
              parameter.required ? texts.yes : texts.no,
              schemaType(contract, parameter.schema),
              schemaLimits(parameter.schema),
              markdownCell(parameter.description),
            ]),
          )
        : `\n${texts.none}\n`;
      rendered += `\n#### ${texts.request}\n`;
      const body =
        operation.requestBody && dereference(contract, operation.requestBody);
      rendered += body
        ? `\n${texts.required}: ${body.required ? texts.yes : texts.no}. ${markdownCell(body.description)}\n` +
          table(
            [texts.media, texts.type, texts.limits],
            Object.entries(body.content ?? {}).map(([media, value]) => [
              code(media),
              schemaType(contract, value.schema),
              schemaLimits(value.schema),
            ]),
          )
        : `\n${texts.none}\n`;
      rendered += `\n#### ${texts.responses}\n`;
      rendered += table(
        [texts.status, texts.description, texts.media, texts.type],
        Object.entries(operation.responses ?? {}).flatMap(([status, raw]) => {
          const response = dereference(contract, raw);
          return Object.entries(response.content ?? { '—': {} }).map(
            ([media, value]) => [
              code(status),
              markdownCell(response.description),
              code(media),
              value.schema ? schemaType(contract, value.schema) : texts.none,
            ],
          );
        }),
      );
      const headers = Object.entries(operation.responses ?? {}).flatMap(
        ([status, raw]) =>
          Object.entries(dereference(contract, raw).headers ?? {}).map(
            ([name, rawHeader]) => {
              const header = dereference(contract, rawHeader);
              return [
                code(status),
                code(name),
                schemaType(contract, header.schema),
                schemaLimits(header.schema),
                markdownCell(header.description),
              ];
            },
          ),
      );
      if (headers.length)
        rendered +=
          `\n${texts.headers}\n` +
          table(
            [
              texts.status,
              texts.name,
              texts.type,
              texts.limits,
              texts.description,
            ],
            headers,
          );
    }
  }
  rendered += `\n## ${texts.schemas}\n`;
  const schemas = Object.entries(contract.components?.schemas ?? {});
  rendered +=
    schemas
      .map(([name]) => `[${code(name)}](#${anchor('schema', name)})`)
      .join(' · ') + '\n';
  for (const [name, schema] of schemas) {
    rendered += `\n### ${markdownCell(name)} {#${anchor('schema', name)}}\n`;
    rendered += table(
      [
        texts.properties,
        texts.required,
        texts.type,
        texts.limits,
        texts.description,
      ],
      schemaRows(contract, schema, texts),
    );
  }
  return rendered;
}

export function renderConfigReference(fields, exampleText, locale, sourceLink) {
  const texts = TEXTS[locale];
  for (const field of fields)
    if (
      !exampleText.split('\n').some((line) => line.startsWith(`${field.name}=`))
    )
      throw new Error(`.env.example is missing ${field.name}`);
  return (
    `# ${texts.config}\n\n${texts.configIntro}\n\n[Settings/FIELDS](${sourceLink('apps/api/src/bin/config-reference.rs')}) · [.env.example](${sourceLink('.env.example')})\n` +
    table(
      [texts.variable, texts.default, texts.secret, texts.description],
      fields.map((field) => [
        code(field.name),
        field.secret
          ? texts.hidden
          : field.default === null || field.default === undefined
            ? texts.required
            : code(field.default),
        field.secret ? texts.yes : texts.no,
        markdownCell(locale === 'en' ? field.description : field.descriptionZh),
      ]),
    ) +
    `\n${texts.configMore}\n`
  );
}

function commandGroup(name) {
  if (/docs/.test(name)) return 2;
  if (/^(production|backup|restore)/.test(name)) return 3;
  if (/^perf/.test(name)) return 4;
  if (/desktop|web|frontend|typecheck|lint|format|build/.test(name)) return 5;
  if (/^(dev|services|db|migrate|worker|bootstrap|observability)/.test(name))
    return 0;
  if (
    /^(test|check|e2e|generate|contracts|boundaries|tutorial|example)/.test(
      name,
    )
  )
    return 1;
  return 6;
}

export function renderCommandIndex(just, scripts, locale, sourceLink) {
  const texts = TEXTS[locale];
  const groups = texts.commandGroups.map(() => []);
  for (const recipe of Object.values(just.recipes ?? {})) {
    if (recipe.private) continue;
    const argumentsText = (recipe.parameters ?? [])
      .map((parameter) => {
        const name = `${parameter.name}${['star', 'plus'].includes(parameter.kind) ? '...' : ''}`;
        if (parameter.kind === 'star')
          return code(`${name} (${texts.optional})`);
        if (parameter.default === null)
          return code(`${name} (${texts.required})`);
        const value =
          Array.isArray(parameter.default) &&
          parameter.default[0] === 'evaluate'
            ? `$(${parameter.default[1]})`
            : typeof parameter.default === 'string'
              ? parameter.default
              : JSON.stringify(parameter.default);
        return code(`${name}=${value}`);
      })
      .join(', ');
    const commands = (recipe.body ?? [])
      .map((line) => line.filter((part) => typeof part === 'string').join(''))
      .join('\n');
    const files = [
      ...new Set(
        [...commands.matchAll(/(?:^|\s)(scripts\/[\w./-]+\.mjs)/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    const implementation = files.length
      ? files.map((path) => `[${code(path)}](${sourceLink(path)})`).join('<br>')
      : `[justfile](${sourceLink('justfile')})`;
    const dependencies = (recipe.dependencies ?? [])
      .map((dependency) => code(`just ${dependency.recipe}`))
      .join(', ');
    groups[commandGroup(recipe.name)].push([
      code(`just ${recipe.name}`),
      argumentsText || texts.none,
      `${implementation}${dependencies ? `<br>${dependencies}` : ''}`,
    ]);
  }
  for (const [name, command] of Object.entries(scripts))
    groups[commandGroup(name)].push([
      code(`pnpm ${name}`),
      texts.none,
      `${code(command)}<br>[package.json](${sourceLink('package.json')})`,
    ]);
  return (
    `${texts.commandIntro}\n` +
    groups
      .map((rows, index) =>
        rows.length
          ? `\n## ${texts.commandGroups[index]}\n` +
            table([texts.command, texts.arguments, texts.implementation], rows)
          : '',
      )
      .join('')
  );
}
