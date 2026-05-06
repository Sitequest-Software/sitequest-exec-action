# Sitequest Exec

Run a shell command on a [Sitequest](https://site.quest) VPS or webspace from a GitHub Actions workflow. No SSH keys, no `known_hosts` shuffling — just an API key.

## Quick start

```yaml
- uses: sitequest/exec-action@v1
  with:
    api-key:  ${{ secrets.SITEQUEST_API_KEY }}
    resource: webspace
    id:       ${{ vars.SITEQUEST_WEBSPACE_ID }}
    command:  php artisan migrate --force
    cwd:      public_html
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `api-key` | yes | — | API key with `vps:manage` or `webspace:manage` scope. |
| `resource` | yes | — | `vps` or `webspace`. |
| `id` | yes | — | Resource ID. |
| `command` | yes | — | Shell command (multi-line allowed). |
| `cwd` | no | `""` | Working directory. |
| `timeout` | no | `300` | Timeout in seconds (max 300, server-enforced). |
| `fail-on-non-zero` | no | `true` | Fail the step on non-zero exit. |
| `api-base` | no | `https://panel.site.quest` | Override for staging. |

## Outputs

| Name | Description |
|------|-------------|
| `exit-code` | Remote exit code (`-1` if the request itself failed). |
| `stdout` | Captured stdout. |
| `stderr` | Captured stderr. |
| `duration-ms` | End-to-end duration. |

## Composition with the deploy actions

```yaml
- uses: sitequest/deploy-webspace-action@v1
  with:
    api-key:     ${{ secrets.SITEQUEST_API_KEY }}
    webspace-id: ${{ vars.SITEQUEST_WEBSPACE_ID }}
    source:      dist

- uses: sitequest/exec-action@v1
  with:
    api-key:  ${{ secrets.SITEQUEST_API_KEY }}
    resource: webspace
    id:       ${{ vars.SITEQUEST_WEBSPACE_ID }}
    command:  php artisan cache:clear && php artisan config:cache
    cwd:      public_html
```

Capture output for downstream steps:

```yaml
- id: status
  uses: sitequest/exec-action@v1
  with:
    api-key:  ${{ secrets.SITEQUEST_API_KEY }}
    resource: vps
    id:       ${{ vars.SITEQUEST_VPS_ID }}
    command:  systemctl is-active myapp.service

- run: echo "Service status was '${{ steps.status.outputs.stdout }}'"
```

## Security

- Commands run as the **webspace user** (jailed home dir) for `webspace`, or as **root** for `vps`. Treat the API key accordingly.
- All input values are masked via `core.setSecret(api-key)`.
- `cwd` is single-quote-escaped before being concatenated into the shell pipeline.
- Server-side: every call is audited as `WEBSPACE_EXEC` / `VM_EXEC` with the truncated command and exit code.

## License

MIT
