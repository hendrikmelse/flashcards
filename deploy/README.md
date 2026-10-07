# Deployment runbook

Runs the app at **https://flashcards.hendrikmelse.com** on a single VPS using
Docker Compose, with Caddy in front for HTTPS. This file is the runbook for
setting the server up, deploying, and operating it. Keep it up to date with
anything that changes.

## How it fits together

```
internet ─▶ Caddy (80/443, automatic HTTPS) ─▶ flashcards-api (Node, port 3000)
                                                        │
                                          internal "db" network
                                                        ▼
                                              Postgres (no public port)
```

- **One image** contains the API and the built web app. CI builds it and pushes
  it to GitHub Container Registry, tagged with the commit SHA.
- **Three compose projects** on the server, each independent:

  | Path on server | Purpose |
  |---|---|
  | `/srv/caddy` | Shared reverse proxy. Owns ports 80/443. One block per site in `Caddyfile`. |
  | `/srv/postgres` | Shared Postgres. One database and one role per app. Publishes no ports. |
  | `/srv/flashcards` | This app. `deploy.sh` does pull, migrate, restart, health check, rollback. |

- Two shared Docker networks: `web` (Caddy to apps) and `db` (apps to Postgres).
  Postgres is never on `web`, and Caddy is never on `db`.

**Services this deployment depends on**

| Service | Used for |
|---|---|
| A VPS (Ubuntu 24.04, x86) | Hosting |
| GitHub Actions and the GitHub Container Registry | Testing, building, and deploying the image |
| Let's Encrypt (through Caddy) | HTTPS certificates |
| Resend | Email: verification, password reset, report notifications |
| Backblaze B2, with `restic` | Encrypted offsite copies of the database backups |
| Healthchecks.io | Alert when the nightly backup does not run or fails |
| UptimeRobot | Alert when the site or the database is unreachable |
| Namecheap | DNS for `hendrikmelse.com` |

## 1. Create the server

Any Ubuntu VPS that meets the list below works.

- **Image:** Ubuntu 24.04 LTS, with **root access** and real virtualization
  (KVM), which Docker needs. Avoid images with a control panel such as cPanel
  or Plesk preinstalled.
- **Size:** at least 2 GB RAM and 40 GB disk is comfortable. **1 GB RAM and
  10 GB disk is the bare minimum** and needs the extra steps in "Small servers"
  below. Memory matters because Postgres, the app, Caddy, and Docker all run
  here; disk matters because the images alone are about 1.2 GB and a deploy
  briefly holds two copies of the app image.
- **Location:** close to your users.
- **CPU architecture: choose x86 (amd64), not ARM.** CI builds an amd64 image;
  it will not run on an ARM server.
- **SSH key:** add your public key when creating the server if the provider
  offers it. `ssh-keygen -t ed25519` creates one (on Windows the public half is
  `%USERPROFILE%\.ssh\id_ed25519.pub`). If the server is created with only a
  root password, install the key right after the first login and then turn
  password login off in step 3c.
- **Network firewall** (if the provider offers one): allow inbound TCP 22
  (ideally only from your IP), TCP 80, TCP 443, and UDP 443. The host firewall
  below is the real protection, so this is an extra layer, not a requirement.
- **Optional but worthwhile:** the provider's automated backups or snapshots,
  as a second safety net next to the database dumps below. Check the renewal
  price, not just the first-term price.
- Note the server's IPv4 address (and IPv6 if you want it).

### Small servers (under 2 GB RAM)

Do these during step 3 if the server has 1 GB of RAM:

```bash
# A swap file so a memory spike does not get the database killed
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
```

Also keep disk usage in check: `deploy.sh` already prunes dangling images after
each deploy; watch `df -h` and `docker system df`, and remove old backups
early if space is tight.

## 2. DNS

`hendrikmelse.com` is registered at **Namecheap**. In Namecheap: Domain List,
then **Manage** next to the domain, then the **Advanced DNS** tab, then
**Add New Record**:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `flashcards` | the server's IPv4 | Automatic |
| AAAA Record (optional) | `flashcards` | the server's IPv6 | Automatic |

