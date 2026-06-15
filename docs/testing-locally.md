# Testing the CLI locally against localhost

Use these steps to test `install` / `uninstall` against a local AgentMeter server and verify the service survives reboots.

## 1. Build and init

```bash
pnpm build

AGENTMETER_API_KEY=<your-key> \
AGENTMETER_API_URL=http://localhost:3000 \
pnpm cli init
```

This writes both values to `~/.agentmeter/config.json`.

## 2. Install the service

```bash
pnpm cli install
```

This bakes `AGENTMETER_API_KEY` and `AGENTMETER_API_URL` into the launchd plist (macOS) or systemd unit (Linux) so the service is self-contained after reboot.

## 3. Verify the plist looks right (macOS)

```bash
cat ~/Library/LaunchAgents/com.agentmeter.sync.plist
```

Both env vars should appear in the `EnvironmentVariables` dict.

## 4. Check it's running

```bash
pnpm cli status
launchctl list com.agentmeter.sync
```

## 5. Watch the logs

```bash
tail -f ~/.agentmeter/sync.log
```

## 6. Test reboot persistence

Restart your machine. After login:

```bash
launchctl list com.agentmeter.sync   # should show a PID
tail ~/.agentmeter/sync.log          # should show sync activity
```

> **Note:** `localhost:3000` won't be running automatically after reboot, so the service will log connection errors until your Next.js server is started. That's expected — it confirms the reboot persistence mechanism is working correctly.

## Uninstall when done

```bash
pnpm cli uninstall
```
