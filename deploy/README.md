# Deploy TicketForge to a free VPS

You create the server (the provider needs your own account), then one command from your Mac sets it up and
deploys. The same command ships every update.

What you get: TicketForge running as a service that restarts on reboot or crash, free HTTPS, Chromium for test
automation, and Claude Code ready to sign in from **Administration → Claude**. Your data stays in Supabase.

## 1. Create a free server

### Oracle Cloud Always Free (recommended: free forever, up to 4 CPUs and 24 GB RAM)

1. Sign up at [cloud.oracle.com/free](https://www.oracle.com/cloud/free/). A card is needed to verify you; Always
   Free resources aren't charged. Pick a home region close to you (e.g. Singapore or Tokyo); it can't be changed.
2. **Compute → Instances → Create instance**
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** Ampere → `VM.Standard.A1.Flex`, 2 OCPUs and 12 GB memory (marked *Always Free-eligible*).
     If it says *out of capacity*, try another availability domain, try again later, or use
     `VM.Standard.E2.1.Micro` (1 GB; works, builds are slower).
   - **Networking:** keep *Assign a public IPv4 address* on.
   - **SSH keys:** *Generate a key pair for me* → **Save private key** (e.g. to `~/Downloads/ssh-key.key`).
3. Open the website ports: on the instance page click the **subnet** → **Security Lists** → the default list →
   **Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination port `80,443`.
4. Copy the instance's **Public IP address**. The user name is `ubuntu`.

### AWS Free Plan (alternative: free credits, about 6 months)

New AWS accounts (since July 2025) get $100–200 in credits on the **Free plan** for up to 6 months. Instances
use up the credits. A `t4g.small` (2 vCPUs, 2 GB) with its disk and public IP costs roughly $15–20 of credits a month.
At the end you upgrade to a paid plan or the account closes, so treat it as a trial.

1. Sign up at [aws.amazon.com/free](https://aws.amazon.com/free/) and choose the **Free plan**. A card is needed
   for verification.
2. Top right, pick the region **Asia Pacific (Singapore)** (or the one closest to you).
3. **EC2 → Launch instance**
   - **Name:** `ticketforge`
   - **AMI:** Ubuntu Server 24.04 LTS, **64-bit (Arm)**
   - **Instance type:** `t4g.small` (*Free tier eligible*). On an x86 AMI, use `t3.small`.
   - **Key pair:** *Create new key pair* → name `ticketforge`, type ED25519, format `.pem` → it downloads.
   - **Network settings:** allow SSH from **My IP**, and tick **Allow HTTPS traffic** and **Allow HTTP traffic**
     from the internet.
   - **Storage:** 30 GB gp3.
4. **Launch**. When it's *Running*, copy the **Public IPv4 address**. The user name is `ubuntu`.

Optional: allocate an **Elastic IP** and associate it, so the address doesn't change if you stop the instance.

Deploy with: `SSH_KEY=~/Downloads/ticketforge.pem bash deploy/deploy.sh ubuntu@YOUR.SERVER.IP`

### Google Cloud free tier (alternative)

`e2-micro` in `us-west1`, `us-central1` or `us-east1` is free. It has 1 GB RAM, which is enough because the setup adds swap.
Use Ubuntu 24.04 and tick **Allow HTTP traffic** and **Allow HTTPS traffic**. Add your SSH public key under
*Security → Manage access*. The user name is the one in that key.

## 2. Deploy (from your Mac, in the project folder)

```bash
SSH_KEY=~/Downloads/ssh-key.key bash deploy/deploy.sh ubuntu@YOUR.SERVER.IP
```

The first run takes 5–10 minutes. It installs Node.js, Chromium's libraries, Claude Code, Caddy (HTTPS) and a
`ticketforge` service. It then uploads the code and your `.env`, builds and starts the app, and prints the
address, e.g. `https://203-0-113-10.sslip.io`. That free HTTPS address works without buying a domain.

Have a domain? Point an `A` record at the server's IP, then:

```bash
SSH_KEY=~/Downloads/ssh-key.key bash deploy/deploy.sh ubuntu@YOUR.SERVER.IP tickets.example.com
```

## 3. Connect Claude

Open the address, sign in, then **Administration → Claude → Sign in with Claude**. Open the sign-in page,
approve, and paste the code back. That's it.

## Updating

Change code on your Mac, then run the same deploy command again. Your `.env` is uploaded only the first time; to
replace the server's copy with your current one, add `--env`.

## Good to know

- **Database connections:** your Mac and the server share Supabase. Its Session pooler (port 5432) allows only 15
  connections in total. In the server's `.env`, use the **Transaction pooler** string (port 6543) instead. Find it in
  Supabase → **Connect** → *Transaction pooler*. Then put it in `.env` and run the deploy with `--env`.
- **Email links** use the server's address automatically (`APP_URL` is set by the service).
- **Logs:** `ssh ubuntu@IP 'sudo journalctl -u ticketforge -f'`
- **Restart:** `ssh ubuntu@IP 'sudo systemctl restart ticketforge'`
- **Files on the server:** app in `/opt/ticketforge/app`, test screenshots and other data in
  `/opt/ticketforge/data`, Claude's login in `/home/ticketforge/.claude`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Permission denied (publickey)` | Pass the key you saved: `SSH_KEY=path/to/key`. |
| The address doesn't load, or shows a certificate error | Ports 80 and 443 aren't open in the cloud firewall (step 1.3). Caddy gets the certificate as soon as they are. |
| Build stops with `Killed` | Out of memory. The setup adds 2 GB of swap; on 1 GB machines, run the deploy again. |
| `permission denied for schema public` | Connect `DATABASE_URL` as the `postgres` user (Supabase pooler user `postgres.<project-ref>`). |
| `max clients reached` | Use Supabase's Transaction pooler (port 6543) on the server, see above. |