- Enter just `flashcards` as the host, not the full domain.
- This only works while the domain uses Namecheap's own nameservers (the
  default, "Namecheap BasicDNS"). If its nameservers point elsewhere, for
  example Cloudflare, add the record there instead.
- Make sure there is no other record, such as a URL Redirect, for the same host.
- Leave the records of any other subdomains alone.

Check with `nslookup flashcards.hendrikmelse.com`; it can take a few minutes.
Caddy can only get a certificate once this resolves to the server. Do not put a
proxy (for example Cloudflare's orange cloud) in front until everything works
without one.

## 3. Bootstrap the server

SSH in as root (`ssh root@<ip>`) and run the following. Do the steps in order,
and **do not close your root session until step 3c is confirmed**.

### 3a. Users, packages, Docker, firewall

```bash
apt-get update && apt-get -y upgrade

# An admin user that CI and you will use. No password; key login only.
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy && chmod 440 /etc/sudoers.d/deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys   # reuse your key

# Docker (official apt repository)
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy   # note: docker group access is effectively root

# Host firewall, brute-force protection, automatic security updates
apt-get install -y ufw fail2ban unattended-upgrades
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable
echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades
```

Docker publishes container ports by editing iptables directly, which **bypasses
UFW**. That is fine here because only Caddy publishes ports. Never add a
`ports:` entry to Postgres or an app.

### 3b. Check the deploy user works

In a **new terminal**, from your machine:

```bash
ssh deploy@<ip>
docker ps          # should print an empty table, not a permission error
```

### 3c. Lock down SSH

Only after 3b succeeded, as `deploy` on the server:

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
# Must sort before 50-cloud-init.conf: sshd uses the FIRST value it sees.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
EOF
sudo sshd -t && sudo sshd -T | grep -E "^(passwordauthentication|permitrootlogin) "
sudo systemctl reload ssh
```

**The file name matters.** Ubuntu cloud images ship
`/etc/ssh/sshd_config.d/50-cloud-init.conf` with `PasswordAuthentication yes`,
and sshd keeps the first value it finds, so a file named `99-...` would be
silently ignored. Check the `sshd -T` output says `passwordauthentication no`
and `permitrootlogin no` **before** reloading.

Then test from your machine, in a new terminal, that key login as `deploy`
works and that root login and password login are refused:

```bash
ssh deploy@<ip> true                                   # works
ssh root@<ip> true                                     # Permission denied (publickey)
ssh -o PubkeyAuthentication=no deploy@<ip> true        # Permission denied (publickey)
```

A new server is probed by internet scanners within hours, which is why password
and root login are turned off. Lost access? Use the provider's web console.

## 4. Put the compose files on the server

From the repository root on your machine:

```bash
ssh deploy@<ip> "sudo mkdir -p /srv && sudo chown deploy:deploy /srv"
scp -r deploy/server/caddy deploy/server/postgres deploy/server/flashcards deploy@<ip>:/srv/
ssh deploy@<ip> "chmod +x /srv/flashcards/deploy.sh /srv/flashcards/ci-entrypoint.sh /srv/postgres/backup.sh /srv/postgres/offsite.sh"
```

Then set up the host journal, where all container logs go (see "Logs" below):

```bash
scp deploy/server/system/journald-flashcards.conf deploy@<ip>:/tmp/
ssh deploy@<ip> 'sudo install -d /etc/systemd/journald.conf.d \
  && sudo install -m 644 /tmp/journald-flashcards.conf /etc/systemd/journald.conf.d/flashcards.conf \
  && rm /tmp/journald-flashcards.conf && sudo systemctl restart systemd-journald \
  && sudo usermod -aG systemd-journal deploy'
```

These files change rarely, and **CI does not copy them**: pushes that only touch
`deploy/**` or Markdown files do not trigger a build or deploy. When you change
a file here, re-run the `scp` for it, then `docker compose up -d` in that
service's folder (with `IMAGE` set for the app, see below).

## 5. Postgres

On the server:

```bash
cd /srv/postgres
cp .env.example .env && chmod 600 .env
openssl rand -base64 32        # paste the output as POSTGRES_PASSWORD
nano .env
docker compose up -d
docker compose ps              # wait until it reports "healthy"
```

Create this app's role and database:

```bash
APP_PW="$(openssl rand -base64 24 | tr -d '/+=')"   # no characters that need URL-encoding
docker compose exec -T postgres psql -U postgres <<SQL
create role flashcards login password '$APP_PW';
create database flashcards owner flashcards;
SQL
echo "$APP_PW"
```

Then configure the app with that password:

```bash
cd /srv/flashcards
cp .env.example .env && chmod 600 .env
nano .env    # 1) replace change-me in DATABASE_URL with the password printed above
             # 2) set RESEND_API_KEY (see "Email (Resend)" below)
             # 3) set REPORT_NOTIFY_EMAIL to where reports should be emailed (optional)
```

Sign-up is **open**: `compose.yaml` sets `REGISTRATION_MODE=open`, so anyone can
create an account. The server refuses to start in production if no registration mode
is set, so whether sign-up is open is always a choice. To limit it to a list of
emails, or to close it, see "Who can register".

## 6. Caddy

```bash
cd /srv/caddy
docker compose up -d
docker compose logs -f caddy    # watch for the certificate being obtained
```

Start Caddy and Postgres **before** the app: they create the `web` and `db`
networks that the app's compose file expects to exist.

## 7. Connect GitHub and deploy

1. **Create a dedicated deploy key** on your machine, outside the repo folder:

   ```bash
   ssh-keygen -t ed25519 -f ~/flashcards_deploy -C "github-actions-deploy" -N ""
   ```

2. **Authorize it as a restricted key.** The deploy user can run Docker, which
   is effectively root, so the CI key must not get a shell. Append this single
   line to `/home/deploy/.ssh/authorized_keys` (the public key is the contents of
   `~/flashcards_deploy.pub`):

   ```
   restrict,command="/srv/flashcards/ci-entrypoint.sh" ssh-ed25519 AAAA... github-actions-deploy
   ```

   `ci-entrypoint.sh` accepts exactly `deploy ghcr.io/hendrikmelse/flashcards:<40-hex
   sha> <github user>`, logs in to the registry with the token sent on stdin, and
   runs `deploy.sh`. `restrict` disables shells, terminals, port forwarding and
   agent forwarding. Test it: `ssh -i ~/flashcards_deploy deploy@<ip> id` must
   answer `only 'deploy <image> <actor>' is allowed`. Requests are logged:
   `sudo journalctl -t flashcards-deploy`.

3. **Get the server's host key** so CI can verify it is talking to your server,
   and compare it with the fingerprint the server itself reports over your
   authenticated login:

   ```bash
   ssh-keyscan -t ed25519 <ip>
   ssh deploy@<ip> ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```

4. **Add GitHub repository secrets** (Settings, Secrets and variables, Actions):

   | Secret | Value |
   |---|---|
   | `DEPLOY_HOST` | the server's **IP address** (the pinned host key line is keyed by IP, so a hostname would not match) |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | the full contents of the private key file `~/flashcards_deploy` |
   | `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output line |

   Then add the repository **variable** `DEPLOY_ENABLED` = `true`. Until it is
   set, CI builds and tests but never deploys. Delete the local key files
   afterwards or store them somewhere safe. Never commit them.

5. **Push to `main`** (or re-run the workflow). CI runs the tests, builds the
   image, pushes it to `ghcr.io/hendrikmelse/flashcards`, and deploys it over
   SSH. The server pulls with the workflow's short-lived token, so no registry
   password is stored on it.

6. **One-time: create the language rows** (production has no sample data):

   ```bash
   cd /srv/flashcards
   export IMAGE="$(cat current-image)"
   docker compose run --rm --no-deps api node apps/api/dist/seed-languages.js
   ```

7. **Import the content** (see "Importing content" below), and make your account
   an admin if you want the admin dashboard (see "Admins").

## 8. Verify and monitor

```bash
curl -i https://flashcards.hendrikmelse.com/api/ready   # 200 {"status":"ok"}
```

Then open https://flashcards.hendrikmelse.com, create an account, and check the
pack pages load. Look for a padlock, and in the
browser's console for any Content-Security-Policy violations. (Errors that
mention `triggerAutofillScriptInjection`, or whose source is a
`chrome-extension://` or `moz-extension://` file, come from a password-manager
or autofill browser extension, not from the app. A private window with
extensions off will not show them.)

Plain `docker compose` commands in `/srv/flashcards` need `IMAGE` set, because
the compose file requires it; prefix them with
`IMAGE="$(cat /srv/flashcards/current-image)"`.

### Logs

The app, Postgres, and Caddy send their logs to the host's systemd journal
instead of storing them inside the container, because a container's own log is
deleted with the container and every deploy replaces the app container. The
journal outlives containers and reboots, and is capped at 500 MB and 30 days
(`/etc/systemd/journald.conf.d/flashcards.conf`).

```bash
sudo journalctl -t flashcards-api -o cat --since "1 hour ago"   # the app
sudo journalctl -t postgres --since today                      # database
sudo journalctl -t caddy --since today                         # web server / certificates
sudo journalctl -t flashcards-deploy -o cat                    # deploy requests, and rejected attempts
sudo journalctl -t flashcards-api -f                           # follow live
```

The `deploy` user can omit `sudo` after logging in again, since it is in the
`systemd-journal` group. `docker logs flashcards-api` still works, but only
shows the current container. The app logs one JSON object per line; add
`-o cat` for clean output.

### Uptime monitoring (UptimeRobot)

An outside check is the only thing that notices when the whole server is down,
so the site is watched from UptimeRobot (a check every 5 minutes, alerts by
email to the owner). It has two monitors:

| Monitor | URL | What a failure means |
| --- | --- | --- |
| API and database | `https://flashcards.hendrikmelse.com/api/ready` | the app is down, or it cannot reach Postgres |
| The web app | `https://flashcards.hendrikmelse.com/` | Caddy, DNS, the certificate, or the web app is broken, even when the API is fine |

`/api/ready` is the right one to watch: it runs `select 1` and answers 503 when the
database is unreachable, where `/api/health` only says the process is up (and is
what the container's own health check uses, so a database outage does not restart
the app for nothing). Both return only a status, so leaving them public leaks
nothing.

During planned downtime (a Postgres major upgrade, say), pause the monitors in the
UptimeRobot dashboard first, so the alerts are not noise. The backup check at
Healthchecks.io (see "Backups") is separate: it watches that the nightly backup
ran, not that the site is reachable.

### Email (Resend)

The app sends three kinds of email to users: a confirmation link for a new
account, a password reset link, and a confirmation link for a new address. It
also emails the owner about each report and comment, when `REPORT_NOTIFY_EMAIL`
is set. All of it goes out through [Resend](https://resend.com), from
`noreply@mail.hendrikmelse.com`, a subdomain used only for this, so the app's
mail reputation stays apart from the rest of `hendrikmelse.com`.

The app **refuses to start** without `RESEND_API_KEY` (a secret, in
`/srv/flashcards/.env`), `MAIL_FROM`, and `PUBLIC_URL` (not secret, in
`compose.yaml`), like it does without `REGISTRATION_MODE`. If the key is
missing, a new release never becomes healthy and `deploy.sh` rolls back (the old
version keeps running).

One-time setup:

1. In Resend, add the domain `mail.hendrikmelse.com` (region: the one closest to
   the server). It shows DNS records (an MX and an SPF TXT for the `send`
   subdomain, and a DKIM TXT at `resend._domainkey.mail`).
2. Add them in Namecheap, Advanced DNS, **exactly as shown**. Namecheap wants only
   the host part (`send.mail`, `resend._domainkey.mail`), not the full name. Click
   Verify in Resend; it can take a few minutes. Optionally add a DMARC record:
   host `_dmarc`, TXT `v=DMARC1; p=none; rua=mailto:<your address>`.
3. Create an API key in Resend with **sending access** limited to that domain.
4. On the server, add it to `/srv/flashcards/.env` as `RESEND_API_KEY=re_...`
   (the file is mode 600). Never commit it or paste it into a chat.
5. `scp` the updated `deploy/server/flashcards/compose.yaml`, then deploy as
   usual (push to `main`, or run the workflow).

To check it from the outside: on the login page, use "Forgot your password?" with
your own address. The email should arrive within a minute (check spam the first
time), the link should open the choose-a-password page at
`https://flashcards.hendrikmelse.com/reset-password?token=...`, and the new
password should work.

If an email does not arrive: `sudo journalctl -t flashcards-api -o cat --since "10 min ago" | grep -i email`
shows what Resend answered (an unverified domain or a revoked key are the usual
causes), and the Resend dashboard, Emails, lists every message and what happened
to it. Sign-up and "Forgot your password?" never tell the visitor an email failed
(the first so it cannot be used to learn who has an account, the second so
sign-up does not depend on Resend being up); the account page can send the
confirmation again.

To move to another domain: add and verify the new sending domain in Resend,
then change `MAIL_FROM` and `PUBLIC_URL` in `compose.yaml`, `scp` it and redeploy.
Links already sent point at the old `PUBLIC_URL` and expire on their own (an hour
for a reset, three days for the others).

## 9. Backups

A nightly dump runs from the first day, and an encrypted copy of it goes offsite.
`backup.sh` writes compressed dumps of every app database (plus roles) to
`/srv/postgres/backups` and keeps 14 days. A **systemd timer** runs it every
night at **03:00 Pacific time**. It is a timer rather than cron because systemd
accepts the timezone in the schedule, so it stays at 3 am local through daylight
saving changes (10:00 UTC in summer, 11:00 UTC in winter); it also runs a missed
backup after the server was off, and logs to the journal. Install it once
(the unit files are in `deploy/server/system/`):

```bash
scp deploy/server/system/flashcards-backup.service deploy/server/system/flashcards-backup.timer deploy@<ip>:/tmp/
ssh deploy@<ip> 'sudo install -m 644 /tmp/flashcards-backup.service /tmp/flashcards-backup.timer /etc/systemd/system/ \
  && rm /tmp/flashcards-backup.* && sudo systemctl daemon-reload && sudo systemctl enable --now flashcards-backup.timer'
```

Check on it:

```bash
systemctl list-timers flashcards-backup.timer      # when it last ran and when it runs next
sudo journalctl -u flashcards-backup -o cat        # what each run did
systemctl status flashcards-backup.service         # "Result: success" or a failure
sudo systemctl start flashcards-backup.service     # run one now
ls -lh /srv/postgres/backups                       # the dumps (the directory is mode 700)
```

**Alerts (Healthchecks.io).** `offsite.sh` pings a Healthchecks.io check when it
starts, when it succeeds, and when it fails. The check expects a ping about daily,
so a failed run, a failed dump (the offsite step only runs after a good one), a
stopped timer, or a dead server all lead to an email. The roles file
(`globals-*.sql`) contains password hashes: keep the directory private; `restic`
encrypts everything it copies off the server.

**Practice a restore before you need one.** This restores into a scratch
database and never touches the live one:

```bash
cd /srv/postgres
ls backups
docker compose exec -T postgres psql -U postgres -c "create database restore_test owner flashcards"
docker compose exec -T postgres pg_restore -U postgres -d restore_test --no-owner --role=flashcards < backups/flashcards-<stamp>.dump
docker compose exec -T postgres psql -U postgres -d restore_test -c "select count(*) from users"
docker compose exec -T postgres psql -U postgres -c "drop database restore_test"
```

### Offsite backups (Backblaze B2 through restic)

`offsite.sh` runs right after `backup.sh` as an `ExecStartPost=` of the backup
service. It copies `/srv/postgres/backups` into an encrypted `restic` repository
in a private B2 bucket, keeps 7 daily, 4 weekly, and 6 monthly snapshots, checks
the repository (plus a 10% slice of its data) each night and pings Healthchecks.

One-time setup, besides the unit files above:

1. In Backblaze: a private bucket with the lifecycle rule "keep only the last
   version" (otherwise files `restic` removes stay as hidden versions and storage
   grows), and an application key limited to that bucket (not the master key).
2. Invent a long random `restic` password and **keep it outside the server** (a
   password manager). Without it the backups cannot be read.
3. A Healthchecks.io check (period 1 day, grace about 6 hours) and its ping URL.
4. Put the secrets in a root-only file the unit reads, `/etc/flashcards-backup.env`
   (mode 600, owner root): `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (the B2
   key id and key), `RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>`,
   `RESTIC_PASSWORD`, and `HC_PING_URL`.
5. `sudo apt-get install restic`, then once, with that file loaded as root,
   `restic init`. Copy `offsite.sh` to `/srv/postgres`, install the updated unit
   file and `sudo systemctl daemon-reload`.

Look at the offsite copies with `restic snapshots`, and restore with
`restic restore latest --target <dir>`, both with the variables from the env file
set (`sudo bash -c 'set -a; . /etc/flashcards-backup.env; set +a; restic snapshots'`).
Restoring the dump from there into a scratch database is the same procedure as
the drill above.

To rebuild after a total loss: create a new server (steps 1 to 6), restore the
roles with `psql -U postgres < globals-<stamp>.sql`, create the database, then
`pg_restore` the dump into it.

## 10. Rolling back

Deploy the previous image tag (commit SHA) with the same script:

```bash
/srv/flashcards/deploy.sh ghcr.io/hendrikmelse/flashcards:<previous-sha>
```

`deploy.sh` also rolls back automatically if a new version never becomes
healthy **and ready** (the container's liveness check, then `/api/ready`, which
needs the database), and then waits to confirm the old version is healthy again
(it prints `rollback succeeded` or `rollback FAILED`). A failed deploy exits with
an error, so the CI run fails. If the database itself is down during a deploy, the
new version cannot become ready either, so the deploy fails and the old version
keeps running: deploy again when the database is back. If a migration fails, the deploy
stops before touching the running app. Because the app is a single container,
every deploy has a few seconds of downtime while it restarts.
**Database migrations are not undone by a rollback.** Keep them
backward compatible: add columns and tables in one deploy, and remove the old
ones only in a later one.

To check that a bad release is rejected, or that the uptime alert still works,
deploy a throwaway image that cannot reach the database: build it on the server
from the live image with a bad `DATABASE_URL`, and run a copy of `deploy.sh` that
skips the registry pull. `deploy.sh` should report that it did not become healthy
and ready, roll back, and exit with an error. To test the alert instead, the bad
release has to stay up longer than the monitor's 5-minute interval, so use a copy
of `deploy.sh` without the readiness check, then roll back by hand with the command
above.

## 11. Routine maintenance

- Security updates install themselves. Check for a pending reboot now and then:
  `ls /var/run/reboot-required`.
- Update Caddy and Postgres within their major versions: in each of
  `/srv/caddy` and `/srv/postgres`, run `docker compose pull && docker compose up -d`.
  A Postgres **major** upgrade (for example 17 to 18) is a manual dump and restore.
- Keep an eye on disk: `df -h` and `docker system df`. `deploy.sh` keeps only
  the current and the previous app image (so a rollback needs no download) and
  removes older ones itself.
- Pause the UptimeRobot monitors before any planned downtime.
- To redeploy without making a commit, use the **Run workflow** button on the
  CI workflow in the Actions tab (on `main`). It rebuilds and redeploys.

## Importing content

Word and pack content lives in the repo as reviewed JSON under `content/`
(`concepts/` for the words, `packs/` for the packs) and is baked into the
image, so a content change reaches the server through the normal deploy.
Importing is a separate, manual step (like `seed-languages`), so nothing changes
for users until you run it:

```bash
cd /srv/flashcards
export IMAGE="$(cat current-image)"
docker compose run --rm --no-deps api node apps/api/dist/import-content.js
```

It validates every file first and imports nothing if any has an error. It is
safe to repeat: concepts are matched by key, so a rerun updates in place and
removes entries and sentences that were dropped from the files. It never
touches user data, and it never deletes a concept or pack that the files stop
mentioning (cards and reviews point at concepts); it lists them at the end so
you can clean up by hand.
`--check` validates without a database: add it to the command above, or run
`npm run content:check` locally.

## Reading problem reports

Users can send in four kinds of reports: a problem with a word, a bug, a feature
suggestion, and a request for a pack. If `REPORT_NOTIFY_EMAIL` is set in
`/srv/flashcards/.env` (restart the container after changing it), each report is
emailed to that address as it comes in. A report is a conversation: its sender can
add comments while it is open (each is emailed to you too), and you reply. Senders
see their own reports, with the status and the conversation, on the Reports page.

In the app, the Admin dashboard's Manage reports page is the place to answer them:
click a report to open it, reply, then resolve it (which needs at least one
reply). The same can be done on the server:

```bash
cd /srv/flashcards
export IMAGE="$(cat current-image)"
docker compose run --rm --no-deps api node apps/api/dist/reports.js
```

Each report shows its short id, its kind or reason, what it is about (for a word,
the word in both languages with its content key), the sender's note, and who sent it,
with the conversation under it. To answer, run
`... reports.js reply <id> "reply"`, or resolve with
`... reports.js resolve <id> [<id>...] [-m "reply"]` (the first 8 characters of the
id are enough; a reply given with `-m` is added to the conversation first).
`reports.js --all` also lists resolved ones. For a problem with a word, fix it in
`content/`, deploy, and import again (see above) before you resolve the report.

## Admins

Every account is a user unless it is made an admin. Admins get an Admin dashboard (the shield
button in the header, next to the reports button) where they can read everyone's reports and
reply to, resolve, or reopen them in the app instead of with `reports.js`. Make an account an
admin on the server:

```bash
cd /srv/flashcards
export IMAGE="$(cat current-image)"
docker compose run --rm --no-deps api node apps/api/dist/user-role.js you@example.com admin
```

Use `user` instead of `admin` to take it away. The app never changes an account's type itself,
and the admin routes check it on the server, so the button only being hidden is not the protection.

## Who can register

`REGISTRATION_MODE` in `compose.yaml` decides who can create an account. Logging in
never depends on it.

| Mode | Who can register |
|---|---|
| `open` | Anyone. This is how the live site is set up. |
| `allowlist` | Only the emails in `ALLOWED_EMAILS` (in `/srv/flashcards/.env`). Anyone else gets a 403 "Registration is closed". |
| `closed` | No one. |

To change the mode, edit `REGISTRATION_MODE` in `deploy/server/flashcards/compose.yaml`, `scp` it to
`/srv/flashcards/`, and apply it:
`cd /srv/flashcards && IMAGE="$(cat current-image)" docker compose up -d` (compose recreates the
container when its environment changes). With `allowlist`, invite someone by adding their email to
`ALLOWED_EMAILS` (comma-separated) and applying it the same way, then tell them to sign up at
https://flashcards.hendrikmelse.com/register with that exact email. An allowlist tells an outsider
who guesses an address whether it is on it.

**Things to watch with open sign-up:**

- Every sign-up sends a verification email through Resend, so the plan's limits (the free plan
  allows 100 emails a day and 3,000 a month) cap how many people can sign up and reset
  passwords. Watch the Resend dashboard, and switch to `allowlist` or `closed` if sign-up is being
  abused.
- Sign-up and sign-in are rate limited per client (10 a minute), which slows one source down but
  not many. A confirmed email address is not required to use the app yet.
- Reports arrive from anyone, so `REPORT_NOTIFY_EMAIL` can get busy.

## Adding another app to this server

1. Create its role and database in the shared Postgres (step 5).
2. Give it its own `/srv/<app>` compose project with containers on the `web`
   and `db` networks (same pattern as `flashcards/compose.yaml`), and no published ports.
3. Add a site block to `/srv/caddy/Caddyfile` and run
   `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.
4. Add the DNS record.

## Testing changes to the deploy files locally

After changing the Dockerfile, compose files, or `deploy.sh`, run the stack
locally before pushing. In outline:

1. `docker build -t flashcards:local .`
2. Copy `deploy/server/*` to a scratch folder. Start `postgres` (real compose),
   create the role and database (step 5), start a throwaway registry
   (`docker run -d -p 5000:5000 registry:2`), push the image to it as
   `localhost:5000/flashcards:v1`.
3. For Caddy, add a `compose.override.yaml` that maps `8080:80` and mounts a
   `:80 { reverse_proxy flashcards-api:3000 }` Caddyfile (the real one
   requests a public certificate), then `docker compose up -d`.
4. In the `flashcards` folder, create `.env` and run
   `./deploy.sh localhost:5000/flashcards:v1`. Browse http://localhost:8080.
5. Tear down: `docker compose down -v` in each folder, `docker rm -f registry`,
   and `docker network rm web db`.
