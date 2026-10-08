# Investigation Report

Investigation shows jest.setup.js imports node:stream/web while jest.config.js specifies jsdom as the test environment. The jsdom environment does not provide full Node.js core stream support, causing Jest 30's internal protectProperties logic to fail with ERR_INVALID_THIS when attempting to wrap ReadableStreamDefaultReader. Evidence confirms the incompatible import occurs in jest.setup.js, and the environment configuration is declared in jest.config.js.
