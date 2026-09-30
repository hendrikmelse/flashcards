# Deployment runbook

Runs the app at **https://flashcards.hendrikmelse.com** on a single VPS using
Docker Compose, with Caddy in front for HTTPS.

> **Status: live.** The app runs at https://flashcards.hendrikmelse.com on an
> IONOS VPS, deployed by CI. Rollback and the backup/restore drill were verified
> locally in Docker, not yet on the server (see the verification sections at the
> end). Update this file with anything you learn.

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

## 1. Create the server

Any Ubuntu VPS that meets the list below works. The plan is an **IONOS VPS**;
provider-specific wording is marked, the rest is generic.

- **Image:** Ubuntu 24.04 LTS, with **root access** and real virtualization
  (KVM), which Docker needs. Avoid images with a control panel such as cPanel
  or Plesk preinstalled.
- **Size:** at least 2 GB RAM and 40 GB disk is comfortable. **1 GB RAM and
  10 GB disk is the bare minimum** and needs the extra steps in "Small servers"
  below. Memory matters because Postgres, the app, Caddy and Docker all run
  here; disk matters because the images alone are about 1.2 GB and a deploy
  briefly holds two copies of the app image.
- **Location:** the US location closest to US West that the plan offers.
- **CPU architecture: choose x86 (amd64), not ARM.** CI builds an amd64 image;
  it will not run on an ARM server.
- **SSH key:** add your public key when creating the server if the panel
  offers it (IONOS has an SSH keys section). On Windows, `ssh-keygen -t ed25519`
  creates one; the public half is `%USERPROFILE%\.ssh\id_ed25519.pub`. If the
  server is created with only a root password, install the key right after the
  first login and then turn password login off in step 3c.
- **Network firewall** (if the provider offers one; IONOS has firewall policies
  in its panel): allow inbound TCP 22 (ideally only from your IP), TCP 80,
  TCP 443, and UDP 443. The host firewall below is the real protection, so this
  is an extra layer, not a requirement.
- **Optional but worthwhile:** the provider's automated backups or snapshots.
  They cost a little extra and are a second safety net next to the database
  dumps below. Check the renewal price, not just the first-term price.
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

Expect a lot of noise from internet scanners: a server a couple of hours old
had already logged about 200 failed login attempts, which is why password and
root login are turned off. Lost access? Use the provider's web console.

## 4. Put the compose files on the server

From the repository root on your machine:

```bash
ssh deploy@<ip> "sudo mkdir -p /srv && sudo chown deploy:deploy /srv"
scp -r deploy/server/caddy deploy/server/postgres deploy/server/flashcards deploy@<ip>:/srv/
ssh deploy@<ip> "chmod +x /srv/flashcards/deploy.sh /srv/flashcards/ci-entrypoint.sh /srv/postgres/backup.sh"
```

These files change rarely. Re-run the `scp` when they do.

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
             # 2) set ALLOWED_EMAILS to the email(s) allowed to register
```

The app is **invite-only**: `compose.yaml` sets `REGISTRATION_MODE=allowlist`, so
only the emails in `ALLOWED_EMAILS` can create an account. The server refuses to
start in production if no registration mode is set, so sign-ups can never be
left open by accident.

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

## 8. Verify

```bash
curl -i https://flashcards.hendrikmelse.com/api/ready   # 200 {"status":"ok"}
```

Then open https://flashcards.hendrikmelse.com, register with an email on the
allowlist, and check the pack pages load. Look for a padlock, and in the
browser's console for any Content-Security-Policy violations. On the server,
read the app's logs with `docker logs --tail 100 flashcards-api`. (Plain
`docker compose` commands in `/srv/flashcards` need `IMAGE` set, because the
compose file requires it; prefix them with
`IMAGE="$(cat /srv/flashcards/current-image)"`.)

## 9. Backups

> **Plan:** turn on the nightly dump below from day one (it is free and guards
> against your own mistakes). Offsite copies can wait, but **must be in place
> before anyone other than you uses the app.**

The dump script writes compressed dumps of every app database (plus roles) to
`/srv/postgres/backups` and keeps 14 days. Schedule it as the `deploy` user
(`crontab -e`):

```
17 3 * * * /srv/postgres/backup.sh >> /srv/postgres/backup.log 2>&1
```

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

### Offsite backups (not set up yet)

Dumps on the same disk do not survive losing the server. Copy them elsewhere
too, for example with `restic` to an S3-compatible bucket (Backblaze B2 is cheap)
or `rsync` to a provider storage box, run right after `backup.sh` in cron. This
needs an account and credentials from you, so it is left for when you choose a
destination.

To rebuild after a total loss: create a new server (steps 1 to 6), restore the
roles with `psql -U postgres < globals-<stamp>.sql`, create the database, then
`pg_restore` the dump into it.

## 10. Rolling back

Deploy the previous image tag (commit SHA) with the same script:

```bash
/srv/flashcards/deploy.sh ghcr.io/hendrikmelse/flashcards:<previous-sha>
```

`deploy.sh` also rolls back automatically if a new version never becomes
healthy, and then waits to confirm the old version is healthy again (it prints
`rollback succeeded` or `rollback FAILED`). If a migration fails, the deploy
stops before touching the running app. Because the app is a single container,
every deploy has a few seconds of downtime while it restarts.
**Database migrations are not undone by a rollback.** Keep them
backward compatible: add columns and tables in one deploy, and remove the old
ones only in a later one.

## 11. Routine maintenance

- Security updates install themselves. Check for a pending reboot now and then:
  `ls /var/run/reboot-required`.
- Update Caddy and Postgres within their major versions: in each of
  `/srv/caddy` and `/srv/postgres`, run `docker compose pull && docker compose up -d`.
  A Postgres **major** upgrade (for example 17 to 18) is a manual dump and restore.
- Keep an eye on disk: `df -h` and `docker system df`.

## Inviting someone

1. Add their email to `ALLOWED_EMAILS` (comma-separated) in `/srv/flashcards/.env`.
2. Apply it: `cd /srv/flashcards && IMAGE="$(cat current-image)" docker compose up -d`
   (compose recreates the container when its environment changes).
3. Tell them to sign up at https://flashcards.hendrikmelse.com/register with
   that exact email. Login for existing accounts never depends on the list.

Anyone not on the list gets a 403 "Registration is closed". Note that this
tells an outsider who guesses an address whether it is on the list; fine for a
private test, but worth replacing with invite codes before a wider launch.

## Adding another app to this server

1. Create its role and database in the shared Postgres (step 5).
2. Give it its own `/srv/<app>` compose project with containers on the `web`
   and `db` networks (same pattern as `flashcards/compose.yaml`), and no published ports.
3. Add a site block to `/srv/caddy/Caddyfile` and run
   `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.
