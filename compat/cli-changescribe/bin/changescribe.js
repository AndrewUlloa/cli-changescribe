#!/usr/bin/env node

process.stderr.write(`
ChangeScribe has moved to Diffwright.

Migrate when convenient:
  npm uninstall -g cli-changescribe
  npm install -g diffwright

Your command will continue through the compatibility bridge for now.

`);

require('diffwright/bin/diffwright.js');
