#!/usr/bin/env node

import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, a => r(a.trim())));

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function checkCli(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`
${c.bold}╔═══════════════════════════════════════════╗
║       CLI-to-API Proxy Setup Wizard       ║
╚═══════════════════════════════════════════╝${c.reset}
`);

  // 1. Check CLIs
  console.log(`${c.bold}${c.cyan}1. Checking CLI installations${c.reset}\n`);
  
  const hasClaude = checkCli('claude');
  const hasKiro = checkCli('kiro-cli');

  if (hasClaude) {
    console.log(`   ${c.green}✓${c.reset} Claude CLI found`);
    console.log(`   ${c.dim}  Requires Claude Max subscription${c.reset}`);
  } else {
    console.log(`   ${c.red}✗${c.reset} Claude CLI not found`);
    console.log(`   ${c.dim}  Install: npm i -g @anthropic-ai/claude-cli && claude login${c.reset}`);
  }

  if (hasKiro) {
    console.log(`   ${c.green}✓${c.reset} Kiro CLI found`);
    console.log(`   ${c.dim}  Free with AWS Builder ID${c.reset}`);
  } else {
    console.log(`   ${c.red}✗${c.reset} Kiro CLI not found`);
    console.log(`   ${c.dim}  Install: npm i -g @anthropic-ai/kiro-cli && kiro-cli auth login${c.reset}`);
  }

  if (!hasClaude && !hasKiro) {
    console.log(`\n${c.red}No CLI found. Install at least one CLI first.${c.reset}\n`);
    rl.close();
    process.exit(1);
  }

  // 2. Default provider
  console.log(`\n${c.bold}${c.cyan}2. Default provider${c.reset}\n`);
  
  let defaultProvider = 'kiro';
  if (hasClaude && hasKiro) {
    console.log(`   ${c.dim}You can always override per-request with model names like kiro/sonnet or claude/sonnet${c.reset}\n`);
    const choice = await ask(`   Default (1=Kiro, 2=Claude) [1]: `);
    defaultProvider = choice === '2' ? 'claude' : 'kiro';
  } else {
    defaultProvider = hasKiro ? 'kiro' : 'claude';
  }
  console.log(`   ${c.green}✓${c.reset} Default: ${defaultProvider}`);

  // 3. API Key
  console.log(`\n${c.bold}${c.cyan}3. Proxy API Key${c.reset}`);
  console.log(`   ${c.dim}Protects your proxy from unauthorized access${c.reset}\n`);
  
  const genChoice = await ask(`   Generate random key? (Y/n): `);
  let apiKey: string;
  
  if (genChoice.toLowerCase() === 'n') {
    apiKey = await ask(`   Enter your key: `);
    if (!apiKey) apiKey = 'sk-' + randomBytes(24).toString('hex');
  } else {
    apiKey = 'sk-' + randomBytes(24).toString('hex');
  }
  console.log(`   ${c.green}✓${c.reset} Key: ${apiKey.slice(0, 20)}...`);

  // 4. Port
  console.log(`\n${c.bold}${c.cyan}4. Port${c.reset}\n`);
  const portInput = await ask(`   Port [8082]: `);
  const port = portInput || '8082';
  console.log(`   ${c.green}✓${c.reset} Port: ${port}`);

  // 5. Save
  console.log(`\n${c.bold}${c.cyan}5. Saving configuration${c.reset}\n`);
  
  const env = `PROXY_PORT=${port}
PROXY_API_KEY=${apiKey}
DEFAULT_PROVIDER=${defaultProvider}
`;
  writeFileSync('.env', env);
  console.log(`   ${c.green}✓${c.reset} Created .env`);

  // Summary
  console.log(`
${c.bold}╔═══════════════════════════════════════════════════════════════╗
║                        Setup Complete                         ║
╚═══════════════════════════════════════════════════════════════╝${c.reset}

   Start: ${c.cyan}npm start${c.reset}

${c.bold}   For your apps:${c.reset}
   ┌────────────────────────────────────────────────────────────┐
   │  Base URL   ${c.green}http://localhost:${port}/v1${c.reset}                       │
   │  API Key    ${c.green}${apiKey}${c.reset}  │
   │  Model      ${c.green}${defaultProvider}/sonnet${c.reset}                                       │
   └────────────────────────────────────────────────────────────┘

   Models: ${hasKiro ? 'kiro/sonnet, kiro/opus, kiro/haiku' : ''}${hasClaude && hasKiro ? ', ' : ''}${hasClaude ? 'claude/sonnet, claude/opus, claude/haiku' : ''}
`);

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); process.exit(1); });
