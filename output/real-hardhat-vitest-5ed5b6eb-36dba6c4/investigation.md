# Investigation Report

The Hardhat test suite fails under Vitest because hardhat.config.ts uses ES Module import/export syntax, but the project's package.json lacks "type": "module" and tsconfig.json specifies "module": "commonjs". This mismatch causes Hardhat's internal config loader to treat the config file as CommonJS despite its ES Module syntax, resulting in 'Cannot use import statement outside a module' during Vitest execution. The authoritative baseline confirms the failure originates in Hardhat's config-loading.ts when loading hardhat.config.ts.
