# Client Pulse — Deployment Guide

## What you need
- GitHub account (github.com — free)
- AWS account (aws.amazon.com — free, requires credit card)

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

## Step 2 — Deploy to AWS Amplify

1. Go to **aws.amazon.com** → sign in → search for **Amplify** in the top search bar
2. Click **AWS Amplify** → **Get Started**
3. Choose **Host your web app**
4. Select **GitHub** → click **Continue**
5. Authorize AWS to access your GitHub
6. Select your `clientpulse` repository
7. Select branch: `main`
8. Build settings — Amplify will auto-detect the `amplify.yml` file. Leave everything as-is.
9. Click **Save and deploy**

Amplify will:
- Pull your code from GitHub
- Install dependencies (`npm ci`)
- Build the app (`npm run build`)
- Deploy to a URL like `https://main.xxxxxxxxxx.amplifyapp.com`

This takes about 3-5 minutes.

---

## Step 3 — Add a custom domain (optional)

If you want `clientpulse.rctmassage.com`:

1. In Amplify → your app → **Domain management**
2. Click **Add domain**
3. Enter your domain
4. Follow the DNS instructions (add CNAME records at your domain registrar)

---

## Step 4 — Set up Supabase

Follow the instructions in Settings → Database inside the app.

Add your Supabase URL and anon key — they're stored in your browser's localStorage and never leave your device.

---

## Updating the app

Whenever you make changes:

```bash
git add .
git commit -m "describe what changed"
git push
```

Amplify automatically detects the push and redeploys. Takes 2-3 minutes. Zero downtime.

---

## Costs

| Service | Cost |
|---|---|
| AWS Amplify (free tier) | $0 for first 1,000 build minutes/month |
| AWS Amplify hosting | ~$0.01/GB served — effectively $0 at your scale |
| GitHub (private repo) | $0 |
| Supabase (free tier) | $0 |
| **Total** | **$0/month** |

You'll stay on free tiers indefinitely at a massage clinic's traffic level.