4. Add the DNS record.

## What has been verified

Run locally with Docker Desktop, using the real compose files and scripts from
this directory (only Caddy's port and site address were overridden, and a
local registry container stood in for GHCR):

- The image builds (about 25 s), is 405 MB, runs as the non-root `node` user,
  and contains no dev tooling.
- The real `Caddyfile` validates. Postgres and the app start on the shared
  `web`/`db` networks; neither Postgres nor the app publishes a port.
- Creating the role and database with the commands in step 5 works.
- `deploy.sh`: a first deploy applies the migrations to an empty database and
  the app turns healthy in about 11 s. A second deploy updates it. A release
  that crashes is rolled back automatically, and the rollback is verified. A
  release whose migration fails leaves the running app untouched. Verified
  rollback takes about 13 s.
- `seed-languages`, the app behind Caddy (app shell, client routes, cache and
  security headers, the Origin check), and invite-only registration all work.
  A spoofed `X-Forwarded-For` does not evade the login rate limit, because
  Caddy overwrites it with the real client address.
- Hardening: read-only root filesystem, zero capabilities, no-new-privileges.
- `docker stop` shuts the app down cleanly in under a second (exit code 0).
- `backup.sh`, the 14-day pruning, and the restore drill all work. The restored
  database had the right data and ownership.
- Editing `ALLOWED_EMAILS` and re-running `docker compose up -d` recreates the
  container and the new address can register.

## Verified on the real server

Steps 1 to 3 were run on an IONOS VPS (Ubuntu 24.04.5, KVM, 1 vCPU, 2 GB RAM,
60 GB disk): the `deploy` user and its key login, a 2 GB swap file, Docker 29
from the official repository, UFW (22, 80, 443/tcp, 443/udp) and fail2ban, a
reboot into the updated kernel, and SSH hardening. After the hardening, only key
login as `deploy` works; root login and password login are refused.

Steps 4 to 6 were also run there: the compose files were copied, Postgres
started with the app role and database created (the app role can log in, Postgres
publishes no port), and Caddy obtained a real Let's Encrypt certificate for
`flashcards.hendrikmelse.com` in about 6 seconds. From outside, HTTPS presents a
valid certificate, plain HTTP redirects to HTTPS, and the site answers 502 until
the app is deployed. The CI key was installed as a restricted key and tested: it
cannot run arbitrary commands, open a terminal or forward ports, and the one
allowed command form passes validation and stops at the registry login when given
a bad token, without ever reaching `deploy.sh`.

**The first real deploy worked.** After the secrets and `DEPLOY_ENABLED` were
set, a push to `main` ran the tests, built the image, pushed it to GHCR, and
deployed it over SSH. It took about 105 seconds from push to a healthy container.
The server pulled the private image using the job's short-lived token, applied
the migrations to the empty database (11 tables), and the one-time
`seed-languages` command created `en` and `nl`. The whole stack then used about
80 MB of RAM (app 30 MB, Postgres 41 MB, Caddy 11 MB) and the box about 600 MB
of 1.8 GB, with no swap in use, and 5.7 GB of 58 GB of disk.

Checked from outside against the live site: HTTPS with a valid certificate,
the app shell, client routes, security headers, immutable caching of hashed
assets, gzip, the API, uninvited registration refused with 403, cross-origin
writes refused with 403, and **only ports 22, 80 and 443 reachable** (3000,
5432 and 8080 are closed). Caddy does not serve the app for other hostnames or
the bare IP.

## Not yet verified

- The production site used in a browser over HTTPS (registering and studying).
  The Content-Security-Policy was checked in a browser against the local stack
  over plain http only.
- Updating an already-running production deploy, and a production rollback
  (both were verified locally).
- The nightly backup cron entry, and offsite backups (not built yet).

## Repeating the local test

After changing the Dockerfile, compose files or `deploy.sh`, rerun the local
stack before pushing. In outline:

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
