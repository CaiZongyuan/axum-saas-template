#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createProject } from './project.mjs';

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'no-examples': { type: 'boolean', default: false },
      repository: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: create-axum-saas [project-directory] [--no-examples] [--repository owner/repo]',
    );
  } else {
    if (positionals.length > 1)
      throw new Error('Provide one project directory');
    let directory = positionals[0];
    if (!directory) {
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        directory = await prompt.question('Project name: ');
      } finally {
        prompt.close();
      }
    }
    const project = await createProject(directory, {
      examples: !values['no-examples'],
      repository: values.repository,
    });
    console.log(
      `\nCreated ${project.name}\nReference applications: ${values['no-examples'] ? 'removed' : 'included'}\nWeb: http://127.0.0.1:${project.ports.WEB_PORT}\nAPI: http://127.0.0.1:${project.ports.APP_PORT}\n\nNext:\n  cd ${shellQuote(directory)}\n  pnpm install\n  just dev`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
