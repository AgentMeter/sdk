# Testing the npm package against production

Use these steps to test `@agentmeter/cli` from npm against `https://agentmeter.app` while a
localhost-pointing service is already running via launchctl.

## Why swapping is necessary

The background service uses a hardcoded launchd label (`com.agentmeter.sync`) and a shared
log file (`~/.agentmeter/logs/sync.log`). Only one instance can be registered at a time —
installing a new one overwrites the existing plist and restarts the service.

## Notes on sync state and duplicates

`~/.agentmeter/sync-state.json` tracks submitted sessions by ID. Sessions already submitted to
localhost will be marked done and won't re-submit to production. The production server also
deduplicates by session ID, so even if you delete `sync-state.json` before switching, re-submitting
won't create duplicate records — it will just update existing ones.

---

## 1. Tear down the localhost service

```bash
pnpm --filter @agentmeter/cli cli uninstall
```

## 2. Init and install against production

```bash
AGENTMETER_API_KEY=<your-prod-key> npx @agentmeter/cli init
npx @agentmeter/cli install
```

`AGENTMETER_API_URL` defaults to `https://agentmeter.app` when omitted.

## 3. Watch the logs

```bash
tail -f ~/.agentmeter/logs/sync.log
```

## 4. Restore the localhost service when done

```bash
npx @agentmeter/cli uninstall

AGENTMETER_API_KEY=<your-localhost-key> \
AGENTMETER_API_URL=http://localhost:3000 \
pnpm --filter @agentmeter/cli cli init

pnpm --filter @agentmeter/cli cli install
```

Your localhost key is preserved in `~/.agentmeter/config.json` between swaps — `uninstall` only
removes the plist, it never touches the config or sync state.
