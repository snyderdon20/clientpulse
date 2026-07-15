# Client Pulse — Deployment Guide

## What you need
- GitHub account (github.com — free)
- Cloudflare account (dash.cloudflare.com — free, no credit card required)

---

## Step 1 — Push to GitHub

1. Go to **github.com** → click **+** → **New repository**
2. Name it `clientpulse`
3. Keep it **Private**
4. Click **Create repository**
5. On your computer, install Git if you don't have it: https://git-scm.com

Then open Terminal (Mac) or Command Prompt (Windows) and run:

```bash
cd clientpulse          # navigate to this folder
git init
git add .
git commit -m "Initial Client Pulse deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/clientpulse.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## Step 2 — Deploy to Cloudflare Pages

1. Go to **dash.cloudflare.com** → sign in (or create a free account)
2. In the left sidebar, click **Workers & Pages** → **Create** → **Pages** tab
3. Click **Connect to Git** → authorize Cloudflare to access your GitHub
4. Select your `clientpulse` repository
5. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Production branch:** `main`
6. Click **Save and Deploy**

Cloudflare will:
- Pull your code from GitHub
- Install dependencies and build the app
- Deploy to a URL like `https://clientpulse.pages.dev`

This takes about 2 minutes.

---

## Step 3 — Add a custom domain (optional)

If you want `clientpulse.rctmassage.com`:

1. In Cloudflare → your Pages project → **Custom domains**
2. Click **Set up a custom domain**
3. Enter your domain
4. Follow the DNS instructions (add a CNAME record at your domain registrar pointing to your `pages.dev` URL)

SSL is automatic and free.

---

## Step 4 — Set up Supabase

Follow the instructions in Settings → Database inside the app.

Add your Supabase URL and anon key — they're stored in your browser's localStorage and never leave your device.

Supabase Edge Functions deploy automatically via GitHub Actions
(`.github/workflows/deploy-functions.yml`) whenever a change to
`supabase/functions/**` is merged to main.

---

## Updating the app

Whenever you make changes:

```bash
git add .
git commit -m "describe what changed"
git push
```

Cloudflare Pages automatically detects the push to `main` and redeploys. Takes 1-2 minutes. Zero downtime.

---

## Costs

| Service | Cost |
|---|---|
| Cloudflare Pages (free plan) | $0 — unlimited bandwidth, 500 builds/month |
| GitHub (private repo) | $0 |
| Supabase (free tier) | $0 |
| **Total** | **$0/month** |

Cloudflare's free plan allows commercial use, so you'll stay at $0 indefinitely at a massage clinic's traffic level.

---

## Migrating away from AWS Amplify (one-time)

If the app was previously hosted on AWS Amplify:

1. Complete Steps 2–3 above and confirm the app works at the new URL
2. If you had a custom domain on Amplify, update the CNAME at your registrar to point to your `pages.dev` URL instead
3. In the AWS console → Amplify → your app → **Actions → Delete app** to stop any billing
