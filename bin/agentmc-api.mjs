#!/usr/bin/env node

import("../dist/cli.js")
  .then((mod) => mod.runCli())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
